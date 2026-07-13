CREATE TABLE "provider_revocation_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "provider_revocation_pending_idx" ON "provider_revocation_jobs" USING btree ("completed_at","next_attempt_at");