-- Folds in the previously unjournalled "0006_ambiguous_insights" statement so a
-- fresh replay produces the exact schema state of meta/0006_snapshot.json.
ALTER TABLE "users" ADD COLUMN "insights_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "open_loops" ALTER COLUMN "source_memory" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "hidden" boolean;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "conflict_note" text;