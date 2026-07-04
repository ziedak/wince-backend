import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { adminUsers, adminUserStores, apiKeys, stores, eq, and } from '@org/db'
import { compare, hash } from 'bcryptjs'
import { Hono } from 'hono'
import { SignJWT, importPKCS8 } from 'jose'
import type { KongClient } from '../clients/kong'
import type { Config } from '../config'
import type { AuditService } from '../services/audit'
import type { DbClient } from '../types'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  storeName: z.string().min(1),
  domain: z.string().optional(),
})

async function retryKongProvisioning(
  fn: () => Promise<void>,
  maxRetries = 3
): Promise<boolean> {
  const delays = [200, 400, 800]
  for (let i = 0; i < maxRetries; i++) {
    try {
      await fn()
      return true
    } catch {
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delays[i]))
      }
    }
  }
  return false
}

export function createAuthRouter(
  db: DbClient,
  kong: KongClient,
  audit: AuditService,
  config: Config
) {
  const app = new Hono()

  app.post('/v1/admin/login', zValidator('json', loginSchema), async (c) => {
    const { email, password } = c.req.valid('json')
    const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip')
    const ua = c.req.header('user-agent')

    const [user] = await db
      .select()
      .from(adminUsers)
      .where(and(eq(adminUsers.email, email), eq(adminUsers.isActive, true)))
      .limit(1)

    if (!user) {
      await audit.log({
        action: 'login',
        target: email,
        success: false,
        ipAddress: ip,
        userAgent: ua,
      })
      return c.json(
        {
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid credentials',
        },
        401
      )
    }

    // Brute-force lockout check
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return c.json(
        {
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Account temporarily locked',
        },
        401
      )
    }

    const valid = await compare(password, user.passwordHash)
    if (!valid) {
      const attempts = (user.failedLoginAttempts ?? 0) + 1
      await db
        .update(adminUsers)
        .set({
          failedLoginAttempts: attempts,
          lockedUntil:
            attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
        })
        .where(eq(adminUsers.id, user.id))
      await audit.log({
        adminUserId: user.id,
        action: 'login',
        success: false,
        ipAddress: ip,
        userAgent: ua,
      })
      return c.json(
        {
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid credentials',
        },
        401
      )
    }

    // Reset failed attempts on success
    await db
      .update(adminUsers)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      })
      .where(eq(adminUsers.id, user.id))

    // Load store IDs for this user
    const userStores = await db
      .select({ storeId: adminUserStores.storeId })
      .from(adminUserStores)
      .where(eq(adminUserStores.adminUserId, user.id))
    const storeIds = userStores.map((s) => s.storeId)

    const privateKeyPem = Buffer.from(
      config.JWT_PRIVATE_KEY,
      'base64'
    ).toString('utf-8')
    const privateKey = await importPKCS8(privateKeyPem, 'RS256')

    const expiresIn = 3600
    const token = await new SignJWT({
      email: user.email,
      roles: [user.role ?? 'viewer'],
      store_ids: storeIds,
      token_version: user.tokenVersion,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(String(user.id))
      .setIssuedAt()
      .setExpirationTime(`${expiresIn}s`)
      .sign(privateKey)

    await audit.log({
      adminUserId: user.id,
      action: 'login',
      success: true,
      ipAddress: ip,
      userAgent: ua,
    })

    return c.json(
      { access_token: token, token_type: 'Bearer', expires_in: expiresIn },
      200
    )
  })

  app.post(
    '/v1/admin/register',
    zValidator('json', registerSchema),
    async (c) => {
      const { email, password, storeName, domain } = c.req.valid('json')
      const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip')
      const ua = c.req.header('user-agent')

      // Check for duplicate email
      const [existing] = await db
        .select({ id: adminUsers.id })
        .from(adminUsers)
        .where(eq(adminUsers.email, email))
        .limit(1)
      if (existing) {
        return c.json(
          {
            statusCode: 409,
            error: 'Conflict',
            message: 'Email already registered',
          },
          409
        )
      }

      const passwordHash = await hash(password, 12)
      const rawApiKey = crypto.randomUUID()
      // We store the raw key in Kong; hash a placeholder in stores.api_key_hash for compatibility
      const placeholderHash = await hash(rawApiKey, 10)

      // DB transaction: commit before calling Kong

      const result = await db.transaction(async (tx) => {
        const [store] = await tx
          .insert(stores)
          .values({
            name: storeName,
            domain,
            apiKeyHash: placeholderHash,
            isActive: false,
          })
          .returning({ id: stores.id })

        const [user] = await tx
          .insert(adminUsers)
          .values({ email, passwordHash, role: 'admin' })
          .returning({ id: adminUsers.id })

        await tx
          .insert(adminUserStores)
          .values({ adminUserId: user.id, storeId: store.id })

        await tx.insert(apiKeys).values({
          storeId: store.id,
          keyHash: placeholderHash,
          label: 'default',
          isActive: true,
        })

        return { storeId: store.id, userId: user.id }
      })

      const storeId = result.storeId
      const userId = result.userId

      // Provision Kong consumer outside the transaction
      const kongUsername = `store-${storeId}`
      const provisioned = await retryKongProvisioning(async () => {
        await kong.createConsumer(kongUsername, String(storeId))
        await kong.createApiKey(kongUsername, rawApiKey)
      })

      if (provisioned) {
        await db
          .update(stores)
          .set({ isActive: true })
          .where(eq(stores.id, storeId))
        await audit.log({
          adminUserId: userId,
          storeId,
          action: 'register',
          success: true,
          ipAddress: ip,
          userAgent: ua,
        })
        return c.json(
          {
            storeId,
            apiKey: rawApiKey,
            message: 'Store registered successfully',
          },
          201
        )
      } else {
        // Kong failed — store stays inactive; merchant retriggers via api-keys/regenerate
        await audit.log({
          adminUserId: userId,
          storeId,
          action: 'register',
          success: false,
          details: { reason: 'kong_provisioning_failed' },
          ipAddress: ip,
          userAgent: ua,
        })
        return c.json(
          {
            storeId,
            message:
              'Registration accepted. API key provisioning is in progress.',
          },
          202
        )
      }
    }
  )

  return app
}
