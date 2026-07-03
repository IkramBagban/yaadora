ALTER TABLE "memories" ADD COLUMN "salience" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "salience" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "conflicts_with" uuid;