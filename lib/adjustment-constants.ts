// Lives outside lib/actions/stock-adjustments.ts because that file is
// "use server", and such a module may only export async functions — exporting
// this array from there made every page importing the action fail to evaluate.
// Same reason lib/cheque-constants.ts exists.
//
// FR-STK: fixed list. "Transfer Variance" is what a partial transfer receipt
// resolves to. A code-level enum, not data the shop maintains.
export const ADJUSTMENT_REASONS = ["Damage", "Expiry", "Theft/Loss", "Count Correction", "Transfer Variance", "Other"] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];
