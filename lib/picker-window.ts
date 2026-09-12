const labels = new WeakMap<{ name: string }, { name: string; normalized: string }>();
export function filterPickerOptions<T extends { name: string }>(options: T[], query: string): T[] {
  if (!query) return options;
  return options.filter(option => {
    let label = labels.get(option);
    if (!label || label.name !== option.name) {
      label = { name: option.name, normalized: option.name.toLowerCase() };
      labels.set(option, label);
    }
    return label.normalized.includes(query);
  });
}
export const PICKER_ROW_HEIGHT = 36;
export const PICKER_HEIGHT = 224;
export function pickerWindow(total: number, scrollTop: number) {
  const first = Math.max(0, Math.floor(scrollTop / PICKER_ROW_HEIGHT) - 4);
  return { first, last: Math.min(total, Math.ceil((scrollTop + PICKER_HEIGHT) / PICKER_ROW_HEIGHT) + 4) };
}
