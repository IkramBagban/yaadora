ALTER TABLE "reminders" ADD COLUMN "recurrence" text DEFAULT 'once' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "weekdays" integer[];