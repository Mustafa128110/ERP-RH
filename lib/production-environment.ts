function isProductionRuntime(environment: NodeJS.ProcessEnv) {
  return environment.NODE_ENV === "production";
}

function required(environment: NodeJS.ProcessEnv, name: string): string | null {
  const value = environment[name]?.trim();
  if (!value) return `Set ${name}.`;
  if (/[<>]/.test(value)) return `${name} still contains a placeholder value.`;
  return null;
}

function httpsUrl(value: string | undefined, name: string): string | null {
  try {
    if (new URL(value ?? "").protocol !== "https:") return `${name} must use https://.`;
  } catch {
    return `${name} is not a valid URL.`;
  }
  return null;
}

export function productionEnvironmentError(environment: NodeJS.ProcessEnv = process.env): string | null {
  if (!isProductionRuntime(environment)) return null;

  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const error = required(environment, name);
    if (error) return error;
  }

  const supabaseUrlError = httpsUrl(environment.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  if (supabaseUrlError) return supabaseUrlError;
  if (environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() === environment.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return "NEXT_PUBLIC_SUPABASE_ANON_KEY must not contain the service-role key.";
  }

  const databaseUrl = environment.DATABASE_URL_DIRECT?.trim() || environment.DATABASE_URL?.trim();
  if (!databaseUrl) return "Set DATABASE_URL_DIRECT (or DATABASE_URL).";
  if (/[<>]/.test(databaseUrl)) return "The database URL still contains a placeholder value.";
  try {
    const protocol = new URL(databaseUrl).protocol;
    if (protocol !== "postgres:" && protocol !== "postgresql:") return "The database URL must use postgresql://.";
  } catch {
    return "The database URL is not valid.";
  }

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
