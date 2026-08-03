"use client";

import { useActionState, useEffect } from "react";
import { updateCategory, deleteCategory, createCategoriesBatch, type CategoryBatchRow } from "@/lib/actions/categories";
import { inputClass, labelClass, labelTextClass, submitClass, deleteButtonClass, errorTextClass, successTextClass } from "@/components/ui/form-styles";
import { BatchAddDialog, batchCellClass, batchInputClass } from "@/components/ui/BatchAddDialog";

// Categories are global reference data — no company scope, no company field.
interface CategoryValues {
  name: string;
  slug: string | null;
  parentId: string | null;
}

function Fields({ defaults, parentOptions }: { defaults?: CategoryValues; parentOptions: { id: string; name: string }[] }) {
  return (
    <>
      <label className={labelClass}>
        <span className={labelTextClass}>Name</span>
        <input name="name" type="text" required defaultValue={defaults?.name} className={inputClass} />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Parent Category</span>
        <select name="parentId" defaultValue={defaults?.parentId ?? "none"} className={inputClass}>
          <option value="none">None — top-level category</option>
          {parentOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export function CategoryEditForm({
  categoryId,
  defaults,
  parentOptions,
  onDone,
}: {
  categoryId: string;
  defaults: CategoryValues;
  parentOptions: { id: string; name: string }[];
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(updateCategory.bind(null, categoryId), undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Fields defaults={defaults} parentOptions={parentOptions} />
      {state?.error && <p className={errorTextClass}>{state.error}</p>}
      {state?.success && <p className={successTextClass}>Saved.</p>}
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

type BatchRow = { name: string; parentId: string };

const emptyBatchRow = (): BatchRow => ({ name: "", parentId: "" });

export type CreatedCategory = { id: string; name: string };

export function CategoryBatchAddDialog({
  parentOptions,
  onClose,
  onDone,
  initialRows,
}: {
  parentOptions: { id: string; name: string }[];
  onClose: () => void;
  onDone: (created?: CreatedCategory[]) => void;
  initialRows?: number;
}) {
  return (
    <BatchAddDialog<BatchRow, CreatedCategory>
      title="Add Categories"
      onClose={onClose}
      onDone={onDone}
      initialRows={initialRows}
      emptyRow={emptyBatchRow}
      headers={["Name", "Parent Category"]}
      onSubmit={async (rows) => {
        const values: CategoryBatchRow[] = rows.map((r) => ({
          name: r.name.trim(),
          parentId: r.parentId || null,
        }));
        return createCategoriesBatch(values);
      }}
      renderRow={(row, i, update) => (
        <>
          <td className={batchCellClass}>
            <input value={row.name} onChange={(e) => update({ name: e.target.value })} className={batchInputClass} placeholder="Name" />
          </td>
          <td className={batchCellClass}>
            <select value={row.parentId} onChange={(e) => update({ parentId: e.target.value })} className={batchInputClass}>
              <option value="">None — top-level</option>
              {parentOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </td>
        </>
      )}
    />
  );
}

export function DeleteCategoryButton({ categoryId, onDone }: { categoryId: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState(deleteCategory, undefined);

  useEffect(() => {
    if (state?.success) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete this category? This fails if it has child categories or items still referencing it.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="categoryId" value={categoryId} />
      <button type="submit" disabled={pending} className={deleteButtonClass}>
        {pending ? "Deleting…" : "Delete this category"}
      </button>
      {state?.error && <p className={`mt-2 ${errorTextClass}`}>{state.error}</p>}
    </form>
  );
}
