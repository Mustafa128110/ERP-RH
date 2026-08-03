"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { deleteInterCompanySale } from "@/lib/actions/inter-company";
import { errorTextClass } from "@/components/ui/form-styles";

export function DeleteInterCompanySaleButton({ saleId }: { saleId: string }) {
  const router = useRouter();
  // Navigation hangs off the action rather than an effect on the result — the
  // deleted sale's own page is what's on screen, so leaving it is part of the
  // delete. A failure keeps you here with the error visible.
  const [state, action, pending] = useActionState(async (prev: { error?: string; success?: boolean } | undefined, formData: FormData) => {
    const result = await deleteInterCompanySale(prev, formData);
    if (result?.success) router.push("/inventory/inter-company");
    return result;
  }, undefined);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete both documents? The stock goes back to the seller and neither company is owed anything.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="documentId" value={saleId} />
      <button type="submit" disabled={pending} className="text-sm font-medium text-error hover:underline disabled:opacity-40">
        {pending ? "Deleting…" : "Delete this sale"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
