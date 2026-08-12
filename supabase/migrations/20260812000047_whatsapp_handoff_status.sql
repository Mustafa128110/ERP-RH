-- The free send path. A "handoff" message was composed by the ERP and opened in
-- the user's own WhatsApp to send from their phone, so no provider ever sees it
-- and no delivery callback will ever arrive for it. Distinct from "sent" (which
-- the log can back up with a provider message id) and from "queued" (which means
-- we genuinely don't know what happened).
ALTER TYPE "public"."whatsapp_status" ADD VALUE 'handoff';
