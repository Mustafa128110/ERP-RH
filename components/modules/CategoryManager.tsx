"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useNewEntry } from "@/components/layout/KeyboardShortcuts";
import type { CategoryNode } from "@/lib/actions/categories";
import { saveCategoryTree, createCategoriesBatch } from "@/lib/actions/categories";
import { CategoryTree } from "@/components/modules/CategoryTree";
import { CategoryEditForm, DeleteCategoryButton, CategoryBatchAddDialog } from "@/components/modules/CategoryForm";
import { Dialog } from "@/components/ui/Dialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { primaryActionClass } from "@/components/ui/form-styles";

type ModalState = { kind: "batch" } | { kind: "edit"; node: CategoryNode } | null;

function flatten(nodes: CategoryNode[]): CategoryNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

// True when `id` is `node` itself or anywhere in its subtree — used to block
// dropping a category into its own descendant.
function subtreeHas(node: CategoryNode, id: string): boolean {
  return node.id === id || node.children.some((c) => subtreeHas(c, id));
}

// Detach the node with `id` from the tree, returning the pruned tree and the
// removed node (with its subtree intact).
function detach(nodes: CategoryNode[], id: string): { tree: CategoryNode[]; removed: CategoryNode | null } {
  let removed: CategoryNode | null = null;
  const tree: CategoryNode[] = [];
  for (const n of nodes) {
    if (n.id === id) {
      removed = n;
      continue;
    }
    const child = detach(n.children, id);
    if (child.removed) removed = child.removed;
    tree.push({ ...n, children: child.tree });
  }
  return { tree, removed };
}

function attach(nodes: CategoryNode[], parentId: string | null, node: CategoryNode): CategoryNode[] {
  if (parentId === null) return [...nodes, { ...node, parentId: null }];
  return nodes.map((n) =>
    n.id === parentId
      ? { ...n, children: [...n.children, { ...node, parentId }] }
      : { ...n, children: attach(n.children, parentId, node) },
  );
}

function moveNode(tree: CategoryNode[], dragId: string, targetParentId: string | null): CategoryNode[] {
  const dragged = flatten(tree).find((n) => n.id === dragId);
  if (!dragged) return tree;
  // Can't drop a node into itself or its own descendant.
  if (targetParentId !== null && subtreeHas(dragged, targetParentId)) return tree;
  const { tree: pruned, removed } = detach(tree, dragId);
  if (!removed) return tree;
  return attach(pruned, targetParentId, removed);
}

// Flatten to the rows saveCategoryTree expects: id, parentId, and sibling order.
function forSave(nodes: CategoryNode[], parentId: string | null): { id: string; parentId: string | null; sortOrder: number }[] {
  return nodes.flatMap((n, i) => [{ id: n.id, parentId, sortOrder: i }, ...forSave(n.children, n.id)]);
}

export function CategoryManager({ roots }: { roots: CategoryNode[] }) {
  const [modal, setModal] = useState<ModalState>(null);
  const [tree, setTree] = useState<CategoryNode[]>(roots);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  // Reset the working tree whenever the server sends a fresh copy (after an
  // inline add, a save, or an edit) — the sanctioned "adjust state during
  // render on prop change" pattern, keyed on the incoming roots reference.
  const [prevRoots, setPrevRoots] = useState(roots);
  if (prevRoots !== roots) {
    setPrevRoots(roots);
    setTree(roots);
    setDirty(false);
  }

  const flat = flatten(tree);

  function close() {
    setModal(null);
    router.refresh();
  }

  function move(dragId: string, targetParentId: string | null) {
    setTree((prev) => moveNode(prev, dragId, targetParentId));
    setDirty(true);
  }

  async function addChild(parentId: string, name: string) {
    await createCategoriesBatch([{ name, parentId }]);
    router.refresh();
  }

  async function save() {
    setSaving(true);
    const res = await saveCategoryTree(forSave(tree, null));
    setSaving(false);
    if (res.success) {
      setDirty(false);
      router.refresh();
    }
  }

  useNewEntry(() => setModal({ kind: "batch" }));

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="Categories" subtitle={`${flat.length} categor${flat.length === 1 ? "y" : "ies"}`}>
        {dirty && (
          <button type="button" onClick={save} disabled={saving} className={primaryActionClass}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        )}
        <button type="button" onClick={() => setModal({ kind: "batch" })} className={primaryActionClass}>
          + Add Categories
        </button>
      </PageHeader>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <CategoryTree roots={tree} onSelect={(node) => setModal({ kind: "edit", node })} onMove={move} onAddChild={addChild} />
      </div>

      {modal?.kind === "batch" && <CategoryBatchAddDialog parentOptions={flat} onClose={() => setModal(null)} onDone={close} />}

      {modal?.kind === "edit" && (
        <Dialog title={modal.node.name} onClose={close}>
          <div className="flex flex-col gap-4">
            <CategoryEditForm
              categoryId={modal.node.id}
              defaults={modal.node}
              parentOptions={flat.filter((c) => c.id !== modal.node.id)}
              onDone={close}
            />
            <div className="rounded border border-error/30 bg-error-tint p-4">
              <DeleteCategoryButton categoryId={modal.node.id} onDone={close} />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
