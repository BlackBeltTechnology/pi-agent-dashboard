/**
 * Project egress grants for restricted live previews:
 * `~/.pi/dashboard/preview-egress.json` → `{ [projectKey]: string[] }` (canonical
 * https origins). Its own file under `auth/locked-json-file.ts`, NOT `config.json`,
 * so a grant can never race `writeConfigPartial`, and never a repository file.
 *
 * - Reads are side-effect free and cheap (stat-validated cache): a missing or
 *   malformed file reads as empty and is never rewritten by a read, so a grant or
 *   revoke applies to the NEXT CSP build without a restart.
 * - Writes take the file lock around one synchronous read-modify-write; a corrupt
 *   file is byte-copied aside by the checked read and the write refuses when that
 *   backup could not be made.
 * - `PI_PREVIEW_EGRESS_STORE` overrides the path (tests).
 *
 * See change: improve-canvas-html-and-url-ux (design D7).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalHttpsOrigin } from "@blackbelt-technology/pi-dashboard-shared/preview-egress.js";
import {
  corruptUnbackedRefusal,
  readJsonChecked,
  tryReadJson,
  withLockedJsonFile,
  writeJsonAtomic,
} from "../auth/locked-json-file.js";

const LOG_TAG = "preview-egress";
/** Bounds: grants per project, projects overall (a hand-edited file cannot inflate the CSP). */
const MAX_ORIGINS_PER_PROJECT = 64;
const MAX_PROJECTS = 256;

export interface PreviewEgressRow {
  project: string;
  origin: string;
}

/** Where the store lives (read at call time so a test can redirect it). */
export function previewEgressStorePath(): string {
  return process.env.PI_PREVIEW_EGRESS_STORE || path.join(os.homedir(), ".pi", "dashboard", "preview-egress.json");
}

/** Keep only canonical https origins, de-duplicated, bounded. */
function cleanOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") continue;
    const canon = canonicalHttpsOrigin(v);
    if (canon === v) out.add(canon);
    if (out.size >= MAX_ORIGINS_PER_PROJECT) break;
  }
  return [...out];
}

function cleanDoc(doc: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let n = 0;
  for (const [project, origins] of Object.entries(doc)) {
    if (!path.isAbsolute(project)) continue;
    const list = cleanOrigins(origins);
    if (list.length === 0) continue;
    out[project] = list;
    if (++n >= MAX_PROJECTS) break;
  }
  return out;
}

let cache: { file: string; mtimeMs: number; size: number; ino: number; doc: Record<string, string[]> } | null = null;

/** Forget the stat cache (tests / after an in-process write). */
export function resetPreviewEgressCache(): void {
  cache = null;
}

/** Every project's grants. Never throws, never creates or rewrites the file. */
export function readPreviewEgressGrants(): Record<string, string[]> {
  const file = previewEgressStorePath();
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    cache = null;
    return {};
  }
  if (cache && cache.file === file && cache.mtimeMs === st.mtimeMs && cache.size === st.size && cache.ino === st.ino) return cache.doc;
  let doc: Record<string, string[]> = {};
  try {
    const read = tryReadJson(file);
    if (read.ok) doc = cleanDoc(read.data as Record<string, unknown>);
  } catch {
    doc = {};
  }
  cache = { file, mtimeMs: st.mtimeMs, size: st.size, ino: st.ino, doc };
  return doc;
}

/** The origins granted for one project (a copy). */
export function projectEgressGrants(projectKey: string): string[] {
  return [...(readPreviewEgressGrants()[projectKey] ?? [])];
}

/** Flat list for the Access surface, project-then-origin ordered. */
export function listPreviewEgressRows(): PreviewEgressRow[] {
  const rows: PreviewEgressRow[] = [];
  for (const [project, origins] of Object.entries(readPreviewEgressGrants())) {
    for (const origin of origins) rows.push({ project, origin });
  }
  return rows.sort((a, b) => (a.project === b.project ? a.origin.localeCompare(b.origin) : a.project.localeCompare(b.project)));
}

/** Locked read-modify-write; `mutate` returns the new list for `project` (or `null` for "no change"). */
async function update(
  project: string,
  mutate: (current: string[]) => string[] | null,
): Promise<{ changed: boolean }> {
  const file = previewEgressStorePath();
  const result = await withLockedJsonFile(
    file,
    () => {
      const read = readJsonChecked(file, LOG_TAG);
      if (read.corrupt && !read.quarantined) throw corruptUnbackedRefusal(file);
      const doc = cleanDoc(read.data as Record<string, unknown>);
      const next = mutate(doc[project] ?? []);
      if (next === null) return { changed: false };
      if (next.length === 0) delete doc[project];
      else doc[project] = next;
      writeJsonAtomic(file, doc);
      return { changed: true };
    },
    { logTag: LOG_TAG, createIfMissing: false },
  );
  resetPreviewEgressCache();
  return result;
}

/** Grant `origin` (canonical https) for `project` (an absolute project key). Idempotent. */
export async function addPreviewEgressGrant(project: string, origin: string): Promise<{ changed: boolean }> {
  if (!path.isAbsolute(project) || canonicalHttpsOrigin(origin) !== origin) {
    throw new Error("invalid preview-egress grant");
  }
  return update(project, (current) => {
    if (current.includes(origin)) return null;
    if (current.length >= MAX_ORIGINS_PER_PROJECT) throw new Error("too many preview-egress grants for this project");
    return [...current, origin];
  });
}

/** Revoke one grant. Resolves `changed:false` when it was not present. */
export async function revokePreviewEgressGrant(project: string, origin: string): Promise<{ changed: boolean }> {
  return update(project, (current) => (current.includes(origin) ? current.filter((o) => o !== origin) : null));
}
