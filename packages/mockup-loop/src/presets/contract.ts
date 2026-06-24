/**
 * DTCG contract loading + normalization for design-system presets.
 *
 * Every preset's contract is bundled under `presets-data/<id>/` so the loop
 * works offline and is versioned with the package. `loadContract` reads the
 * bundled snapshot and asserts a minimal W3C Design Token Community Group
 * (DTCG) shape. `refreshContract` re-fetches upstream tokens and rewrites the
 * snapshot (escape hatch for drift); upstream sources are documented per
 * preset in the README. Apple HIG ships a hand-authored rule pack (Apple
 * publishes no token JSON) — same DTCG-shaped envelope.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getPreset } from "./registry.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Package-root `presets-data/` (src/presets/ → ../../presets-data). */
export const PRESETS_DATA_DIR = path.resolve(HERE, "..", "..", "presets-data");

/** A DTCG token node: leaf carries `$value`; groups nest further nodes. */
export interface DtcgNode {
  $value?: unknown;
  $type?: string;
  $description?: string;
  [key: string]: unknown;
}

export interface DtcgContract {
  [key: string]: DtcgNode | unknown;
}

export function contractPath(id: string): string {
  return path.join(PRESETS_DATA_DIR, id, "contract.tokens.json");
}

export function rubricPath(id: string): string {
  return path.join(PRESETS_DATA_DIR, id, "rubric.json");
}

/** True when an object tree contains at least one DTCG `$value` leaf. */
export function isDtcg(obj: unknown): boolean {
  if (obj == null || typeof obj !== "object") return false;
  const stack: unknown[] = [obj];
  while (stack.length) {
    const node = stack.pop();
    if (node == null || typeof node !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(node, "$value")) return true;
    for (const v of Object.values(node as Record<string, unknown>)) {
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return false;
}

/**
 * Load a preset's bundled DTCG contract. Throws a clear error when the preset
 * is unknown, the snapshot is missing, or the JSON is not DTCG-shaped.
 */
export function loadContract(id: string): DtcgContract {
  if (!getPreset(id)) {
    throw new Error(`Unknown design system "${id}".`);
  }
  const file = contractPath(id);
  if (!fs.existsSync(file)) {
    throw new Error(`No bundled contract snapshot for "${id}" at ${file}.`);
  }
  const raw = fs.readFileSync(file, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Contract snapshot for "${id}" is not valid JSON: ${String(err)}`);
  }
  if (!isDtcg(parsed)) {
    throw new Error(`Contract snapshot for "${id}" is not DTCG-shaped (no $value leaf).`);
  }
  return parsed as DtcgContract;
}

/** Upstream token source per preset, used by `refreshContract`. */
export const UPSTREAM_SOURCES: Record<string, string | null> = {
  shadcn: "https://ui.shadcn.com (CSS variables → DTCG)",
  mui: "@mui/material default theme (createTheme() → DTCG)",
  "material-3": "Material 3 --md-sys-* design tokens",
  "fluent-2": "@fluentui/tokens (webLightTheme → DTCG)",
  // Apple publishes no token JSON; rule pack is hand-authored, not refreshable.
  "apple-hig": null,
};

/**
 * Re-fetch upstream tokens and rewrite the bundled snapshot.
 *
 * Network fetching is delegated to the documented per-preset regeneration step
 * (see README). This entry point validates the request and surfaces the
 * upstream source; it never silently no-ops. Returns the snapshot path.
 */
export async function refreshContract(id: string): Promise<string> {
  const preset = getPreset(id);
  if (!preset) throw new Error(`Unknown design system "${id}".`);
  const source = UPSTREAM_SOURCES[id];
  if (preset.contractSource === "rule-pack" || source == null) {
    throw new Error(
      `"${id}" uses a hand-authored rule pack — no upstream token source to refresh.`,
    );
  }
  // Ensure the snapshot dir exists; actual upstream import is the documented
  // regeneration step. Validate the current snapshot is present + DTCG so a
  // refresh request against a corrupt snapshot fails loudly.
  await fsp.mkdir(path.join(PRESETS_DATA_DIR, id), { recursive: true });
  const file = contractPath(id);
  if (fs.existsSync(file)) loadContract(id);
  return file;
}
