"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { errorTextClass, inputClass, labelClass, labelTextClass, submitClass } from "@/components/ui/form-styles";
import { assignBaseUnitToProducts } from "@/lib/actions/products";
import { assignUnitConversionRuleToItems } from "@/lib/actions/unit-conversions";

type Option = { id: string; name: string };

export function ProductAssignmentDialog({
  kind,
  itemIds,
  options,
  onClose,
  onDone,
}: {
  kind: "rule" | "base-unit";
  itemIds: string[];
  options: Option[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isRule = kind === "rule";

  return (
    <Dialog title={isRule ? "Assign Unit Rule" : "Assign Base Stock Unit"} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-steel">
          This will assign one {isRule ? "rule" : "base stock unit"} to {itemIds.length} selected product{itemIds.length === 1 ? "" : "s"}.
          Historical stock quantities are recalculated after the assignment.
        </p>
        <label className={labelClass}>
          <span className={labelTextClass}>{isRule ? "Unit Rule" : "Base Stock Unit"}</span>
          <select value={value} onChange={(event) => setValue(event.target.value)} className={inputClass}>
            <option value="">Select {isRule ? "a rule" : "a unit"}</option>
            {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        {options.length === 0 && <p className="text-sm text-steel">No {isRule ? "unit rules" : "units"} are available yet.</p>}
        {error && <p className={errorTextClass}>{error}</p>}
        <button
          type="button"
          disabled={pending || !value}
          className={submitClass}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = isRule
                ? await assignUnitConversionRuleToItems(value, itemIds)
                : await assignBaseUnitToProducts(itemIds, value);
              if (result.error) setError(result.error);
              else onDone();
            });
          }}
        >
          {pending ? "Assigning…" : isRule ? "Assign Rule" : "Assign Base Unit"}
        </button>
      </div>
    </Dialog>
  );
}
