import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations need a direct (non-pooled) connection — Supabase's transaction-mode
    // pooler doesn't reliably persist drizzle-kit's multi-statement migration
    // transactions (app runtime, lib/db/index.ts, keeps using the pooled DATABASE_URL).
    url: process.env.DATABASE_URL_DIRECT!,
  },
});
