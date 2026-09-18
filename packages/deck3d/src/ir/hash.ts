/**
 * Canonical JSON + sha256 helpers.
 *
 * `derivedHash` is computed over the derived fields only (`defaults` + `slides`),
 * excluding `overrides` (user-written) and `meta` (provenance). This is what
 * lets `validate` detect an edit made outside `overrides` without the markdown.
 */
import { createHash } from "node:crypto";

/** Recursively sort object keys so serialisation is order-independent. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortKeys(src[key]);
    return out;
  }
  return value;
}

/** Deterministic JSON: object keys sorted, no incidental whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Hash of the derived region of an IR. */
export function computeDerivedHash(ir: { defaults: unknown; slides: unknown }): string {
  return sha256Hex(canonicalJson({ defaults: ir.defaults, slides: ir.slides }));
}
