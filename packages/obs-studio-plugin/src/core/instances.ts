/**
 * `<state>/instances.json` — the service ids `pi-obs provision` registered as
 * OBS instances (design D3, D8). The panel accepts `:service` only for a member
 * whose definition still exists; entries without a definition are pruned on
 * every read. Writes are atomic (tmp + rename), file 0600.
 * See change: add-obs-studio-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import { ensureStateDir } from "./paths.js";

export function instancesFile(state: string): string {
  return path.join(state, "instances.json");
}

export function writeJsonAtomic(file: string, value: unknown, mode = 0o600): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.renameSync(tmp, file);
}

function readIds(state: string): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(instancesFile(state), "utf8")) as { instances?: unknown };
    return Array.isArray(raw.instances) ? raw.instances.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Registered ids that still have a definition; prunes the rest from the file. */
export function readInstances(state: string, hasDefinition: (id: string) => boolean): string[] {
  const ids = readIds(state);
  const live = ids.filter(hasDefinition);
  if (live.length !== ids.length) {
    try {
      ensureStateDir(state);
      writeJsonAtomic(instancesFile(state), { instances: live });
    } catch {
      // Pruning is best-effort: a read path never fails because the state dir is read-only.
    }
  }
  return live;
}

export function addInstance(state: string, id: string): void {
  const ids = readIds(state);
  if (ids.includes(id)) return;
  ensureStateDir(state);
  writeJsonAtomic(instancesFile(state), { instances: [...ids, id] });
}
