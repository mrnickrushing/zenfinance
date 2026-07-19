UPDATE "admin_refresh_tokens" AS token
SET "replaced_by_id" = NULL
WHERE "replaced_by_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "admin_refresh_tokens" AS replacement WHERE replacement."id" = token."replaced_by_id"
  );--> statement-breakpoint
UPDATE "user_refresh_tokens" AS token
SET "replaced_by_id" = NULL
WHERE "replaced_by_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "user_refresh_tokens" AS replacement WHERE replacement."id" = token."replaced_by_id"
  );--> statement-breakpoint
ALTER TABLE "admin_refresh_tokens" ADD CONSTRAINT "admin_refresh_tokens_replaced_by_id_admin_refresh_tokens_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."admin_refresh_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_refresh_tokens" ADD CONSTRAINT "user_refresh_tokens_replaced_by_id_user_refresh_tokens_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."user_refresh_tokens"("id") ON DELETE set null ON UPDATE no action;
