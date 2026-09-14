/**
 * Small structural helpers shared by the core modules.
 * See change: extract-mcp-client-plugin.
 */

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Read a dotted path from a nested object tree, or undefined if any step is absent. */
export function getByName(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Set a dotted path on a nested object tree, creating intermediate objects. */
export function setByName(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (!isPlainObject(cur[key])) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}
