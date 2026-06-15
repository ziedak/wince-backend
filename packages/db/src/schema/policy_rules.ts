import { boolean, integer, jsonb, pgTable, serial, timestamp, text } from 'drizzle-orm/pg-core';
import { stores } from './stores.js';

export const policyRules = pgTable('policy_rules', {
  id: serial('id').primaryKey(),
  storeId: integer('store_id')
    .notNull()
    .references(() => stores.id, { onDelete: 'cascade' }),
  ruleType: text('rule_type').notNull(),
  parameters: jsonb('parameters').notNull(),
  enabled: boolean('enabled').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export type PolicyRule = typeof policyRules.$inferSelect;
export type NewPolicyRule = typeof policyRules.$inferInsert;
