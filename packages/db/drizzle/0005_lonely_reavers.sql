CREATE TABLE "conversation_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_turn_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"summary" text,
	"turn_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_text" text NOT NULL,
	"trigger_text" text NOT NULL,
	"trigger_embedding" vector(1536),
	"active" boolean DEFAULT true NOT NULL,
	"source_memory" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_applied_at" timestamp with time zone,
	"apply_count" integer DEFAULT 0 NOT NULL,
	"superseded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "open_loops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"entity_id" uuid,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"source_memory" uuid NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_surfaced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "surfacings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"conversation_id" uuid,
	"evidence" uuid[] NOT NULL,
	"shown_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reaction" text,
	"reaction_at" timestamp with time zone,
	"suppressed_reason" text
);
--> statement-breakpoint
CREATE TABLE "entity_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"a_id" uuid NOT NULL,
	"b_id" uuid NOT NULL,
	"rel_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"strength" real DEFAULT 0 NOT NULL,
	"last_mentioned" timestamp with time zone,
	"evidence" uuid[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_edges_uniq" UNIQUE("user_id","a_id","b_id","rel_type")
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digests_user_kind_uniq" UNIQUE("user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"expo_token" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_user_device_uniq" UNIQUE("user_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "transcript_retention_days" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quiet_hours_start" time DEFAULT '22:00:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quiet_hours_end" time DEFAULT '08:00:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "max_daily_surfacings" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "attributes" jsonb;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_source_memory_memories_id_fk" FOREIGN KEY ("source_memory") REFERENCES "public"."memories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_loops" ADD CONSTRAINT "open_loops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_loops" ADD CONSTRAINT "open_loops_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_loops" ADD CONSTRAINT "open_loops_resolved_by_memories_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."memories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_loops" ADD CONSTRAINT "open_loops_source_memory_memories_id_fk" FOREIGN KEY ("source_memory") REFERENCES "public"."memories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surfacings" ADD CONSTRAINT "surfacings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surfacings" ADD CONSTRAINT "surfacings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_edges" ADD CONSTRAINT "entity_edges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_edges" ADD CONSTRAINT "entity_edges_a_id_entities_id_fk" FOREIGN KEY ("a_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_edges" ADD CONSTRAINT "entity_edges_b_id_entities_id_fk" FOREIGN KEY ("b_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_turns_conversation_idx" ON "conversation_turns" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_user_last_turn_idx" ON "conversations" USING btree ("user_id","last_turn_at");--> statement-breakpoint
CREATE INDEX "rules_user_active_idx" ON "rules" USING btree ("user_id") WHERE active;--> statement-breakpoint
CREATE INDEX "open_loops_user_status_due_idx" ON "open_loops" USING btree ("user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "open_loops_user_entity_idx" ON "open_loops" USING btree ("user_id","entity_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "surfacings_user_subject_shown_idx" ON "surfacings" USING btree ("user_id","subject_type","subject_id","shown_at");--> statement-breakpoint
CREATE INDEX "entity_edges_a_idx" ON "entity_edges" USING btree ("user_id","a_id");--> statement-breakpoint
CREATE INDEX "entity_edges_b_idx" ON "entity_edges" USING btree ("user_id","b_id");