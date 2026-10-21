/**
 * Worker-safe, filesystem-only status of the dashboard-managed OpenSpec
 * workflow schema `pi-spec-driven`: config read, stamp parse + component-wise
 * comparison, schema resolution, change enumeration and `.openspec.yaml`
 * stats. Never spawns the CLI and imports no CLI recipe, semaphore or
 * `workflow-schema.ts`, so the poll worker can load it cheaply.
 *
 * `workflow-schema.ts` imports these helpers back (generation, actions, REST),
 * so the poll path and the writing path share one implementation.
 *
 * See changes: add-pi-spec-driven-schema, move-workflow-schema-status-to-poll-worker.
 */
import crypto from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { mapLimit } from "@blackbelt-technology/pi-dashboard-shared/openspec-status-all.js";
import type {
  OpenSpecWorkflowSchemaStatus,
  WorkflowSchemaGenerated,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import semver from "semver";
import YAML from "yaml";

export const CURRENT_PATCH = 1;
export const WORKFLOW_SCHEMA_NAME = "pi-spec-driven";
export const STAMP_KEY = "x-pi-dashboard";
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Max in-flight `.openspec.yaml` reads per status computation. */
const CHANGE_READ_LIMIT = 16;

// ── Small helpers ───────────────────────────────────────────────────────────

export function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

export function isKebabCaseName(name: unknown): name is string {
  return typeof name === "string" && KEBAB.test(name);
}

export async function lstatOrNull(p: string): Promise<Stats | null> {
  try {
    return await fsp.lstat(p);
  } catch {
    return null;
  }
}

export const schemasDirOf = (root: string): string => path.join(root, "openspec", "schemas");
export const schemaDirOf = (root: string): string => path.join(schemasDirOf(root), WORKFLOW_SCHEMA_NAME);
export const changesDirOf = (root: string): string => path.join(root, "openspec", "changes");

// ── Fingerprint, stamp, comparison ──────────────────────────────────────────

/** sha256 over every file's relative path + content hash (symlinks by target). `null` when `dir` is absent. */
export async function fingerprintDir(dir: string): Promise<string | null> {
  if (!(await lstatOrNull(dir))) return null;
  const lines: string[] = [];
  const walk = async (d: string): Promise<void> => {
    const entries = (await fsp.readdir(d, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      const full = path.join(d, e.name);
      const r = path.relative(dir, full).split(path.sep).join("/");
      if (e.isDirectory()) {
        lines.push(`${r}/`);
        await walk(full);
      } else if (e.isSymbolicLink()) {
        lines.push(`${r}\0L:${await fsp.readlink(full)}`);
      } else {
        lines.push(`${r}\0${crypto.createHash("sha256").update(await fsp.readFile(full)).digest("hex")}`);
      }
    }
  };
  await walk(dir);
  return crypto.createHash("sha256").update(lines.join("\n")).digest("hex");
}

export interface WorkflowSchemaStamp {
  /** Version of the CLI that generated the schema (`spec-driven@<base>`). */
  base: string;
  patch: number;
  /** Syntactically valid previous default, else `null` (treated as absent). */
  previousDefault: string | null;
}

export function parseStamp(yamlText: string): WorkflowSchemaStamp | null {
  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlText);
  } catch {
    return null;
  }
  const raw = (parsed as Record<string, unknown> | null)?.[STAMP_KEY];
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const m = typeof s.derivedFrom === "string" ? /^spec-driven@(.+)$/.exec(s.derivedFrom) : null;
  if (!m || !semver.valid(m[1])) return null;
  if (typeof s.patch !== "number" || !Number.isInteger(s.patch) || s.patch < 0) return null;
  const prev = isKebabCaseName(s.previousDefault) && s.previousDefault !== WORKFLOW_SCHEMA_NAME ? s.previousDefault : null;
  return { base: m[1], patch: s.patch, previousDefault: prev };
}

export type StampComparison = "current" | "outdated" | "newer" | "conflict";

/** Component-wise: base by semver, patch numerically. Never lexicographic. */
export function compareStamp(
  stamp: { base: string; patch: number },
  local: { base: string; patch: number },
): StampComparison {
  const base = semver.compare(stamp.base, local.base);
  const patch = Math.sign(stamp.patch - local.patch);
  const newer = base > 0 || patch > 0;
  const older = base < 0 || patch < 0;
  if (newer && older) return "conflict";
  if (newer) return "newer";
  if (older) return "outdated";
  return "current";
}

export interface SchemaInspection {
  generated: WorkflowSchemaGenerated;
  stamp: WorkflowSchemaStamp | null;
  /** Whole-directory fingerprint; `null` when the dir is absent, a symlink, or (`"when-needed"`) not required. */
  fingerprint: string | null;
  symlink: boolean;
}

