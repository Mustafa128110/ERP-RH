ALTER TABLE "taxes" ADD CONSTRAINT "taxes_rate_check" CHECK ("taxes"."rate" BETWEEN 0 AND 100);
