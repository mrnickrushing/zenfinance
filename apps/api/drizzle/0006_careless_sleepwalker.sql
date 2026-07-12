CREATE TABLE "privacy_deletion_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"email_hash" text NOT NULL,
	"item_count" integer NOT NULL,
	"provider_revocation_failures" integer DEFAULT 0 NOT NULL,
	"processor_deletion_status" jsonb DEFAULT '{}' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "privacy_deletion_events" ADD CONSTRAINT "privacy_deletion_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_deletion_user_idx" ON "privacy_deletion_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "privacy_deletion_requested_idx" ON "privacy_deletion_events" USING btree ("requested_at");