export interface InspectOptions {
  /** Version of the resolved CLI. */
  localVersion: string;
  /**
   * `"full"` (default): always compute the whole-directory fingerprint; an
   * unreadable one makes the schema `unmanaged` (writing actions rely on it).
   * `"when-needed"`: classify from the stamp alone and fingerprint only for
   * `newer` / `conflict` (the poll hot path).
   */
  fingerprint?: "full" | "when-needed";
  /** Injectable fingerprint function (default `fingerprintDir`); lets tests count calls. */
  fingerprintFn?: (dir: string) => Promise<string | null>;
}

const unmanaged = (fingerprint: string | null = null, symlink = false): SchemaInspection => ({
  generated: "unmanaged",
  stamp: null,
  fingerprint,
  symlink,
});

/** Stamp of a managed schema directory; `null` for a non-directory or an unreadable / unparseable `schema.yaml`. */
async function readStamp(dir: string, st: Stats): Promise<WorkflowSchemaStamp | null> {
  if (!st.isDirectory()) return null;
  try {
    return parseStamp(await fsp.readFile(path.join(dir, "schema.yaml"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Filesystem-only status of `<root>/openspec/schemas/pi-spec-driven`, decided
 * from the stamp first. No CLI spawn; the `newer`/`conflict` local
 * `schema validate` is the caller's job (see `fingerprint` in the result).
 */
export async function inspectSchema(root: string, opts: InspectOptions): Promise<SchemaInspection> {
  const dir = schemaDirOf(root);
  const full = opts.fingerprint !== "when-needed";
  const fingerprintOf = (opts.fingerprintFn ?? fingerprintDir) as (d: string) => Promise<string | null>;
  const st = await lstatOrNull(dir);
  if (!st) return { generated: "none", stamp: null, fingerprint: null, symlink: false };
  if (st.isSymbolicLink()) return unmanaged(null, true);
  const stamp = await readStamp(dir, st);
  if (!stamp) return unmanaged(full && st.isDirectory() ? await fingerprintOf(dir).catch(() => null) : null);

  let fingerprint: string | null = null;
  if (full) {
    fingerprint = await fingerprintOf(dir).catch(() => null);
    if (!fingerprint) return unmanaged();
  }
  return judgeStamp(dir, stamp, fingerprint, opts, fingerprintOf);
}

/** Compare a parsed stamp with the local CLI; in `"when-needed"` mode fingerprint only for `newer` / `conflict`. */
async function judgeStamp(
  dir: string,
  stamp: WorkflowSchemaStamp,
  fingerprintIn: string | null,
  opts: InspectOptions,
  fingerprintOf: (d: string) => Promise<string | null>,
): Promise<SchemaInspection> {
  const localBase = semver.valid(opts.localVersion);
  if (!localBase) return { generated: "incompatible", stamp, fingerprint: fingerprintIn, symlink: false };
  const generated: WorkflowSchemaGenerated = compareStamp(stamp, { base: localBase, patch: CURRENT_PATCH });
  let fingerprint = fingerprintIn;
  if (opts.fingerprint === "when-needed" && (generated === "newer" || generated === "conflict")) {
    fingerprint = await fingerprintOf(dir).catch(() => null);
    // No fingerprint → no validate can be keyed.
    if (!fingerprint) return unmanaged();
  }
  return { generated, stamp, fingerprint, symlink: false };
}

// ── Config + change enumeration ─────────────────────────────────────────────

export interface ConfigFile {
  path: string;
  doc: YAML.Document;
  /** `schema:` value; `null` when the key is absent. */
  configured: string | null;
}

/** `config.yaml` wins over `config.yml`, as the CLI reads. `null` when neither exists; throws on unparseable YAML / non-string `schema`. */
export async function readConfigFile(root: string): Promise<ConfigFile | null> {
  for (const name of ["config.yaml", "config.yml"]) {
    const p = path.join(root, "openspec", name);
    let text: string;
    try {
      text = await fsp.readFile(p, "utf8");
    } catch (err) {
      if (errCode(err) === "ENOENT") continue;
      throw err;
    }
    const doc = YAML.parseDocument(text);
    if (doc.errors.length > 0) throw new Error(`${name} is not valid YAML: ${doc.errors[0].message}`);
    const v: unknown = doc.get("schema");
    if (v != null && typeof v !== "string") throw new Error(`${name} has a non-string \`schema:\``);
    return { path: p, doc, configured: typeof v === "string" ? v : null };
  }
  return null;
}

/** Active changes as OpenSpec enumerates them: real directories only, no `archive/`, no dot-dirs, no symlinks. Sorted. */
export async function enumerateActiveChanges(root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(changesDirOf(root), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.isSymbolicLink() && e.name !== "archive" && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

/** `schema:` of `<dir>/.openspec.yaml`: `undefined` = no file, `null` = file without a usable `schema:`. */
export async function readChangeSchema(dir: string): Promise<string | null | undefined> {
  let text: string;
  try {
    text = await fsp.readFile(path.join(dir, ".openspec.yaml"), "utf8");
  } catch {
    return undefined;
  }
  try {
    const v = (YAML.parse(text) as Record<string, unknown> | null)?.schema;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Project-authored schema names under `<cwd>/openspec/schemas/`: real
 * directories only (no symlinks), excluding dot-prefixed staging dirs,
 * `*.fork-*` backups and the managed `pi-spec-driven`; sorted.
 */
async function listProjectSchemas(cwd: string): Promise<string[]> {
  const dir = schemasDirOf(cwd);
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const kept = await Promise.all(
    names.map(async (name) => {
      if (name.startsWith(".") || name.includes(".fork-") || name === WORKFLOW_SCHEMA_NAME) return null;
      const st = await lstatOrNull(path.join(dir, name));
      return st?.isDirectory() ? name : null;
    }),
  );
  return kept.filter((n): n is string => n !== null).sort();
}

// ── Status assembly ─────────────────────────────────────────────────────────

export interface SchemaStatusOptions extends InspectOptions {
  /** `<openspec package>/schemas`; `null` = unknown (the schema is then never reported missing). A function is resolved lazily, only when the config names a schema. */
  packageSchemasDir: string | null | (() => Promise<string | null>);
  /** User-level schemas dir. Required: this module never resolves it itself. */
  userSchemasDirPath: string;
}

/** `OpenSpecData.workflowSchema` plus the fingerprint a `newer`/`conflict` stamp still has to be validated against. */
export interface SchemaStatusResult {
  status: OpenSpecWorkflowSchemaStatus;
  /** Set only when `status.generated` is `newer` or `conflict`: the main thread runs `schema validate` for it. */
  validateFingerprint?: string;
}

/**
 * Status from files + the stamp. See "Workflow schema status is reported
 * separately from readiness". Runs on the poll hot path, so the independent
 * filesystem reads are issued concurrently and the per-change
 * `.openspec.yaml` reads are bounded.
 */
export async function computeSchemaStatus(cwd: string, opts: SchemaStatusOptions): Promise<SchemaStatusResult> {
  const configuredP = readConfigFile(cwd).then(
    (c) => c?.configured ?? null,
    () => null,
  );
  const inspectP = inspectSchema(cwd, opts);
  const missingP = configuredP.then(async (configured) => {
    if (configured === null) return false;
    const pkgDir = typeof opts.packageSchemasDir === "function" ? await opts.packageSchemasDir() : opts.packageSchemasDir;
    if (pkgDir === null) return false;
    const dirs = [schemasDirOf(cwd), opts.userSchemasDirPath, pkgDir];
    const found = await Promise.all(dirs.map(async (d) => !!(await lstatOrNull(path.join(d, configured, "schema.yaml")))));
    return !found.some(Boolean);
  });
  const pinsP = enumerateActiveChanges(cwd).then((names) =>
    mapLimit(names, CHANGE_READ_LIMIT, async (name) => ({
      name,
      pinned: await readChangeSchema(path.join(changesDirOf(cwd), name)),
    })),
  );
  const [configured, inspection, missing, pins, projectSchemas] = await Promise.all([
    configuredP,
    inspectP,
    missingP,
    pinsP,
    listProjectSchemas(cwd),
  ]);

  const unpinnedChanges: string[] = [];
  const affectedChanges: string[] = [];
  for (const { name, pinned } of pins) {
    if (pinned === undefined) {
      if (configured === WORKFLOW_SCHEMA_NAME) {
        unpinnedChanges.push(name);
        affectedChanges.push(name);
      }
    } else if (pinned === WORKFLOW_SCHEMA_NAME) {
      affectedChanges.push(name);
    }
  }
  const status: OpenSpecWorkflowSchemaStatus = {
    configured,
    generated: inspection.generated,
    missing,
    unpinnedChanges,
    affectedChanges,
    projectSchemas,
  };
  const needsValidate = inspection.generated === "newer" || inspection.generated === "conflict";
  return needsValidate && inspection.fingerprint
    ? { status, validateFingerprint: inspection.fingerprint }
    : { status };
}
