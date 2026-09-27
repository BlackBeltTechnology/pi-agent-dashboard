/**
 * Read / revision / merge-write of `~/.pi/agent/system-one.json` for the three
 * writers (design D12): settings save, calibration save, supervisor port
 * persist. Each re-reads inside its request and replaces only the keys it
 * owns; every other key survives. A revision is the SHA-256 of the file bytes,
 * or `"absent"`. Writes are atomic (temp file + rename).
 * See change: add-system-one-registry.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { atomicWrite0600, isObj, safeParse, userConfigPath } from "@blackbelt-technology/pi-system-one";

export const ABSENT = "absent";

export interface RawConfig {
  /** File text, or null when absent. */
  text: string | null;
  revision: string;
}

export function revisionOf(text: string | null): string {
  return text === null ? ABSENT : createHash("sha256").update(text).digest("hex");
}

export function readRaw(path = userConfigPath()): RawConfig {
  let text: string | null = null;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = null;
  }
  return { text, revision: revisionOf(text) };
}

/** Parsed object of the current file ({} when absent or unparseable). */
function parseForMerge(text: string | null): Record<string, unknown> {
  if (text === null) return {};
  try {
    const v = safeParse(text, () => {});
    return isObj(v) ? { ...v } : {};
  } catch {
    return {};
  }
}

export class StaleRevisionError extends Error {
  constructor(readonly current: string) {
    super("stale-revision");
  }
}

/**
 * Re-read, check `baseRevision` (when given), apply `mutate` to the parsed
 * object, and write atomically. Returns the new revision.
 */
export function mergeWrite(
  mutate: (doc: Record<string, unknown>) => void,
  baseRevision?: string,
  path = userConfigPath(),
): string {
  const cur = readRaw(path);
  if (baseRevision !== undefined && baseRevision !== cur.revision) throw new StaleRevisionError(cur.revision);
  const doc = parseForMerge(cur.text);
  mutate(doc);
  doc.version = 1;
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  atomicWrite0600(path, text);
  return revisionOf(text);
}
