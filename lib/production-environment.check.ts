import assert from "node:assert/strict";
import { productionEnvironmentError } from "./production-environment";

assert.equal(productionEnvironmentError({ NODE_ENV: "development" }), null);
assert.equal(productionEnvironmentError({ NODE_ENV: "production" }), null);
assert.match(productionEnvironmentError({ NODE_ENV: "production", UPSTASH_REDIS_REST_URL: "https://example.com" }) ?? "", /both UPSTASH/);
assert.match(productionEnvironmentError({ NODE_ENV: "production", UPSTASH_REDIS_REST_URL: "http://example.com", UPSTASH_REDIS_REST_TOKEN: "secret" }) ?? "", /https:\/\//);
assert.equal(productionEnvironmentError({ NODE_ENV: "production", UPSTASH_REDIS_REST_URL: "https://cache.example.com", UPSTASH_REDIS_REST_TOKEN: "secret" }), null);

console.log("production environment checks passed");
