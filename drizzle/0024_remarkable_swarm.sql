ALTER TABLE "expenses" ADD COLUMN "bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "cash_account_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "cheque_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cheque_id_cheque_register_id_fk" FOREIGN KEY ("cheque_id") REFERENCES "public"."cheque_register"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cheque_id_unique" UNIQUE("cheque_id");