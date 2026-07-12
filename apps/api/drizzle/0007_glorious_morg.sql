CREATE TABLE "referral_codes" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referral_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"redemption_id" integer NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"source_user_id" integer NOT NULL,
	"days" integer NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code_id" integer NOT NULL,
	"referrer_user_id" integer NOT NULL,
	"referred_user_id" integer NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_credits" ADD CONSTRAINT "referral_credits_redemption_id_referral_redemptions_id_fk" FOREIGN KEY ("redemption_id") REFERENCES "public"."referral_redemptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_credits" ADD CONSTRAINT "referral_credits_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_credits" ADD CONSTRAINT "referral_credits_source_user_id_users_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_redemptions" ADD CONSTRAINT "referral_redemptions_code_id_referral_codes_user_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."referral_codes"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_redemptions" ADD CONSTRAINT "referral_redemptions_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_redemptions" ADD CONSTRAINT "referral_redemptions_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referral_codes_code_idx" ON "referral_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "referral_credits_recipient_idx" ON "referral_credits" USING btree ("recipient_user_id","expires_at");--> statement-breakpoint
CREATE INDEX "referral_credits_redemption_idx" ON "referral_credits" USING btree ("redemption_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_redemptions_referred_idx" ON "referral_redemptions" USING btree ("referred_user_id");--> statement-breakpoint
CREATE INDEX "referral_redemptions_referrer_idx" ON "referral_redemptions" USING btree ("referrer_user_id");