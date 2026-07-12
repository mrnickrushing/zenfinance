CREATE TYPE "public"."anomaly_kind" AS ENUM('duplicate_charge', 'unusual_amount', 'fee', 'new_recurring');--> statement-breakpoint
CREATE TYPE "public"."anomaly_status" AS ENUM('open', 'acknowledged', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."feedback_rating" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'achieved', 'archived');--> statement-breakpoint
CREATE TYPE "public"."insight_kind" AS ENUM('first_look', 'weekly_brief');--> statement-breakpoint
CREATE TYPE "public"."insight_source" AS ENUM('llm', 'template');--> statement-breakpoint
CREATE TYPE "public"."money_win_kind" AS ENUM('subscription_canceled', 'fee_refund', 'anomaly_caught', 'spend_reduction');--> statement-breakpoint
CREATE TYPE "public"."money_win_status" AS ENUM('estimated', 'verified');--> statement-breakpoint
CREATE TABLE "anomalies" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"transaction_id" integer,
	"kind" "anomaly_kind" NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" "anomaly_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"target_amount_cents" bigint NOT NULL,
	"current_amount_cents" bigint DEFAULT 0 NOT NULL,
	"target_date" date,
	"priority" integer DEFAULT 1 NOT NULL,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" "insight_kind" NOT NULL,
	"week_start" date,
	"headline" text NOT NULL,
	"body" text NOT NULL,
	"action_description" text NOT NULL,
	"action_estimated_impact_cents" bigint,
	"action_timeframe" text NOT NULL,
	"claims" jsonb DEFAULT '[]' NOT NULL,
	"tone_check" real NOT NULL,
	"source" "insight_source" NOT NULL,
	"model" text,
	"feedback_rating" "feedback_rating",
	"feedback_followed_through" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_wins" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"insight_id" integer,
	"kind" "money_win_kind" NOT NULL,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" "money_win_status" DEFAULT 'estimated' NOT NULL,
	"dedupe_key" text NOT NULL,
	"source_recurring_stream_id" integer,
	"expected_charge_cents" bigint,
	"cycles_observed" integer DEFAULT 0 NOT NULL,
	"verify_cycles_required" integer DEFAULT 2 NOT NULL,
	"user_confirmed" boolean DEFAULT false NOT NULL,
	"last_checked_date" date,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anomalies" ADD CONSTRAINT "anomalies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomalies" ADD CONSTRAINT "anomalies_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_wins" ADD CONSTRAINT "money_wins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_wins" ADD CONSTRAINT "money_wins_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_wins" ADD CONSTRAINT "money_wins_source_recurring_stream_id_recurring_streams_id_fk" FOREIGN KEY ("source_recurring_stream_id") REFERENCES "public"."recurring_streams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anomalies_user_dedupe_idx" ON "anomalies" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "anomalies_user_status_idx" ON "anomalies" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "goals_user_idx" ON "goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "goals_user_status_idx" ON "goals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "insights_user_idx" ON "insights" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "insights_user_created_idx" ON "insights" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "insights_user_kind_week_idx" ON "insights" USING btree ("user_id","kind","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "money_wins_user_dedupe_idx" ON "money_wins" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "money_wins_user_idx" ON "money_wins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "money_wins_user_status_idx" ON "money_wins" USING btree ("user_id","status");