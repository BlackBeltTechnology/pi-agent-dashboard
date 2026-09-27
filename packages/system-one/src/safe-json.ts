/**
 * Prototype-safe JSON parse: every object becomes a null-prototype object and
 * keys named `__proto__`, `constructor` or `prototype` are dropped at any
 * depth, each reported by path. `JSON.parse` defines `__proto__` as an own
 * property (it never invokes the setter), so the walk sees it and drops it.
 * See change: add-system-one-registry (design D12).
 */
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

export type Plain = { [k: string]: unknown };

export function safeParse(text: string, onDropped: (path: string) => void): unknown {
  return clean(JSON.parse(text), "", onDropped);
}

function clean(v: unknown, path: string, onDropped: (path: string) => void): unknown {
  if (Array.isArray(v)) return v.map((x, i) => clean(x, `${path}[${i}]`, onDropped));
  if (v === null || typeof v !== "object") return v;
  const out: Plain = Object.create(null);
  for (const k of Object.keys(v)) {
    const p = path ? `${path}.${k}` : k;
    if (FORBIDDEN.has(k)) {
      onDropped(p);
      continue;
    }
    out[k] = clean((v as Plain)[k], p, onDropped);
  }
  return out;
}

export const isObj = (v: unknown): v is Plain => v !== null && typeof v === "object" && !Array.isArray(v);
export const own = (o: Plain, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
