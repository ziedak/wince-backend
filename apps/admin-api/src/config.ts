import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3008),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CLICKHOUSE_URL: z.string().min(1),
  INTERNAL_SECRET: z.string().min(1),
  /** RS256 private key, base64-encoded PEM */
  JWT_PRIVATE_KEY: z.string().min(1),
  /** RS256 public key, base64-encoded PEM */
  JWT_PUBLIC_KEY: z.string().min(1),
  DECISION_ENGINE_URL: z.string().min(1),
  KONG_ADMIN_URL: z.string().min(1),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Missing or invalid env vars: ${missing}`);
  }
  return result.data;
}
