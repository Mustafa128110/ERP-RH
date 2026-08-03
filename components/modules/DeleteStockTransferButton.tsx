"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { deleteStockTransfer } from "@/lib/actions/stock-transfers";
import { errorTextClass } from "@/components/ui/form-styles";

export function DeleteStockTransferButton({ transferId }: { transferId: string }) {
  const router = useRouter();
  // Navigation hangs off the action rather than an effect on the result — the
  // deleted transfer's own page is what's on screen, so leaving it is part of the
  // delete. A failure keeps you here with the error visible.
  const [state, action, pending] = useActionState(async (prev: { error?: string; success?: boolean } | undefined, formData: FormData) => {
    const result = await deleteStockTransfer(prev, formData);
    if (result?.success) router.push("/inventory/stock-transfers");
    return result;
  }, undefined);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete this transfer? The stock it moved goes back to where it was.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="documentId" value={transferId} />
      <button type="submit" disabled={pending} className="text-sm font-medium text-error hover:underline disabled:opacity-40">
        {pending ? "Deleting…" : "Delete this transfer"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
