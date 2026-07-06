-- Migration: 0002_intervention_recommendations
-- Adds the intervention_recommendations table for the two-phase decision pipeline.
-- Lifecycle: pending → (approved | rejected | expired) → executed
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "intervention_recommendations" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id"                integer NOT NULL,
  "session_id"              text NOT NULL,
  "distinct_id"             text NOT NULL,
  "customer_id"             integer,
  "risk_score"              numeric NOT NULL,
  "prediction_probability"  numeric,
  "prediction_confidence"   numeric,
  "type"                    text NOT NULL,
  "channel"                 text NOT NULL,
  "value"                   numeric,
  "status"                  text NOT NULL DEFAULT 'pending',
  "approved_by"             integer,
  "approved_at"             timestamp with time zone,
  "rejected_by"             integer,
  "rejected_at"             timestamp with time zone,
  "executed_at"             timestamp with time zone,
  "expires_at"              timestamp with time zone NOT NULL,
  "intervention_id"         uuid,
  "trigger_reason"          text,
  "feature_schema_version"  text,
  "created_at"              timestamp with time zone DEFAULT now(),
  "updated_at"              timestamp with time zone DEFAULT now()
);
--> statement-breakpoint

ALTER TABLE "intervention_recommendations"
  ADD CONSTRAINT "intervention_recommendations_store_id_stores_id_fk"
  FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "intervention_recommendations"
  ADD CONSTRAINT "intervention_recommendations_approved_by_admin_users_id_fk"
  FOREIGN KEY ("approved_by") REFERENCES "public"."admin_users"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "intervention_recommendations"
  ADD CONSTRAINT "intervention_recommendations_rejected_by_admin_users_id_fk"
  FOREIGN KEY ("rejected_by") REFERENCES "public"."admin_users"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "intervention_recommendations"
  ADD CONSTRAINT "intervention_recommendations_intervention_id_interventions_intervention_id_fk"
  FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("intervention_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ir_store_status_idx"
  ON "intervention_recommendations" ("store_id", "status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ir_session_idx"
  ON "intervention_recommendations" ("session_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ir_expires_at_idx"
  ON "intervention_recommendations" ("expires_at")
  WHERE status = 'pending';
