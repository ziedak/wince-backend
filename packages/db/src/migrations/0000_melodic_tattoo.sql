CREATE TABLE "admin_user_stores" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_user_id" integer NOT NULL,
	"store_id" integer NOT NULL,
	CONSTRAINT "admin_user_stores_unique" UNIQUE("admin_user_id","store_id")
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'viewer',
	"is_active" boolean DEFAULT true,
	"last_login_at" timestamp with time zone,
	"failed_login_attempts" integer DEFAULT 0,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"key_hash" text NOT NULL,
	"label" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_user_id" integer,
	"store_id" integer,
	"action" text NOT NULL,
	"target" text,
	"details" jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"success" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "customer_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"distinct_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "customer_identities_store_distinct_unique" UNIQUE("store_id","distinct_id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"distinct_id" text NOT NULL,
	"email" text,
	"email_hash" text,
	"encrypted_email" "bytea",
	"phone" text,
	"phone_hash" text,
	"email_consent" boolean DEFAULT false,
	"sms_consent" boolean DEFAULT false,
	"lifetime_value" numeric DEFAULT '0',
	"last_seen_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "customers_store_distinct_unique" UNIQUE("store_id","distinct_id")
);
--> statement-breakpoint
CREATE TABLE "daily_budget" (
	"store_id" integer NOT NULL,
	"date" date NOT NULL,
	"total_discount_given" numeric DEFAULT '0',
	CONSTRAINT "daily_budget_store_id_date_pk" PRIMARY KEY("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "discount_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"session_id" text,
	"intervention_id" uuid,
	"discount_type" text DEFAULT 'percent' NOT NULL,
	"value" numeric,
	"min_cart_value" numeric,
	"max_uses" integer DEFAULT 1,
	"used_count" integer DEFAULT 0,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_in_order_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"store_id" integer NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone,
	"variants" jsonb NOT NULL,
	"active" boolean DEFAULT true,
	"metric" text,
	"confidence_level" numeric DEFAULT '0.95',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "intervention_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"intervention_id" uuid NOT NULL,
	"store_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "interventions" (
	"id" serial PRIMARY KEY NOT NULL,
	"intervention_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"distinct_id" text,
	"type" text NOT NULL,
	"channel" text DEFAULT 'in_shop' NOT NULL,
	"value" numeric,
	"discount_code" text,
	"trigger_reason" text,
	"sent_at" timestamp with time zone DEFAULT now(),
	"shown_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"attributed_at" timestamp with time zone,
	"attribution_window_hours" integer DEFAULT 24,
	"delivered" boolean DEFAULT false,
	"delivered_via" text,
	"converted" boolean DEFAULT false,
	"revenue_attributed" numeric,
	"experiment_id" text,
	"variant" text,
	"decision_latency_ms" integer,
	"confidence_score" numeric,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "interventions_intervention_id_unique" UNIQUE("intervention_id")
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"intervention_id" uuid,
	"store_id" integer NOT NULL,
	"distinct_id" text,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"provider" text,
	"provider_id" text,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "policy_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"rule_type" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now(),
	"store_id" integer
);
--> statement-breakpoint
CREATE TABLE "store_domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"domain" text NOT NULL,
	CONSTRAINT "store_domains_store_domain_unique" UNIQUE("store_id","domain")
);
--> statement-breakpoint
CREATE TABLE "store_usage" (
	"store_id" integer NOT NULL,
	"date" date NOT NULL,
	"events_count" bigint DEFAULT 0,
	"predictions_count" bigint DEFAULT 0,
	"notifications_sent" bigint DEFAULT 0,
	"interventions_sent" bigint DEFAULT 0,
	"revenue_recovered" numeric DEFAULT '0',
	CONSTRAINT "store_usage_store_id_date_pk" PRIMARY KEY("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"domain" text,
	"plan" text DEFAULT 'free',
	"rate_limit" integer DEFAULT 1000,
	"config" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true,
	"is_pending_deletion" boolean DEFAULT false,
	"timezone" text DEFAULT 'UTC',
	"currency" text DEFAULT 'USD',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "stores_api_key_hash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
ALTER TABLE "admin_user_stores" ADD CONSTRAINT "admin_user_stores_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_user_stores" ADD CONSTRAINT "admin_user_stores_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_budget" ADD CONSTRAINT "daily_budget_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_intervention_id_interventions_intervention_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("intervention_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervention_events" ADD CONSTRAINT "intervention_events_intervention_id_interventions_intervention_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("intervention_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervention_events" ADD CONSTRAINT "intervention_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_domains" ADD CONSTRAINT "store_domains_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_usage" ADD CONSTRAINT "store_usage_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;