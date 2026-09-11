// Tagged nodes preserve dates/collections without colliding with user object keys.
type Node = [string, unknown];
function encode(value: unknown): Node {
  if (value === undefined) return ["undefined", null];
  if (value instanceof Date) return ["date", value.toISOString()];
  if (value instanceof Set) return ["set", [...value].map(encode)];
  if (value instanceof Map) return ["map", [...value].map(([k, v]) => [encode(k), encode(v)])];
  if (Array.isArray(value)) return ["array", value.map(encode)];
  if (value !== null && typeof value === "object") return ["object", Object.entries(value).map(([k, v]) => [k, encode(v)])];
  return ["value", value];
}
function decode(node: Node): unknown {
  if (!Array.isArray(node) || node.length !== 2) throw new Error("Invalid cache envelope");
  const [kind, value] = node;
  switch (kind) {
    case "undefined": return undefined;
    case "date": return new Date(value as string);
    case "set": return new Set((value as Node[]).map(decode));
    case "map": return new Map((value as [Node, Node][]).map(([k, v]) => [decode(k), decode(v)]));
    case "array": return (value as Node[]).map(decode);
    case "object": return Object.fromEntries((value as [string, Node][]).map(([k, v]) => [k, decode(v)]));
    case "value": return value;
    default: throw new Error("Unknown cache envelope");
  }
}
export function encodeCacheValue(value: unknown): string { return JSON.stringify(encode(value)); }
export function decodeCacheValue<T>(value: string): T { return decode(JSON.parse(value)) as T; }
