/**
 * Write a project `id` into `<folder>/.pi/dashboard/project.json` — the scaffold
 * skill's `project-specific` scope. Runs only after the final summary confirm and
 * REFUSES (never prompts, never overwrites) when:
 *   - the file, `.pi` or `.pi/dashboard` is a symlink;
 *   - the file is not a regular file, exceeds 64 KiB, or is not a JSON object;
 *   - `schemaVersion` is present and not 1;
 *   - a different `id` is already declared.
 * Otherwise it creates the file (`schemaVersion: 1`) or merges `id`, adding
 * `schemaVersion: 1` only when absent and keeping every other field. The write is
 * atomic (temp file in the same directory + rename).
 *
 * See change: add-project-scoped-apps.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { IDENTITY_MAX_BYTES, parseDeclaration } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/project-identity.js";
import { PROJECT_NAME_RE } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/project-markers.js";

export type WriteProjectIdResult =
  | { ok: true; path: string; created: boolean; changed: boolean }
  | { ok: false; reason: string };

/** Test seam: the one step whose failure must leave the original untouched. */
export interface WriteProjectIdDeps {
  rename?: (from: string, to: string) => void;
}

const refuse = (reason: string): WriteProjectIdResult => ({ ok: false, reason });

function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

/** Refusal reason when `.pi` / `.pi/dashboard` is a symlink or not a directory; `null` when fine or absent. */
function dirRefusal(dir: string): string | null {
  const st = lstatOrNull(dir);
  if (!st) return null;
  if (st.isSymbolicLink()) return `${dir} is a symbolic link`;
  return st.isDirectory() ? null : `${dir} is not a directory`;
}

function isExistingDir(folder: string): boolean {
  const st = lstatOrNull(folder);
  if (!st) return false;
  return st.isDirectory() || (st.isSymbolicLink() && !!fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory());
}

type Plan = { kind: "refuse"; reason: string } | { kind: "noop" } | { kind: "write"; next: Record<string, unknown> };

/** Decide what to do with an existing file (never touches the disk). */
function planExisting(file: string, stat: fs.Stats, id: string): Plan {
  if (stat.isSymbolicLink()) return { kind: "refuse", reason: `${file} is a symbolic link` };
  if (!stat.isFile()) return { kind: "refuse", reason: `${file} is not a regular file` };
  if (stat.size > IDENTITY_MAX_BYTES) return { kind: "refuse", reason: `${file} is larger than ${IDENTITY_MAX_BYTES} bytes` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { kind: "refuse", reason: `${file} is not valid JSON` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "refuse", reason: `${file} is not a JSON object` };
  }
  const obj = parsed as Record<string, unknown>;
  const hasVersion = Object.hasOwn(obj, "schemaVersion");
  if (hasVersion && obj.schemaVersion !== 1) {
    return { kind: "refuse", reason: `${file} has schemaVersion ${JSON.stringify(obj.schemaVersion)} (only 1 is supported)` };
  }
  if (Object.hasOwn(obj, "id")) {
    if (obj.id === id) return { kind: "noop" };
    return { kind: "refuse", reason: `${file} already declares id ${JSON.stringify(obj.id)}; change it by hand` };
  }
  return { kind: "write", next: hasVersion ? { ...obj, id } : { schemaVersion: 1, ...obj, id } };
}

/** Temp file in the same directory + rename; the temp file never survives a failure. */
function atomicWrite(dashDir: string, file: string, body: string, rename: (from: string, to: string) => void): string | null {
  const tmp = path.join(dashDir, `.project.json.${process.pid}.${Date.now().toString(36)}.tmp`);
  try {
    fs.mkdirSync(dashDir, { recursive: true });
    fs.writeFileSync(tmp, body, { flag: "wx", mode: 0o644 });
    rename(tmp, file);
    return null;
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    return `write failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function writeProjectId(folder: string, id: string, deps: WriteProjectIdDeps = {}): WriteProjectIdResult {
  if (!PROJECT_NAME_RE.test(id)) return refuse(`id "${id}" must match ${PROJECT_NAME_RE.source}`);
  if (!path.isAbsolute(folder)) return refuse(`folder "${folder}" must be an absolute path`);
  if (!isExistingDir(folder)) return refuse(`folder "${folder}" is not an existing directory`);

  const piDir = path.join(folder, ".pi");
  const dashDir = path.join(piDir, "dashboard");
  const file = path.join(dashDir, "project.json");
  const dirProblem = dirRefusal(piDir) ?? dirRefusal(dashDir);
  if (dirProblem) return refuse(dirProblem);

  const existing = lstatOrNull(file);
  const plan: Plan = existing ? planExisting(file, existing, id) : { kind: "write", next: { schemaVersion: 1, id } };
  if (plan.kind === "refuse") return refuse(plan.reason);
  if (plan.kind === "noop") return { ok: true, path: file, created: false, changed: false };

  const body = `${JSON.stringify(plan.next, null, 2)}\n`;
  // The identity reader must accept exactly what is written.
  if (parseDeclaration(body)?.id !== id) return refuse("the resulting file would not be accepted by the identity reader");
  const failure = atomicWrite(dashDir, file, body, deps.rename ?? fs.renameSync);
  return failure ? refuse(failure) : { ok: true, path: file, created: !existing, changed: true };
}
