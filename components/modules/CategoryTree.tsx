"use client";

import { useState } from "react";
import type { CategoryNode } from "@/lib/actions/categories";

type Handlers = {
  onSelect: (node: CategoryNode) => void;
  onMove: (dragId: string, targetParentId: string | null) => void;
  onAddChild: (parentId: string, name: string) => void;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
};

function TreeNode({ node, depth, h }: { node: CategoryNode; depth: number; h: Handlers }) {
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [over, setOver] = useState(false);

  function save() {
    const n = name.trim();
    if (!n) return;
    h.onAddChild(node.id, n);
    setName("");
    setAddOpen(false);
  }

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          h.setDraggingId(node.id);
        }}
        onDragEnd={() => h.setDraggingId(null)}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (h.draggingId && h.draggingId !== node.id) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          if (h.draggingId && h.draggingId !== node.id) h.onMove(h.draggingId, node.id);
        }}
        style={{ marginLeft: depth * 18 }}
        className={`group flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
          over ? "bg-navy-800/10 ring-1 ring-navy-800" : "hover:bg-ivory"
        }`}
      >
        <span className="cursor-grab select-none text-steel" title="Drag to move">
          ⠿
        </span>
        <button type="button" onClick={() => h.onSelect(node)} className="flex-1 text-left font-medium text-navy-800 hover:underline">
          {node.name}
        </button>
        {node.children.length > 0 && (
          <span className="text-xs text-steel">{node.children.length}</span>
        )}
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="flex h-6 w-6 items-center justify-center rounded border border-sand text-navy-800 opacity-0 transition group-hover:opacity-100 hover:bg-ivory"
          title="Add sub-category"
        >
          +
        </button>
      </div>

      {addOpen && (
        <div className="flex items-center gap-2 py-1" style={{ marginLeft: (depth + 1) * 18 }}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setAddOpen(false);
            }}
            placeholder="New sub-category"
            className="h-9 flex-1 rounded border border-sand px-2 text-sm text-ink focus:border-navy-800"
          />
          <button type="button" onClick={save} className="h-9 rounded bg-navy-800 px-3 text-sm font-medium text-white hover:bg-navy-700">
            Save
          </button>
        </div>
      )}

      {node.children.map((c) => (
        <TreeNode key={c.id} node={c} depth={depth + 1} h={h} />
      ))}
    </div>
  );
}

export function CategoryTree({
  roots,
  onSelect,
  onMove,
  onAddChild,
}: {
  roots: CategoryNode[];
  onSelect: (node: CategoryNode) => void;
  onMove: (dragId: string, targetParentId: string | null) => void;
  onAddChild: (parentId: string, name: string) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const h: Handlers = { onSelect, onMove, onAddChild, draggingId, setDraggingId };

  if (roots.length === 0) {
    return <div className="rounded-lg border border-dashed border-sand p-10 text-center text-sm text-steel">No categories yet.</div>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {roots.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} h={h} />
      ))}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (draggingId) onMove(draggingId, null);
        }}
        className="mt-2 rounded border border-dashed border-sand px-3 py-3 text-center text-xs text-steel"
      >
        Drop here to move to top level
      </div>
    </div>
  );
}
