import {
  boolean,
  customType,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { stores } from './stores.js';

/** pgcrypto-encrypted bytea — encrypted at application layer before INSERT. */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const customers = pgTable(
  'customers',
  {
    id: serial('id').primaryKey(),
    storeId: integer('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    distinctId: text('distinct_id').notNull(),
    /** @pii Plaintext email — use encryptedEmail for storage, keep for operational reads (notification delivery). */
    email: text('email'),
    emailHash: text('email_hash'),
    /** @pii pgcrypto-encrypted email stored as bytea. Encrypt with pgp_sym_encrypt() at application layer. */
    encryptedEmail: bytea('encrypted_email'),
    phone: text('phone'),
    phoneHash: text('phone_hash'),
    emailConsent: boolean('email_consent').default(false),
    smsConsent: boolean('sms_consent').default(false),
    lifetimeValue: numeric('lifetime_value').default('0'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** Soft-delete timestamp for GDPR right-to-erasure. Null = active customer. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [unique('customers_store_distinct_unique').on(table.storeId, table.distinctId)],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
