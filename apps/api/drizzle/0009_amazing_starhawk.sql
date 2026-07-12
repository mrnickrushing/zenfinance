CREATE TABLE "household_goal_contributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"user_id" integer,
	"amount_cents" bigint NOT NULL,
	"note" text,
	"contributed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"created_by_user_id" integer,
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
CREATE TABLE "household_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"invited_by_user_id" integer NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by_user_id" integer,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"privacy_mode" text DEFAULT 'individual' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"seat_limit" integer DEFAULT 2 NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_goal_contributions" ADD CONSTRAINT "household_goal_contributions_goal_id_household_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."household_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_goal_contributions" ADD CONSTRAINT "household_goal_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_goals" ADD CONSTRAINT "household_goals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_goals" ADD CONSTRAINT "household_goals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "household_goal_contributions_goal_idx" ON "household_goal_contributions" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "household_goal_contributions_user_idx" ON "household_goal_contributions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "household_goals_household_idx" ON "household_goals" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "household_goals_created_by_idx" ON "household_goals" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "household_invites_household_idx" ON "household_invites" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "household_invites_email_idx" ON "household_invites" USING btree ("email","status");--> statement-breakpoint
CREATE UNIQUE INDEX "household_members_user_idx" ON "household_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "household_members_household_user_idx" ON "household_members" USING btree ("household_id","user_id");--> statement-breakpoint
CREATE INDEX "household_members_household_idx" ON "household_members" USING btree ("household_id");