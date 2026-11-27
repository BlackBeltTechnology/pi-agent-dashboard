/**
 * `openspec/groups/groups.json` for the group profile (design D3, spec "Group membership and order" and
 * "groups.json validity"). Read ONLY as a bounded regular file under the lead cwd (never through a symlink):
 *  - missing file ⇒ `group_unknown`; invalid JSON, a BOM, an unknown `schemaVersion`, duplicate ids or wrong
 *    field types, an oversize or non-regular file ⇒ `groups_invalid`;
 *  - the goal resolves by group id (case-sensitive) first, else by case-insensitive name (`group_unknown`,
 *    `group_ambiguous`);
 *  - membership = changes with `assignments[change] === group.id` whose directory `openspec/changes/<change>/`
 *    is a real directory; order = the persisted `changeOrder[group.id]` members, then the rest by name in
 *    code-point order (ship-batch also ranks by status; the team has no status data: deliberate difference).
 * See change: add-agent-teams-openspec.
 */
import { readGroupsFile, resolveChangeDir } from "./inputs.js";

const GROUPS_SCHEMA_VERSION = 1;

export interface GroupEntry {
  id: string;
  name: string;
}

export interface GroupsDoc {
  groups: GroupEntry[];
  assignments: Record<string, string>;
  changeOrder: Record<string, string[]>;
}

export type GroupsRead = { ok: true; doc: GroupsDoc } | { ok: false; code: "group_unknown" | "groups_invalid"; message: string };

const invalid = (message: string): GroupsRead => ({ ok: false, code: "groups_invalid", message });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse and validate the file. Never throws. */
export function loadGroups(repo: string): GroupsRead {
  const read = readGroupsFile(repo);
  if (!read.ok) return read.code === "absent" ? { ok: false, code: "group_unknown", message: "openspec/groups/groups.json does not exist" } : invalid(`groups.json is not a readable regular file (${read.code})`);
  let raw: unknown;
  try {
    raw = JSON.parse(read.text);
  } catch {
    return invalid("groups.json is not valid JSON");
  }
  if (!isRecord(raw)) return invalid("groups.json is not an object");
  if (raw.schemaVersion !== GROUPS_SCHEMA_VERSION) return invalid("groups.json has an unknown schemaVersion");
  if (!Array.isArray(raw.groups)) return invalid("groups is not an array");
  const groups: GroupEntry[] = [];
  const ids = new Set<string>();
  for (const g of raw.groups) {
    if (!isRecord(g) || typeof g.id !== "string" || g.id === "" || typeof g.name !== "string") return invalid("a group needs a string id and name");
    if (ids.has(g.id)) return invalid("duplicate group id");
    ids.add(g.id);
    groups.push({ id: g.id, name: g.name });
  }
  const assignments: Record<string, string> = {};
  if (raw.assignments !== undefined) {
    if (!isRecord(raw.assignments)) return invalid("assignments is not an object");
    for (const [change, gid] of Object.entries(raw.assignments)) {
      if (typeof gid !== "string") return invalid("an assignment value is not a string");
      assignments[change] = gid;
    }
  }
  const changeOrder: Record<string, string[]> = {};
  if (raw.changeOrder !== undefined) {
    if (!isRecord(raw.changeOrder)) return invalid("changeOrder is not an object");
    for (const [gid, list] of Object.entries(raw.changeOrder)) {
      if (!Array.isArray(list) || list.some((c) => typeof c !== "string")) return invalid("a changeOrder value is not an array of strings");
      changeOrder[gid] = list as string[];
    }
  }
  return { ok: true, doc: { groups, assignments, changeOrder } };
}

export type GroupResolution = { ok: true; group: GroupEntry } | { ok: false; code: "group_unknown" | "group_ambiguous"; message: string };

/** Id (case-sensitive) first, else the case-insensitive name; two equal names are ambiguous. */
export function resolveGroup(doc: GroupsDoc, goal: string): GroupResolution {
  const byId = doc.groups.find((g) => g.id === goal);
  if (byId) return { ok: true, group: byId };
  const wanted = goal.toLowerCase();
  const byName = doc.groups.filter((g) => g.name.toLowerCase() === wanted);
  if (byName.length === 1) return { ok: true, group: byName[0] as GroupEntry };
  if (byName.length > 1) return { ok: false, code: "group_ambiguous", message: "several groups share that name; use the group id" };
  return { ok: false, code: "group_unknown", message: "no group has that id or name" };
}

export interface Membership {
  /** In launch order. */
  included: string[];
  /** Assigned to the group but not startable (archived / absent / unsafe directory). */
  skipped: Array<{ change: string; reason: "no_active_directory" | "unsafe_directory" }>;
}

const codePointOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function groupMembership(repo: string, doc: GroupsDoc, group: GroupEntry): Membership {
  const assigned = [...new Set(Object.entries(doc.assignments).filter(([, gid]) => gid === group.id).map(([change]) => change))];
  const present = new Set<string>();
  const skipped: Membership["skipped"] = [];
  for (const change of assigned.sort(codePointOrder)) {
    const dir = resolveChangeDir(repo, change);
    if (dir.ok) present.add(change);
    else skipped.push({ change, reason: dir.code === "absent" ? "no_active_directory" : "unsafe_directory" });
  }
  const persisted = [...new Set(doc.changeOrder[group.id] ?? [])].filter((c) => present.has(c));
  const listed = new Set(persisted);
  const rest = [...present].filter((c) => !listed.has(c)).sort(codePointOrder);
  return { included: [...persisted, ...rest], skipped };
}
