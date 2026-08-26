CREATE TABLE "item_unit_conversion_rules" (
	"item_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_unit_conversion_rules_item_id_rule_id_pk" PRIMARY KEY("item_id","rule_id")
);
--> statement-breakpoint
-- Convert the former product-owned rows into named reusable rules before
-- removing item_id.  Existing rows remain one-for-one rules, preserving every
-- historical conversion and its assignment without changing stock values.
ALTER TABLE "unit_conversions" ADD COLUMN "name" varchar(150);--> statement-breakpoint
UPDATE "unit_conversions" uc
SET "name" = left(concat('Legacy: ', fu."name", ' to ', tu."name", ' × ', uc."multiplier"::text), 150)
FROM "units" fu, "units" tu
WHERE fu."id" = uc."from_unit_id" AND tu."id" = uc."to_unit_id";--> statement-breakpoint
ALTER TABLE "unit_conversions" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "unit_conversions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "unit_conversions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "item_unit_conversion_rules" ADD CONSTRAINT "item_unit_conversion_rules_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_unit_conversion_rules" ADD CONSTRAINT "item_unit_conversion_rules_rule_id_unit_conversions_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."unit_conversions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "item_unit_conversion_rules" ("item_id", "rule_id")
SELECT "item_id", "id" FROM "unit_conversions";--> statement-breakpoint
CREATE INDEX "idx_item_unit_conversion_rules_rule" ON "item_unit_conversion_rules" USING btree ("rule_id");--> statement-breakpoint
ALTER TABLE "unit_conversions" DROP CONSTRAINT "unit_conversions_item_id_from_unit_id_to_unit_id_unique";--> statement-breakpoint
ALTER TABLE "unit_conversions" DROP CONSTRAINT "unit_conversions_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "unit_conversions" DROP COLUMN "item_id";--> statement-breakpoint
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_different_units_check" CHECK ("unit_conversions"."from_unit_id" <> "unit_conversions"."to_unit_id");
