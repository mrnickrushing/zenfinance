CREATE TYPE "public"."item_status" AS ENUM('active', 'login_required', 'disconnected');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"provider_account_id" text NOT NULL,
	"name" text NOT NULL,
	"official_name" text,
	"type" text NOT NULL,
	"subtype" text,
	"mask" text,
	"current_balance_cents" bigint,
	"iso_currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_item_id" text NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"institution_name" text,
	"status" "item_status" DEFAULT 'active' NOT NULL,
	"sync_cursor" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_provider_item_id_unique" UNIQUE("provider_item_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"provider_txn_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"iso_currency" text DEFAULT 'USD' NOT NULL,
	"posted_date" date NOT NULL,
	"name" text NOT NULL,
	"merchant_name" text,
	"provider_category" text,
	"pending" boolean DEFAULT false NOT NULL,
	"pending_txn_id" text,
	"superseded_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"transfer_pair_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_refresh_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"family_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"apple_sub" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_apple_sub_unique" UNIQUE("apple_sub")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_refresh_tokens" ADD CONSTRAINT "user_refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_item_provider_idx" ON "accounts" USING btree ("item_id","provider_account_id");--> statement-breakpoint
CREATE INDEX "accounts_item_idx" ON "accounts" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "items_user_idx" ON "items" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "txn_account_provider_idx" ON "transactions" USING btree ("account_id","provider_txn_id");--> statement-breakpoint
CREATE INDEX "txn_account_date_idx" ON "transactions" USING btree ("account_id","posted_date");--> statement-breakpoint
CREATE INDEX "txn_transfer_pair_idx" ON "transactions" USING btree ("transfer_pair_id");--> statement-breakpoint
CREATE INDEX "user_refresh_family_idx" ON "user_refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "user_refresh_user_idx" ON "user_refresh_tokens" USING btree ("user_id");