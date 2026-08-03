import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// Session mode (DATABASE_URL_DIRECT, port 5432), not the transaction pooler.
//
// The transaction pooler multiplexes statements across backends, which rules out
// prepared statements — hence the `prepare: false` this used to carry. That flag
// is not free: without a prepared statement, postgres-js has to Parse and
// Describe a parameterised query before it can Execute it, and against a
// database ~170ms away that is a second round trip on every query with a WHERE
// value. Measured on this project's own sales query: 350ms pooled versus 178ms
// with prepared statements. Queries taking no parameters were always 1 trip,
// which is why some pages looked twice as fast as others for no obvious reason.
//
// Session mode holds a backend per connection, so it is the wrong choice for
// serverless — and the right one here, where a single long-lived Node server
// keeps a small warm pool. That is also Supabase's own guidance. `max` below
// bounds it well under the direct-connection budget.
const connectionString = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL!;

// Dev-mode hot-reload re-evaluates this module on most file saves; without
// caching the client on globalThis, each reload opened a brand new
// postgres() connection pool and never closed the old one, leaking
// connections until the budget was exhausted and queries started
// queuing/timing out. Production has one module instance anyway, so this is
// a no-op there.
const globalForDb = globalThis as unknown as { dbClient?: postgres.Sql };

// Session mode holds a real backend per connection and this project is capped at
// 15 of them ("max clients are limited to pool_size: 15"), so `max` has to stay
// well under that — migrations, drizzle-studio, psql and (in dev) every
// hot-reloaded module instance draw from the same 15. 6 leaves headroom. It's
// enough because the option lists that used to make a page fire a dozen queries
// at once are now served from lib/cache.ts, so a request needs one or two.
//
// idle_timeout closes a connection left unused for 20s. On Singapore a reconnect
// is ~80ms, cheap enough that keeping idle backends forever isn't worth it — and
// crucially it stops connections leaking: a force-killed dev/build process would
// otherwise hold its backends until the pooler reaps them, and a few restart
// cycles exhaust the 15-connection cap. The trade is one occasional 80ms
// reconnect for not running out of connections.
const client =
  globalForDb.dbClient ??
  postgres(connectionString, {
    max: 6,
    idle_timeout: 20,
    connect_timeout: 10,
    // DB_DEBUG=1 logs every statement with its connection id. The whole
    // performance story here is "how many round trips does this page cost",
    // and that is otherwise invisible.
    ...(process.env.DB_DEBUG
      ? {
          debug: (c: number, query: string) =>
            console.log(`[sql t=${Date.now() % 100000} conn=${c}]`, query.replace(/\s+/g, " ").slice(0, 80)),
        }
      : {}),
  });

if (process.env.NODE_ENV !== "production") globalForDb.dbClient = client;

// Drizzle's postgres-js driver runs every statement through `client.unsafe()`,
// and postgres-js does not prepare an `unsafe()` query unless the call asks it
// to — so the connection-level `prepare` setting never reaches the queries
// drizzle actually sends. Without a prepared statement, a parameterised query
// costs Parse + Describe before Execute: a second round trip, every time.
// Measured here: 346ms without, 172ms with.
//
// There is no drizzle option for this, so the flag is added on the way through.
// `begin` and `savepoint` hand back a fresh client that drizzle wraps in its own
// session, so those callbacks are re-wrapped too or everything inside a
// transaction would quietly keep paying the extra trip.
//
// This is coupled to session mode above: prepared statements and the
// transaction pooler are mutually exclusive. If DATABASE_URL_DIRECT ever points
// back at :6543, drop this wrapper with it.
function preparing(sql: postgres.Sql): postgres.Sql {
  return new Proxy(sql, {
    get(target, prop, receiver) {
      if (prop === "unsafe") {
        return (query: string, params?: unknown[], options?: Record<string, unknown>) =>
          (target.unsafe as unknown as (q: string, p?: unknown[], o?: Record<string, unknown>) => unknown)(
            query,
            params,
            { prepare: true, ...options },
          );
      }
      if (prop === "begin" || prop === "savepoint") {
        const original = Reflect.get(target, prop, target) as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => {
          const i = args.findIndex((a) => typeof a === "function");
          if (i !== -1) {
            const callback = args[i] as (inner: postgres.Sql) => unknown;
            args[i] = (inner: postgres.Sql) => callback(preparing(inner));
          }
          return original.apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export const db = drizzle(preparing(client), { schema });
