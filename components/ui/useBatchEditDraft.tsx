"use client";
import { useClientUserId } from "@/lib/client-user";
import { useDraft } from "./useDraft";
import { canonicalJson } from "@/lib/command-protocol";

export function useBatchEditDraft<T>(domain: string, ids: string[], base: { id: string; _revision?: string }[] | null, input: T, apply: (input: T) => void) {
  const user = useClientUserId();
  const key = `edit-batch:${user}:${domain}:${[...ids].sort().join(",")}`;
  const revisions = Object.fromEntries((base ?? []).map(row => [`${domain}:${row.id}`, row._revision ?? ""]));
  const ready = !!base?.length && ids.every(id => !!revisions[`${domain}:${id}`]);
  const draft = useDraft(key, {
    state: { revisions, input }, enabled: ready, skipInitialSave: true,
    canRestore: value => !!value && canonicalJson(value.revisions) === canonicalJson(revisions) && !!value.input,
    apply: value => apply(value.input),
  });
  return { ...draft, ready, attributes: { "data-batch-draft-key": key, "data-command-table": domain, "data-command-revisions": JSON.stringify(revisions) } };
}
