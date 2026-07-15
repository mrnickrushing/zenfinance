CREATE INDEX "household_invites_invited_by_idx" ON "household_invites" USING btree ("invited_by_user_id");--> statement-breakpoint
CREATE INDEX "household_invites_accepted_by_idx" ON "household_invites" USING btree ("accepted_by_user_id");--> statement-breakpoint
CREATE INDEX "money_wins_insight_idx" ON "money_wins" USING btree ("insight_id");--> statement-breakpoint
CREATE INDEX "money_wins_source_recurring_stream_idx" ON "money_wins" USING btree ("source_recurring_stream_id");--> statement-breakpoint
CREATE INDEX "referral_credits_source_user_idx" ON "referral_credits" USING btree ("source_user_id");--> statement-breakpoint
CREATE INDEX "referral_redemptions_code_idx" ON "referral_redemptions" USING btree ("code_id");