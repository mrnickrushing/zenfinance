CREATE TYPE "public"."billing_plan" AS ENUM('free', 'monthly', 'annual', 'lifetime', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."billing_status" AS ENUM('free', 'trialing', 'active', 'grace_period', 'billing_issue', 'expired', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."entitlement_source" AS ENUM('revenuecat_webhook', 'revenuecat_rest', 'client_restore', 'manual_test');--> statement-breakpoint
CREATE TABLE "billing_customers" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"revenuecat_app_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customers_revenuecat_app_user_id_unique" UNIQUE("revenuecat_app_user_id")
);
--> statement-breakpoint
CREATE TABLE "billing_entitlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"entitlement_id" text NOT NULL,
	"status" "billing_status" DEFAULT 'free' NOT NULL,
	"plan" "billing_plan" DEFAULT 'free' NOT NULL,
	"product_id" text,
	"store" text,
	"environment" text DEFAULT 'UNKNOWN' NOT NULL,
	"will_renew" boolean,
	"expires_at" timestamp with time zone,
	"latest_purchase_at" timestamp with time zone,
	"billing_issue_at" timestamp with time zone,
	"cancellation_at" timestamp with time zone,
	"management_url" text,
	"source" "entitlement_source",
	"source_event_id" text,
	"raw_payload" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"revenuecat_event_id" text NOT NULL,
	"user_id" integer,
	"app_user_id" text NOT NULL,
	"type" text NOT NULL,
	"product_id" text,
	"entitlement_ids" jsonb DEFAULT '[]' NOT NULL,
	"environment" text DEFAULT 'UNKNOWN' NOT NULL,
	"event_timestamp" timestamp with time zone,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload" jsonb NOT NULL,
	CONSTRAINT "billing_events_revenuecat_event_id_unique" UNIQUE("revenuecat_event_id")
);
--> statement-breakpoint
CREATE TABLE "pricing_experiments" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"experiment_id" text NOT NULL,
	"variant" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_entitlements" ADD CONSTRAINT "billing_entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_experiments" ADD CONSTRAINT "pricing_experiments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_customers_rc_user_idx" ON "billing_customers" USING btree ("revenuecat_app_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_entitlements_user_entitlement_idx" ON "billing_entitlements" USING btree ("user_id","entitlement_id");--> statement-breakpoint
CREATE INDEX "billing_entitlements_user_status_idx" ON "billing_entitlements" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "billing_events_user_idx" ON "billing_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "billing_events_app_user_idx" ON "billing_events" USING btree ("app_user_id");--> statement-breakpoint
CREATE INDEX "pricing_experiments_experiment_idx" ON "pricing_experiments" USING btree ("experiment_id","variant");