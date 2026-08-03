"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Split out of session.ts: "use server" turns every export of a module into a
// public HTTP endpoint, and session.ts exports getSession(), which returns the
// caller's full permission set. Only these two belong on the wire.

export async function login(_prevState: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Invalid email or password." };

  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
