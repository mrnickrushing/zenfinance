ALTER TABLE "referral_credits" DROP CONSTRAINT "referral_credits_source_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "referral_redemptions" DROP CONSTRAINT "referral_redemptions_code_id_referral_codes_user_id_fk";
--> statement-breakpoint
ALTER TABLE "referral_redemptions" DROP CONSTRAINT "referral_redemptions_referrer_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "referral_redemptions" DROP CONSTRAINT "referral_redemptions_referred_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "referral_credits" ALTER COLUMN "source_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "referral_redemptions" ALTER COLUMN "code_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "referral_redemptions" ALTER COLUMN "referrer_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "referral_redemptions" ALTER COLUMN "referred_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "referral_credits" ADD CONSTRAINT "referral_credits_source_user_id_users_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_redemptions" ADD CONSTRAINT "referral_redemptions_code_id_referral_codes_user_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."referral_codes"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_redemptions" ADD CONSTRAINT "referral_redemptions_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_redemptions" ADD CONSTRAINT "referral_redemptions_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;