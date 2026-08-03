import "server-only";

// A dropped DNS lookup or a refused connection is not a failed query — the
// statement never reached the database. Retrying one is safe in a way that
// retrying a *sent* statement is not: a connection that dies mid-flight may have
// committed, so sending it again could write twice. That is the whole rule this
// file encodes, and why it discriminates on `syscall` rather than on the error
// code alone.
//
//   getaddrinfo EAI_AGAIN aws-0-ap-southeast-1.pooler.supabase.com
//
// is the one that keeps appearing: the resolver hiccups for a moment, and every
// request in that moment 500s because getSession() is the first query of every
// one of them. Two quick retries turn it into a pause nobody notices.
const TRANSIENT = new Set(["EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"]);

function isConnectFailure(e: unknown): boolean {
  const err = e as { syscall?: string; code?: string; cause?: unknown };
  // postgres-js hands the OS error up as-is; drizzle wraps it, so check the
  // cause too rather than only the outer error.
  if ((err.syscall === "getaddrinfo" || err.syscall === "connect") && TRANSIENT.has(err.code ?? "")) return true;
  return err.cause ? isConnectFailure(err.cause) : false;
}

const ATTEMPTS = 3;
const BACKOFF_MS = 200;

// Only for reads, or for writes that are idempotent by construction. Everything
// this is used on today is a SELECT.
export async function withConnectRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt >= ATTEMPTS || !isConnectFailure(e)) throw e;
      // 200ms, then 400ms. A resolver that is still down after that is a real
      // outage, and the error boundary says so rather than this looping.
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * attempt));
    }
  }
}
