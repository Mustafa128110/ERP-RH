-- The phone an ERP user messages from, which is the whole authorisation model
-- for the WhatsApp agent: an inbound number resolves to a real user, and the
-- agent then runs under that person's roles and company access.
--
-- Nullable: almost nobody has one. UNIQUE: two people sharing a handset would
-- leave the agent unable to say whose permissions to apply.

ALTER TABLE "users" ADD COLUMN "whatsapp_number" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_whatsapp_number_unique" UNIQUE("whatsapp_number");