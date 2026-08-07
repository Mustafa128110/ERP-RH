CREATE TYPE "public"."theme_preference" AS ENUM('light', 'dark');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ui_theme" "theme_preference" DEFAULT 'light' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ui_scale" smallint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "ui_scale_range" CHECK ("users"."ui_scale" BETWEEN 75 AND 175);