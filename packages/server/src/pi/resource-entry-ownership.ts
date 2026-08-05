/**
 * Ownership record for the plain settings entries this dashboard writes.
 *
 * Disabling a global-loose resource at project scope re-declares the resource's
 * own file as a plain entry in `<cwd>/.pi/settings.json`. Re-enabling must
 * remove that entry — but only when the dashboard wrote it, since a
 * hand-authored entry is byte-identical and removing it would destroy a user's
 * deliberate declaration.
 *
 * The record deliberately does NOT live in the settings file (design D10):
 * pi's `SettingsManager` has no writer for an unknown key, so recording there
 * would mean two non-atomic writers on one file per toggle, and would put
 * dashboard-private notation into a git-tracked file this change promises to
 * keep pi-standard. Ownership is also a machine-local fact — whether *this*
 * dashboard added an entry is not something to share with the team.
 *
 * Stored alongside `worktree-init-trust.json` under `~/.pi/dashboard/`, written
 * atomically (tmp + rename) so a crash mid-write cannot truncate it.
 *
 * See change: project-scope-disable-global-resources.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

export type OwnedArrayKey = "extensions" | "skills" | "prompts" | "themes";

/** `<resolved project path>` → resource type → entry strings this dashboard added. */
type OwnershipMap = Record<string, Partial<Record<OwnedArrayKey, string[]>>>;

function storePath(): string {
  return path.join(getDashboardConfigDir(), "resource-entry-ownership.json");
}

function projectKey(cwd: string): string {
  return path.resolve(cwd);
}

function load(): OwnershipMap {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as OwnershipMap;
  } catch {
    /* missing / malformed → empty */
  }
  return {};
}

let tmpCounter = 0;

/** `false` when the record could not be persisted — callers must not assume it landed. */
function save(map: OwnershipMap): boolean {
  const p = storePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${tmpCounter++}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2), "utf8");
    fs.renameSync(tmp, p);
    return true;
  } catch (err) {
    console.warn(`[resource-entry-ownership] failed to persist: ${(err as Error)?.message}`);
    return false;
  }
}

/** True when this dashboard recorded writing `entry` for `cwd`. */
export function isOwnedEntry(cwd: string, key: OwnedArrayKey, entry: string): boolean {
  return (load()[projectKey(cwd)]?.[key] ?? []).includes(entry);
}

/** Record that this dashboard added `entry`. Idempotent. `false` = not persisted. */
export function recordOwnedEntry(cwd: string, key: OwnedArrayKey, entry: string): boolean {
  const map = load();
  const proj = (map[projectKey(cwd)] ??= {});
  const list = (proj[key] ??= []);
  if (list.includes(entry)) return true;
  list.push(entry);
  return save(map);
}

/** Drop the ownership record for `entry`, pruning empty containers. `false` = not persisted. */
export function clearOwnedEntry(cwd: string, key: OwnedArrayKey, entry: string): boolean {
  const map = load();
  const proj = map[projectKey(cwd)];
  const list = proj?.[key];
  if (!list) return true;
  const next = list.filter((e) => e !== entry);
  if (next.length === list.length) return true;
  if (next.length > 0) proj[key] = next;
  else delete proj[key];
  if (Object.keys(proj).length === 0) delete map[projectKey(cwd)];
  return save(map);
}
