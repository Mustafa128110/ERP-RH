# Royal Hardware ERP — Deployment

**Phase:** 12 of 12
**Status:** Config written; not yet deployed (needs a real Supabase project + Vercel account, which weren't provisioned in this session)

---

## 1. Provision Supabase

1. Create a Supabase project (this is also the Postgres database — no separate DB provider needed).
2. Note the project URL and keys for `.env` (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
3. Enable Email/Password auth (Authentication → Providers) — this is an internal tool, no self-signup, so leave public signup disabled; Admins are provisioned via `createUser` (see `src/modules/identity/README.md`).
4. Set a stricter-than-default rate limit on login attempts (Authentication → Rate Limits) per `docs/phase-7-api-design.md` §0.7.
5. Create a Storage bucket (e.g. `product-images`) for `ProductImage.url` and expense attachment uploads.
6. Apply Row Level Security: the `app_user` role and RLS policies are defined in `src/lib/db/schema.ts` (via `pgRole`/`pgPolicy`) and emitted into the generated migration by `drizzle-kit generate` — do this before go-live, not after. `src/lib/db/context.ts`'s `withUserContext()` is the application-side half (every Server Action and Server Component read already goes through it).

## 2. Run migrations

```bash
# Point DATABASE_URL at the Supabase connection string first
npx drizzle-kit migrate
npm run db:seed
```

The seed creates: Royal Hardware + M52 companies, Main Warehouse/Shop/Transit, the four sales channels mapped to their companies, the Admin/Salesman roles with their full permission matrices, the ten standard expense categories, base units, and a handful of sample products (see `src/lib/db/seed.ts`) — the sample products are demo data; remove or replace them before real go-live.

## 3. Deploy to Vercel

1. Import the repository into Vercel.
2. Set every variable from `.env.example` in Vercel's Environment Variables (Production + Preview) — `DATABASE_URL`, the three Supabase keys, the five WhatsApp keys, the three Google Drive keys, and `CRON_SECRET`.
3. `vercel.json` already schedules `/api/cron/backup` daily at 21:00 UTC (02:00 PKT, matching the Settings screen in the Phase 6 wireframes) — Vercel reads this automatically, no dashboard configuration needed.
4. Drizzle needs no client-generation step — the schema in `src/lib/db/schema.ts` is plain TypeScript, compiled as part of `next build` like any other module. There is no `postinstall` codegen script to confirm in the build log.

## 4. Register the WhatsApp webhook (Meta side)

Once deployed, in the Meta App Dashboard (WhatsApp → Configuration):
- Callback URL: `https://<your-domain>/api/webhooks/whatsapp`
- Verify token: whatever value you set for `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- Subscribe to the `messages` field so delivery-status callbacks reach `whatsapp_messages_log` (once the WhatsApp send module itself is implemented — see `src/modules/whatsapp/README.md`, this is the receiving half only).

## 5. CI

`.github/workflows/ci.yml` runs on every push/PR: `tsc --noEmit`, lint, unit tests (`npm test`), and a production build — against a placeholder `DATABASE_URL` (no live database in CI yet), so this catches type/build regressions but not schema-drift or runtime/query errors. Adding a `drizzle-kit check` step (verifies the schema and generated migrations haven't diverged) and wiring a real ephemeral Postgres service into CI (e.g. a `postgres:` service container + `drizzle-kit migrate` before the build step) are the natural next steps once integration tests exist (`docs/phase-11-testing.md` §2).

## 6. Post-deploy smoke checklist

- [ ] Sign in as the seeded Admin account, confirm the Dashboard loads with real (zeroed) figures, not errors.
- [ ] Create a Product, confirm it appears in the list and detail tabs render.
- [ ] Post a Sale against a warehouse with stock, confirm the resulting `stock_balances` row decremented and an Invoice number was generated.
- [ ] Attempt to post a Sale exceeding available stock as a non-Admin session, confirm it's blocked (FR-SALE-004).
- [ ] Confirm a Salesman-role test account cannot see cost/margin fields or the Purchases/Suppliers/Reports nav items at all.
- [ ] Hit `/api/cron/backup` manually with the correct `Authorization: Bearer <CRON_SECRET>` header, confirm a `Backup` row is created; confirm it 401s without the header.

---

This completes all 12 phases from `ENGINEERING_CONSTITUTION.md`. See the final summary for what's production-ready today versus what's explicitly scoped as follow-up work.
