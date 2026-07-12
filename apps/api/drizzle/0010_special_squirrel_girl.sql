CREATE TABLE "voice_briefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"insight_id" integer NOT NULL,
	"script" text NOT NULL,
	"segments" jsonb DEFAULT '[]' NOT NULL,
	"duration_seconds" integer NOT NULL,
	"play_count" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_briefs" ADD CONSTRAINT "voice_briefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_briefs" ADD CONSTRAINT "voice_briefs_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "voice_briefs_insight_idx" ON "voice_briefs" USING btree ("insight_id");--> statement-breakpoint
CREATE INDEX "voice_briefs_user_created_idx" ON "voice_briefs" USING btree ("user_id","created_at");