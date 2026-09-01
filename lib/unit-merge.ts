export type DirectUnitRule = { multiplier: string };

// Duplicate units may only have a 1:1 rule between them. A non-1:1 rule means
// the two labels represent different quantities (for example dozen and piece),
// and merely changing historical references would falsify those documents.
export function directUnitMergeError(rules: DirectUnitRule[]): string | null {
  return rules.some((rule) => Math.abs(Number(rule.multiplier) - 1) > 0.000001)
    ? "These units have a non-1:1 conversion rule between them. They represent different quantities and cannot be merged safely."
    : null;
}
