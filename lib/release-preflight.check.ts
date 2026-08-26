import assert from "node:assert/strict";
import { productionEnvironmentError } from "./production-environment";

// A release may be prepared from a shell whose NODE_ENV is not production, so
// force the production contract here rather than trusting that shell setting.
const error = productionEnvironmentError({ ...process.env, NODE_ENV: "production" });
assert.equal(error, null, error ?? undefined);

console.log("release environment preflight passed");
