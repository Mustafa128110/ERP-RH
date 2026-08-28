import assert from "node:assert/strict";
import { productionEnvironmentError } from "./production-environment";

const valid: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  DATABASE_URL_DIRECT: "postgresql://erp:secret@db.example.com:5432/erp",
};

assert.equal(productionEnvironmentError(valid), null);
assert.equal(productionEnvironmentError({ NODE_ENV: "development" }), null);
assert.match(productionEnvironmentError({ NODE_ENV: "production" }) ?? "", /NEXT_PUBLIC_SUPABASE_URL/);
assert.match(productionEnvironmentError({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "http://example.com" }) ?? "", /https:\/\//);
assert.match(productionEnvironmentError({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: "service-role-key" }) ?? "", /must not contain/);
assert.match(productionEnvironmentError({ ...valid, DATABASE_URL_DIRECT: "https://example.com" }) ?? "", /postgresql:\/\//);
assert.match(productionEnvironmentError({ ...valid, UPSTASH_REDIS_REST_URL: "https://example.com" }) ?? "", /both UPSTASH/);
assert.match(productionEnvironmentError({ ...valid, UPSTASH_REDIS_REST_URL: "http://example.com", UPSTASH_REDIS_REST_TOKEN: "secret" }) ?? "", /https:\/\//);
assert.equal(productionEnvironmentError({ ...valid, UPSTASH_REDIS_REST_URL: "https://cache.example.com", UPSTASH_REDIS_REST_TOKEN: "secret" }), null);
const whatsapp = {
  WHATSAPP_VERIFY_TOKEN: "verify-token",
  WHATSAPP_APP_SECRET: "app-secret",
  WHATSAPP_PHONE_NUMBER_ID: "123456",
  WHATSAPP_ACCESS_TOKEN: "access-token",
  GEMINI_API_KEY: "gemini-key",
  UPSTASH_REDIS_REST_URL: "https://cache.example.com",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
};
assert.equal(productionEnvironmentError({ ...valid, ...whatsapp }), null);
assert.match(productionEnvironmentError({ ...valid, WHATSAPP_VERIFY_TOKEN: "verify-token" }) ?? "", /WHATSAPP_APP_SECRET/);

console.log("production environment checks passed");
