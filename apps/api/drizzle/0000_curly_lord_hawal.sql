CREATE TYPE "public"."support_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE "admin_refresh_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "support_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"message" text NOT NULL,
	"status" "support_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_signups" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_signups_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "admin_refresh_family_idx" ON "admin_refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "support_status_idx" ON "support_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "support_created_at_idx" ON "support_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "waitlist_created_at_idx" ON "waitlist_signups" USING btree ("created_at");