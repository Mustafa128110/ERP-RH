function isProductionRuntime(environment: NodeJS.ProcessEnv) {
  return environment.NODE_ENV === "production";
}

export function productionEnvironmentError(environment: NodeJS.ProcessEnv = process.env): string | null {
  if (!isProductionRuntime(environment)) return null;

  const url = environment.UPSTASH_REDIS_REST_URL?.trim();
  const token = environment.UPSTASH_REDIS_REST_TOKEN?.trim();
  // Cache is intentionally optional: quota exhaustion must fall back to direct
  // database reads, not stop the shop from opening.  Partial configuration is
  // still a deployment error because it looks healthy while never connecting.
  if (Boolean(url) !== Boolean(token)) return "Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or neither.";
  if (url) {
    try {
      const protocol = new URL(url).protocol;
      if (protocol !== "https:") return "UPSTASH_REDIS_REST_URL must use https://.";
    } catch {
      return "UPSTASH_REDIS_REST_URL is not a valid URL.";
    }
  }

  return null;
}

export function assertProductionEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const error = productionEnvironmentError(environment);
  if (error) throw new Error(`Production configuration error: ${error}`);
}
