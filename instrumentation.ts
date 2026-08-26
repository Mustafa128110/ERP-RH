import { assertProductionEnvironment } from "@/lib/production-environment";

// This runs once per Next server instance before it starts serving requests.
// Edge functions cannot use the Node Redis client; this application’s server
// actions and database cache execute in the Node runtime.
export function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  assertProductionEnvironment();
}
