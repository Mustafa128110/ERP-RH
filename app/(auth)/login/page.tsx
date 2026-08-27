"use client";

import { useActionState } from "react";
import { login } from "@/lib/auth/actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded bg-zinc-900 text-sm font-bold text-white dark:bg-zinc-50 dark:text-zinc-900">
          RH
        </div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Royal Hardware ERP</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Sign in to continue</p>
      </div>

      <form action={action} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="h-12 rounded-md border border-zinc-300 px-3 text-base dark:border-zinc-700 dark:bg-zinc-950 sm:text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="h-12 rounded-md border border-zinc-300 px-3 text-base dark:border-zinc-700 dark:bg-zinc-950 sm:text-sm"
          />
        </label>

        {state?.error && <p role="alert" className="rounded border border-error/35 bg-error-tint px-3 py-2 text-sm text-error">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 h-12 w-full rounded-md bg-zinc-900 px-4 text-base font-medium text-white hover:bg-zinc-700 disabled:opacity-60 sm:text-sm dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
