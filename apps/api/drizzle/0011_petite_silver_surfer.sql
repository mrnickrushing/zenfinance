CREATE TABLE "money_physical_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"product_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"store" text,
	"environment" text DEFAULT 'UNKNOWN' NOT NULL,
	"purchase_source" text NOT NULL,
	"purchased_at" timestamp with time zone NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"score" integer NOT NULL,
	"headline" text NOT NULL,
	"summary" text NOT NULL,
	"sections" jsonb DEFAULT '{}' NOT NULL,
	"actions" jsonb DEFAULT '[]' NOT NULL,
	"raw_payload" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "money_physical_reports" ADD CONSTRAINT "money_physical_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "money_physical_reports_transaction_idx" ON "money_physical_reports" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "money_physical_reports_user_created_idx" ON "money_physical_reports" USING btree ("user_id","created_at");