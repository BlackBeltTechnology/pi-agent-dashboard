/**
 * Read/write helpers for pi `settings.json` `packages[]` entries, shared by the
 * catalog (entry state), the combined toggle (rewrite + restore) and the
 * folder scan. An entry is a source string or `{ source, extensions?, skills?,
 * prompts?, themes?, autoload? }`.
 *
 * See change: addons-hub-feature-catalog (design D4, D7, D11).
 */
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { packageIdentity } from "../pi/resource-origin.js";

export type SettingsRead =
  | { ok: true; raw: string | undefined; json: Record<string, unknown>; packages: unknown[] }
  | { ok: false; error: string };

const RESOURCE_KEYS = ["extensions", "skills", "prompts", "themes"] as const;

/** Read + parse; a missing/empty file is `{}`; unparseable is `ok:false`. */
export function readSettingsFile(file: string): SettingsRead {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, raw: undefined, json: {}, packages: [] };
    return { ok: false, error: (err as Error).message };
  }
  if (raw.trim() === "") return { ok: true, raw, json: {}, packages: [] };
  try {
    const json = JSON.parse(raw);
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("not a JSON object");
    const packages = Array.isArray(json.packages) ? json.packages : [];
    return { ok: true, raw, json, packages };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function entrySource(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && typeof (entry as { source?: unknown }).source === "string") {
    return (entry as { source: string }).source;
  }
  return undefined;
}

/** Object entry whose four resource arrays are all `[]` (loads nothing). */
export function isAllEmptyFilter(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  return RESOURCE_KEYS.every((k) => Array.isArray(e[k]) && (e[k] as unknown[]).length === 0);
}

/** The off form of an entry: keep unrelated keys, empty the four resource arrays. */
export function filteredEntry(entry: unknown): Record<string, unknown> {
  const base: Record<string, unknown> =
    typeof entry === "string" ? { source: entry } : { ...(entry as Record<string, unknown>) };
  for (const k of RESOURCE_KEYS) base[k] = [];
  return base;
}

/** JSON-value equality (key order irrelevant; the settings writer does not preserve formatting). */
export function entriesEqual(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a, b);
}

/** Indices of `packages[]` entries whose identity equals `identity`. */
export function entryIndicesFor(packages: readonly unknown[], identity: string, baseDir: string): number[] {
  const out: number[] = [];
  packages.forEach((e, i) => {
    const src = entrySource(e);
    if (src && packageIdentity(src, baseDir) === identity) out.push(i);
  });
  return out;
}

/** Atomic write (tmp + rename). Throws on failure. */
export function writeSettingsText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function serializeSettings(json: Record<string, unknown>): string {
  return `${JSON.stringify(json, null, 2)}\n`;
}

/**
 * Per known folder, the package identities its own `.pi/settings.json` keeps
 * loading: entries with `autoload: false` (a filtering delta) and all-empty
 * filter entries do not load. Local sources resolve against the folder's `.pi`
 * dir. Read-only; unparseable files are skipped. One read per folder, however
 * many identities the caller matches afterwards.
 */
/** Identity an entry loads in a folder, or undefined when it loads nothing (autoload:false / all-empty). */
function loadedIdentity(entry: unknown, piDir: string): string | undefined {
	const src = entrySource(entry);
	if (!src) return undefined;
	if (entry && typeof entry === "object" && (entry as { autoload?: unknown }).autoload === false) return undefined;
	if (isAllEmptyFilter(entry)) return undefined;
	return packageIdentity(src, piDir);
}

export function scanFolderIdentities(directories: readonly string[]): Array<{ dir: string; identities: Set<string> }> {
	const out: Array<{ dir: string; identities: Set<string> }> = [];
	for (const dir of directories) {
		const piDir = path.join(dir, ".pi");
		const read = readSettingsFile(path.join(piDir, "settings.json"));
		if (!read.ok) continue;
		const identities = new Set<string>();
		for (const e of read.packages) {
			const id = loadedIdentity(e, piDir);
			if (id) identities.add(id);
		}
		if (identities.size > 0) out.push({ dir, identities });
	}
	return out;
}
