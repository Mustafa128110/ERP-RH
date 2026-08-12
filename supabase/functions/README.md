# Edge Functions

This folder holds Supabase Edge Functions (Deno, deployed to Supabase's edge
network). It is currently **empty on purpose** — the application's backend runs
as Next.js Server Actions on Vercel (see the root README), and this folder is
where anything that genuinely belongs off the Next.js server lives.

Good candidates for an edge function:

- **Webhooks** the app must receive without its own server running (the
  WhatsApp Cloud API webhook that was removed from `app/api/` is the natural
  first one — re-add it here and it becomes independent of Vercel).
- **Scheduled jobs** (`pg_cron` + a function, or Supabase's `cron` integration)
  that run against the database directly.
- Anything that should scale independently of the Next.js app.

## Adding a function

Each function is a folder with an `index.ts` entry point:

```
supabase/functions/my-function/
  index.ts
```

Minimal example:

```ts
// supabase/functions/hello/index.ts
Deno.serve(async (req) => {
  const body = await req.json();
  return new Response(JSON.stringify({ message: `Hello ${body?.name ?? "world"}` }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

## Deploying

```bash
supabase functions deploy hello
```

## JWT verification

Functions verify the caller's JWT by default (`verify_jwt = true`). A function
that must be reachable without a logged-in session — a webhook — sets
`verify_jwt = false` in `supabase/config.toml`:

```toml
[functions.my-webhook]
verify_jwt = false
```

## Calling from the frontend

The browser client is already wired (`@supabase/supabase-js` via
`lib/supabase/client.ts`):

```ts
const { data, error } = await supabase.functions.invoke("hello", {
  body: { name: "Royal Hardware" },
});
```

## Database access from a function

Edge functions run on Deno and cannot import the Next.js server-action code or
the drizzle client in `lib/`. They talk to the database over PostgREST (the
auto-generated REST API on `NEXT_PUBLIC_SUPABASE_URL/rest/v1`) or a direct
`postgres` connection using `SUPABASE_DB_URL` (auto-injected, see
`supabase secrets set` for others). Keep business rules that must be shared
between Vercel and edge functions in SQL (views, functions, RLS policies) in
`supabase/migrations/` so both sides run the same logic.
