CREATE TYPE "public"."enrichment_source" AS ENUM('llm', 'fallback', 'user_correction');--> statement-breakpoint
CREATE TYPE "public"."recurring_cadence" AS ENUM('weekly', 'biweekly', 'monthly', 'annual');--> statement-breakpoint
CREATE TABLE "ai_usage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"estimated_cost_usd" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"transaction_id" integer NOT NULL,
	"merchant_key" text NOT NULL,
	"original_category" text,
	"corrected_category" text NOT NULL,
	"corrected_is_discretionary" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_rollups" (
	"id" serial PRIMARY KEY NOT NULL,
	"aggregate_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"week_start" date NOT NULL,
	"metric" text NOT NULL,
	"category" text DEFAULT '_total' NOT NULL,
	"value_cents" bigint,
	"value_ratio" real,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_rollups_aggregate_id_unique" UNIQUE("aggregate_id")
);
--> statement-breakpoint
CREATE TABLE "recurring_streams" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"merchant_key" text NOT NULL,
	"merchant_clean" text NOT NULL,
	"cadence" "recurring_cadence" NOT NULL,
	"avg_amount_cents" bigint NOT NULL,
	"last_amount_cents" bigint NOT NULL,
	"occurrences" integer DEFAULT 2 NOT NULL,
	"first_seen_date" date NOT NULL,
	"last_seen_date" date NOT NULL,
	"next_expected_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_enrichments" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"category" text NOT NULL,
	"merchant_clean" text,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"is_discretionary" boolean DEFAULT false NOT NULL,
	"confidence" real NOT NULL,
	"source" "enrichment_source" NOT NULL,
	"model" text,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_corrections" ADD CONSTRAINT "category_corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_corrections" ADD CONSTRAINT "category_corrections_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_rollups" ADD CONSTRAINT "feature_rollups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD CONSTRAINT "recurring_streams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD CONSTRAINT "recurring_streams_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_enrichments" ADD CONSTRAINT "transaction_enrichments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_user_idx" ON "ai_usage_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_usage_user_created_idx" ON "ai_usage_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "corrections_user_idx" ON "category_corrections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "corrections_user_merchant_idx" ON "category_corrections" USING btree ("user_id","merchant_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rollup_user_week_metric_category_idx" ON "feature_rollups" USING btree ("user_id","week_start","metric","category");--> statement-breakpoint
CREATE INDEX "rollup_user_idx" ON "feature_rollups" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_user_account_merchant_idx" ON "recurring_streams" USING btree ("user_id","account_id","merchant_key");--> statement-breakpoint
CREATE INDEX "recurring_user_idx" ON "recurring_streams" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "txn_enrich_txn_idx" ON "transaction_enrichments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "txn_enrich_current_idx" ON "transaction_enrichments" USING btree ("transaction_id","superseded_at");