-- Expenses were tagged with a location/warehouse that nothing ever read: no
-- report grouped by it, no filter used it, and the column was optional so most
-- rows had it NULL anyway. Dropped from the form and from the table.
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_location_id_locations_id_fk";--> statement-breakpoint
ALTER TABLE "expenses" DROP COLUMN "location_id";
