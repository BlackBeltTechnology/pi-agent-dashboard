/**
 * Dashboard-managed OpenSpec workflow schema `pi-spec-driven`.
 *
 * Generation (scratch root + empty XDG_DATA_HOME, `schema which/fork/validate`,
 * anchor-checked YAML patch, stamp, staged swap), component-wise stamp
 * comparison, the six writing actions (enable / disable / update / adopt / pin /
 * remove) behind one write guard. The filesystem-only status (stamp, config,
 * change enumeration, `inspectSchema`, `fingerprintDir`) lives in the
 * worker-safe `workflow-schema-status.ts` and is re-exported here; every CLI
 * call goes through the injectable `CliRunner`.
 *
 * See changes: add-pi-spec-driven-schema, move-workflow-schema-status-to-poll-worker.
 */
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  OPENSPEC_SCHEMA_FORK,
  OPENSPEC_SCHEMA_VALIDATE,
  OPENSPEC_SCHEMA_WHICH,
  OPENSPEC_STATUS_ALL,
  OPENSPEC_VERSION,
  userSchemasDir,
} from "@blackbelt-technology/pi-dashboard-shared/platform/openspec.js";
import { type Recipe, runAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/runner.js";
import type { Semaphore } from "@blackbelt-technology/pi-dashboard-shared/semaphore.js";
import type {
  OpenSpecWorkflowSchemaStatus,
  WorkflowSchemaGenerated,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import semver from "semver";
import YAML from "yaml";
import {
  type ConfigFile,
  CURRENT_PATCH,
  changesDirOf,
  compareStamp,
  computeSchemaStatus,
  enumerateActiveChanges,
  errCode,
  fingerprintDir,
  inspectSchema,
  isKebabCaseName,
  lstatOrNull,
  parseStamp,
  readChangeSchema,
  readConfigFile,
  type SchemaInspection,
  type SchemaStatusOptions,
  type StampComparison,
  schemaDirOf,
  schemasDirOf,
  STAMP_KEY,
  WORKFLOW_SCHEMA_NAME,
  type WorkflowSchemaStamp,
} from "./workflow-schema-status.js";

export {
  CURRENT_PATCH,
  compareStamp,
  fingerprintDir,
  inspectSchema,
  parseStamp,
  type SchemaInspection,
  type StampComparison,
  type WorkflowSchemaStamp,
};

const BASE_SCHEMA = "spec-driven";
const DESIGN_ANCHOR = "When to include design.md (create only if any apply):";
const DESIGN_REPLACEMENT =
  'When a full design.md is warranted (otherwise still create design.md containing one line "Not needed: <reason>"):';
const RETRYABLE_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
/** Windows rename retry: initial attempt + 5 retries, delays sum to 1.55 s (< 2 s window). */
const RETRY_DELAYS_MS: readonly number[] = [50, 100, 200, 400, 800];

// ── Dependency injection ────────────────────────────────────────────────────

/** One CLI invocation; stubs switch on `op`. */
export type CliCall =
  | { op: "version" }
  | { op: "which"; name: string }
  | { op: "fork"; source: string; name: string }
  | { op: "validate"; name: string }
  | { op: "statusAll" };

export type CliResult =
  | { ok: true; stdout: string }
  | { ok: false; stdout: string; stderr: string; message: string };

export interface CliCtx {
  cwd: string;
  /** When set, `XDG_DATA_HOME` is pointed at this (empty) dir so no user-level schema is visible. */
  xdgDataHome?: string;
}

export type CliRunner = (call: CliCall, ctx: CliCtx) => Promise<CliResult>;

export interface FsOps {
  rename(from: string, to: string): Promise<void>;
  /** Recursive + force. */
  rm(target: string): Promise<void>;
  /** Recursive directory copy. */
  cp(from: string, to: string): Promise<void>;
  /** Exclusive create (`wx`): throws `EEXIST` if present. */
  writeExclusive(file: string, data: string): Promise<void>;
  /** temp-file + rename. */
  writeAtomic(file: string, data: string): Promise<void>;
}

export interface WorkflowSchemaDeps {
  cli: CliRunner;
  fs: FsOps;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  pid: number;
  platform: NodeJS.Platform;
  random: () => string;
  /** Spawn semaphore for the `newer`/`conflict` validate. Default: pass-through (the route wiring injects the directory-service one). */
  semaphore: Semaphore;
  /** Memo of the local validate keyed by (cwd, fingerprint, CLI version). */
  validateMemo: Map<string, boolean>;
  /** True when `name` resolves from the project schema dir or the package built-ins (never user XDG). */
  resolveSchema: (root: string, name: string) => Promise<boolean>;
  /** Forced OpenSpec refresh after an action that wrote. */
  refresh: (cwd: string) => Promise<void>;
  /** Scratch parent dir. */
  tmpDir: string;
}

function defaultCli(): CliRunner {
  const exec = async <I extends { cwd: string }>(recipe: Recipe<I, string>, input: I, ctx: CliCtx): Promise<CliResult> => {
    const r = await runAsync(recipe, input, {
      cwd: ctx.cwd,
      ...(ctx.xdgDataHome !== undefined ? { env: { XDG_DATA_HOME: ctx.xdgDataHome } } : {}),
    });
    if (r.ok) return { ok: true, stdout: r.value };
    const e = r.error;
    if (e.kind === "exit") return { ok: false, stdout: e.stdout, stderr: e.stderr, message: `exit ${e.code}` };
    if (e.kind === "timeout") return { ok: false, stdout: e.stdout ?? "", stderr: e.stderr ?? "", message: `timed out after ${e.timeoutMs}ms` };
    return { ok: false, stdout: "", stderr: "", message: "message" in e ? e.message : `${e.kind}: ${"binary" in e ? e.binary : ""}` };
  };
  return (call, ctx) => {
    const base = { cwd: ctx.cwd };
    switch (call.op) {
      case "version":
        return exec(OPENSPEC_VERSION, base, ctx);
      case "which":
        return exec(OPENSPEC_SCHEMA_WHICH, { ...base, name: call.name }, ctx);
      case "fork":
        return exec(OPENSPEC_SCHEMA_FORK, { ...base, source: call.source, name: call.name }, ctx);
      case "validate":
        return exec(OPENSPEC_SCHEMA_VALIDATE, { ...base, name: call.name }, ctx);
      case "statusAll":
        return exec(OPENSPEC_STATUS_ALL, base, ctx);
    }
  };
}

function defaultFs(): FsOps {
  return {
    rename: (from, to) => fsp.rename(from, to),
    rm: (target) => fsp.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
    cp: (from, to) => fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false }),
    writeExclusive: (file, data) => fsp.writeFile(file, data, { flag: "wx" }),
    writeAtomic: async (file, data) => {
      const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
      try {
        await fsp.writeFile(tmp, data, { flag: "wx" });
        await fsp.rename(tmp, file);
      } catch (err) {
        await fsp.rm(tmp, { force: true }).catch(() => undefined);
        throw err;
      }
    },
  };
}

const sharedValidateMemo = new Map<string, boolean>();

export function resolveDeps(partial: Partial<WorkflowSchemaDeps> = {}): WorkflowSchemaDeps {
  const cli = partial.cli ?? defaultCli();
  return {
    cli,
    fs: partial.fs ?? defaultFs(),
    sleep: partial.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: partial.now ?? Date.now,
    pid: partial.pid ?? process.pid,
    platform: partial.platform ?? process.platform,
    random: partial.random ?? (() => crypto.randomBytes(4).toString("hex")),
    semaphore: partial.semaphore ?? passThroughSemaphore,
    validateMemo: partial.validateMemo ?? sharedValidateMemo,
    resolveSchema: partial.resolveSchema ?? ((root, name) => defaultResolveSchema(cli, root, name)),
    refresh: partial.refresh ?? (async () => undefined),
    tmpDir: partial.tmpDir ?? os.tmpdir(),
  };
}

const passThroughSemaphore: Semaphore = {
  run: (fn) => fn(),
  setMax: () => undefined,
  size: () => 0,
};

// ── Small helpers ───────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Parse the first JSON object in `stdout` (the CLI prints its "experimental" note on stderr, but be defensive). */
function parseJsonObject(stdout: string): Record<string, unknown> | null {
  const i = stdout.indexOf("{");
  if (i < 0) return null;
  try {
    const v: unknown = JSON.parse(stdout.slice(i));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const rel = (root: string, p: string): string => path.relative(root, p).split(path.sep).join("/");

/** Retry a rename on Windows `EPERM`/`EBUSY`/`EACCES`: 5 retries, 1.55 s of backoff in total. */
async function renameWithRetry(deps: WorkflowSchemaDeps, from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await deps.fs.rename(from, to);
      return;
    } catch (err) {
      const retryable = deps.platform === "win32" && RETRYABLE_CODES.has(errCode(err) ?? "");
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw err;
      await deps.sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

// ── Status with the `newer`/`conflict` validate ─────────────────────────────

async function runValidate(deps: WorkflowSchemaDeps, cwd: string, name: string, xdg?: string): Promise<boolean> {
  const r = await deps.cli({ op: "validate", name }, { cwd, ...(xdg ? { xdgDataHome: xdg } : {}) });
  return r.ok && parseJsonObject(r.stdout)?.valid === true;
}

/**
 * Status for the main thread: `inspectSchema` + the `newer`/`conflict` local
 * `schema validate` through the spawn semaphore, memoized by (cwd,
 * fingerprint, CLI version) so it runs at most once per combination.
 */
export async function evaluateSchemaStatus(
  root: string,
  localVersion: string,
  depsIn: Partial<WorkflowSchemaDeps> = {},
): Promise<WorkflowSchemaGenerated> {
  return (await inspectWithValidate(root, localVersion, resolveDeps(depsIn))).generated;
}

/**
 * The `validateLocal` callback for `inspectSchema` / `computeWorkflowSchemaStatus`:
 * runs `schema validate` through `deps.semaphore`, memoized by (cwd,
 * fingerprint, CLI version) in `deps.validateMemo`.
 */
export function makeValidateLocal(
  root: string,
  localVersion: string,
  depsIn: Partial<WorkflowSchemaDeps> = {},
): (fingerprint: string) => Promise<boolean> {
  const deps = resolveDeps(depsIn);
  return async (fingerprint) => {
    const key = [root, fingerprint, localVersion].join("\0");
    const memo = deps.validateMemo.get(key);
    if (memo !== undefined) return memo;
    const ok = await deps.semaphore.run(() => runValidate(deps, root, WORKFLOW_SCHEMA_NAME));
    if (deps.validateMemo.size > 500) deps.validateMemo.clear();
    deps.validateMemo.set(key, ok);
    return ok;
  };
}

async function inspectWithValidate(
  root: string,
  localVersion: string,
  deps: WorkflowSchemaDeps,
): Promise<SchemaInspection> {
  const info = await inspectSchema(root, { localVersion, fingerprint: "full" });
  if ((info.generated === "newer" || info.generated === "conflict") && info.fingerprint) {
    if (!(await makeValidateLocal(root, localVersion, deps)(info.fingerprint))) return { ...info, generated: "incompatible" };
  }
  return info;
}

export interface ComputeStatusOptions extends Omit<SchemaStatusOptions, "userSchemasDirPath"> {
  /** Default: `userSchemasDir()`. */
  userSchemasDirPath?: string;
  /** CLI part for `newer`/`conflict`: does `schema validate` pass locally? Default: assumed valid. */
  validateLocal?: (fingerprint: string) => Promise<boolean>;
}

/**
 * `OpenSpecData.workflowSchema` with the `newer`/`conflict` verdict applied
 * through `validateLocal`. The poll no longer uses this (the worker computes
 * the fs part, the main thread validates); kept as the single-call form for
 * callers and tests that want the finished status.
 */
export async function computeWorkflowSchemaStatus(
  cwd: string,
  opts: ComputeStatusOptions,
): Promise<OpenSpecWorkflowSchemaStatus> {
  const { validateLocal, userSchemasDirPath, ...rest } = opts;
  const { status, validateFingerprint } = await computeSchemaStatus(cwd, {
    fingerprint: "when-needed",
    ...rest,
    userSchemasDirPath: userSchemasDirPath ?? userSchemasDir(),
  });
  if (validateFingerprint && validateLocal && !(await validateLocal(validateFingerprint))) {
    return { ...status, generated: "incompatible" };
  }
  return status;
}

// ── Patch set (v1 + v2) + stamp ─────────────────────────────────────────────

/** `ok` carries the patched `schema.yaml` text and the template files the patch set adds. */
type PatchResult =
  | { ok: true; text: string; templates: Record<string, string> }
  | { ok: false; error: string };

/** `templates/dependencies.yaml` written by patch v2 (three empty lists, one comment each). */
const DEPENDENCIES_TEMPLATE = `# Changes that must ship before this one. Each entry: \`- change: <name>\` with an optional \`reason: <why>\`.
blocked_by: []
# Changes the dashboard may infer a dependency on that are NOT one (suppresses the inferred edge).
not_blocked_by: []
# Changes that are related but impose no order.
related: []
`;

const DEPENDENCIES_INSTRUCTION = `Declare how this change relates to the OTHER active changes by writing
dependencies.yaml in the change directory (see the template for the format).

Before writing it, inspect the other active changes (\`openspec list\`, then skim the
proposals and delta specs of those that touch the same capabilities, files or APIs):
- blocked_by: changes that must be implemented and shipped before this one. One entry
  per blocker (\`- change: <name>\`), with a short \`reason\` when it is not obvious.
  Use the exact change directory name; do not list this change itself.
- not_blocked_by: a change the dashboard might infer as a blocker (for example because
  it shares a capability) that is NOT one.
- related: changes that are connected but impose no order.

The file is required even when there is nothing to declare: write empty lists
(\`blocked_by: []\`) to state explicitly that no dependencies exist.
`;

/** True when \`node\` is a YAML sequence of exactly the scalar strings \`values\`. */
function isSeqOf(node: unknown, values: string[]): node is YAML.YAMLSeq {
  if (!YAML.isSeq(node) || node.items.length !== values.length) return false;
  return node.items.every((item, i) => YAML.isScalar(item) && item.value === values[i]);
}

/**
 * Comment-preserving patch set + stamp. Patch v1 rewrites the design-instruction
 * anchor line; patch v2 inserts the \`dependencies\` artifact before \`tasks\` and
 * makes \`tasks\` require it. Aborts when an anchor is not found exactly as expected
 * (a stamp never claims an unapplied patch).
 */
function patchAndStampSchemaYaml(
  yamlText: string,
  stamp: { cliVersion: string; previousDefault: string },
): PatchResult {
  const doc = YAML.parseDocument(yamlText);
  if (doc.errors.length > 0) return { ok: false, error: `forked schema.yaml is not valid YAML: ${doc.errors[0].message}` };
  const artifacts = doc.get("artifacts");
  const design = YAML.isSeq(artifacts)
    ? artifacts.items.find((a) => YAML.isMap(a) && a.get("id") === "design")
    : undefined;
  const node = YAML.isMap(design) ? design.get("instruction", true) : undefined;
  if (!YAML.isScalar(node) || typeof node.value !== "string") {
    return { ok: false, error: "patch anchor not found: design artifact has no instruction" };
  }
  const lines = node.value.split("\n");
  const hits = lines.filter((l) => l.trim() === DESIGN_ANCHOR).length;
  if (hits !== 1) {
    return { ok: false, error: `patch anchor not found exactly once (${hits}): "${DESIGN_ANCHOR}"` };
  }

  // Patch v2 anchors: exactly one \`tasks\` artifact whose \`requires\` is [specs, design].
  const items = YAML.isSeq(artifacts) ? artifacts.items : [];
  const taskIdx = items.map((a, i) => (YAML.isMap(a) && a.get("id") === "tasks" ? i : -1)).filter((i) => i >= 0);
  if (!YAML.isSeq(artifacts) || taskIdx.length !== 1) {
    return { ok: false, error: "patch anchor not found: expected exactly one `tasks` artifact" };
  }
  const tasks = items[taskIdx[0]] as YAML.YAMLMap;
  const requires = tasks.get("requires", true);
  if (!isSeqOf(requires, ["specs", "design"])) {
    return { ok: false, error: "patch anchor not found: `tasks.requires` is not exactly [specs, design]" };
  }

  node.value = lines
    .map((l) => (l.trim() === DESIGN_ANCHOR ? l.slice(0, l.indexOf(DESIGN_ANCHOR)) + DESIGN_REPLACEMENT : l))
    .join("\n");

  const instruction = new YAML.Scalar(DEPENDENCIES_INSTRUCTION);
  instruction.type = "BLOCK_LITERAL";
  const dependencies = doc.createNode({
    id: "dependencies",
    generates: "dependencies.yaml",
    description: "Declared dependencies on other active changes",
    template: "dependencies.yaml",
    instruction,
    requires: ["proposal", "specs"],
  });
  artifacts.items.splice(taskIdx[0], 0, dependencies);
  requires.add(doc.createNode("dependencies"));

  doc.set(
    STAMP_KEY,
    doc.createNode({
      derivedFrom: `${BASE_SCHEMA}@${stamp.cliVersion}`,
      patch: CURRENT_PATCH,
      previousDefault: stamp.previousDefault,
    }),
  );
  return { ok: true, text: doc.toString({ lineWidth: 0 }), templates: { "dependencies.yaml": DEPENDENCIES_TEMPLATE } };
}

// ── Generation + staged swap ────────────────────────────────────────────────

export interface GenerateOptions {
  /** Project root (realpath'd by the caller). */
  root: string;
  previousDefault: string;
  /**
   * Whole-directory fingerprint of the existing `pi-spec-driven/` read when its
   * status was read; `null` = expected absent; `undefined` = read it now.
   */
  expectedFingerprint?: string | null;
}

export type GenerateResult =
  | { ok: true; warnings: string[] }
  | { ok: false; error: string };

export async function generateWorkflowSchema(
  opts: GenerateOptions,
  depsIn: Partial<WorkflowSchemaDeps> = {},
): Promise<GenerateResult> {
  const deps = resolveDeps(depsIn);
  const { root, previousDefault } = opts;
  const schemasDir = schemasDirOf(root);
  const target = schemaDirOf(root);
  const scratch = await fsp.mkdtemp(path.join(deps.tmpDir, "pi-wfs-"));
  let staging: string | null = null;
  try {
    const scratchRoot = path.join(scratch, "root");
    const xdg = path.join(scratch, "xdg");
    await fsp.mkdir(path.join(scratchRoot, "openspec", "schemas"), { recursive: true });
    await fsp.mkdir(xdg, { recursive: true });
    const ctx: CliCtx = { cwd: scratchRoot, xdgDataHome: xdg };

    const ver = await deps.cli({ op: "version" }, ctx);
    const cliVersion = ver.ok ? ver.stdout.trim() : "";
    if (!ver.ok || !semver.valid(cliVersion)) return { ok: false, error: "cannot determine the OpenSpec CLI version" };

    const which = await deps.cli({ op: "which", name: BASE_SCHEMA }, ctx);
    const w = parseJsonObject(which.stdout);
    if (!which.ok || !w || w.source !== "package" || !Array.isArray(w.shadows) || w.shadows.length > 0) {
      return { ok: false, error: `base schema "${BASE_SCHEMA}" does not resolve to the package built-in without shadows` };
    }

    const fork = await deps.cli({ op: "fork", source: BASE_SCHEMA, name: WORKFLOW_SCHEMA_NAME }, ctx);
    if (!fork.ok) return { ok: false, error: `schema fork failed: ${fork.message} ${fork.stderr}`.trim() };

    const scratchSchema = path.join(scratchRoot, "openspec", "schemas", WORKFLOW_SCHEMA_NAME);
    const yamlPath = path.join(scratchSchema, "schema.yaml");
    const patched = patchAndStampSchemaYaml(await fsp.readFile(yamlPath, "utf8"), { cliVersion, previousDefault });
    if (!patched.ok) return { ok: false, error: patched.error };
    await fsp.writeFile(yamlPath, patched.text);
    for (const [file, content] of Object.entries(patched.templates)) {
      await fsp.writeFile(path.join(scratchSchema, "templates", file), content);
    }

    if (!(await runValidate(deps, scratchRoot, WORKFLOW_SCHEMA_NAME, xdg))) {
      return { ok: false, error: "generated schema failed `openspec schema validate`" };
    }

    // Copy (not rename): avoids EXDEV across volumes.
    await fsp.mkdir(schemasDir, { recursive: true });
    staging = path.join(schemasDir, `.fork-staging-${deps.random()}`);
    try {
      await deps.fs.cp(scratchSchema, staging);
    } catch (err) {
      await deps.fs.rm(staging).catch(() => undefined);
      staging = null;
      return { ok: false, error: `copying the generated schema failed: ${errMsg(err)}` };
    }

    const expected = opts.expectedFingerprint === undefined ? await fingerprintDir(target) : opts.expectedFingerprint;
    const current = await fingerprintDir(target);
    if (current !== expected) {
      return { ok: false, error: `${rel(root, target)} changed since its status was read; aborting before the swap` };
    }

    const warnings: string[] = [];
    let backup: string | null = null;
    if (current !== null || (await lstatOrNull(target))) {
      backup = path.join(schemasDir, `${WORKFLOW_SCHEMA_NAME}.fork-backup-${deps.pid}-${deps.now()}`);
      try {
        await renameWithRetry(deps, target, backup);
      } catch (err) {
        return { ok: false, error: `could not move the existing schema aside: ${errMsg(err)}` };
      }
    }
    try {
      await renameWithRetry(deps, staging, target);
      staging = null;
    } catch (err) {
      if (backup) {
        try {
          await renameWithRetry(deps, backup, target);
        } catch (restoreErr) {
          return {
            ok: false,
            error: `swap failed (${errMsg(err)}) and the restore failed (${errMsg(restoreErr)}); the previous schema is kept at ${backup}`,
          };
        }
      }
      return { ok: false, error: `swap failed: ${errMsg(err)}` };
    }
    if (backup) {
      try {
        await deps.fs.rm(backup);
      } catch (err) {
        warnings.push(`could not delete the previous schema backup ${backup}: ${errMsg(err)}`);
      }
    }
    return { ok: true, warnings };
  } catch (err) {
    return { ok: false, error: `workflow schema generation failed: ${errMsg(err)}` };
  } finally {
    if (staging) await deps.fs.rm(staging).catch(() => undefined);
    await fsp.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ── Schema-name resolution ──────────────────────────────────────────────────

/** Resolvable from the project dir or the package with an EMPTY `XDG_DATA_HOME` (user-level schemas never count). */
async function defaultResolveSchema(cli: CliRunner, root: string, name: string): Promise<boolean> {
  const xdg = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-wfs-xdg-"));
  try {
    const r = await cli({ op: "which", name }, { cwd: root, xdgDataHome: xdg });
    const w = parseJsonObject(r.stdout);
    return r.ok && (w?.source === "project" || w?.source === "package");
  } catch {
    return false;
  } finally {
    await fsp.rm(xdg, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ── Actions ─────────────────────────────────────────────────────────────────

export type WorkflowSchemaAction = "enable" | "disable" | "update" | "adopt" | "pin" | "remove";

export interface WorkflowSchemaRequest {
  cwd: string;
  action: WorkflowSchemaAction;
  confirm?: boolean;
  pinTo?: string;
  changes?: string[];
  previousDefault?: string;
}

export interface WorkflowSchemaResult {
  ok: boolean;
  status: WorkflowSchemaGenerated;
  configured: string | null;
  /** Paths relative to the project root (forward slashes). */
  written: string[];
  /** Pin: change names left alone. */
  skipped?: string[];
  warnings?: string[];
  worktree: { isWorktree: boolean; branch: string | null };
  error?: string;
  /** A step failed after earlier steps wrote; re-running enable completes it. */
  partial?: boolean;
}

type Verdict = { verdict: "run" } | { verdict: "noop"; reason: string } | { verdict: "refuse"; reason: string };

/** The "Actions are allowed only in defined states" table. `noop` = nothing to do, reported as success. */
export function checkActionState(
  action: WorkflowSchemaAction,
  configured: string | null,
  generated: WorkflowSchemaGenerated,
  symlink = false,
): Verdict {
  const enabled = configured === WORKFLOW_SCHEMA_NAME;
  const refuse = (reason: string): Verdict => ({ verdict: "refuse", reason });
  switch (action) {
    case "enable":
      if (enabled) return { verdict: "noop", reason: "already enabled" };
      return ["none", "current", "outdated", "newer", "conflict"].includes(generated)
        ? { verdict: "run" }
        : refuse(`cannot enable while the schema is ${generated}`);
    case "disable":
      return enabled ? { verdict: "run" } : { verdict: "noop", reason: `the default is ${configured ?? "spec-driven"}, not ${WORKFLOW_SCHEMA_NAME}` };
    case "update":
      return generated === "outdated" || generated === "current" || (generated === "none" && enabled)
        ? { verdict: "run" }
        : refuse(`cannot update while the schema is ${generated}`);
    case "adopt":
      if (symlink) return refuse("cannot adopt a symlinked schema directory");
      return generated === "unmanaged" ? { verdict: "run" } : refuse(`adopt needs an unmanaged schema (it is ${generated})`);
    case "pin":
      return enabled ? { verdict: "run" } : refuse(`pin is only allowed while the default is ${WORKFLOW_SCHEMA_NAME}`);
    case "remove":
      return ["current", "outdated", "newer", "conflict", "incompatible"].includes(generated)
        ? { verdict: "run" }
        : refuse(`cannot remove while the schema is ${generated}`);
  }
}

interface Guarded {
  root: string;
  deps: WorkflowSchemaDeps;
  req: WorkflowSchemaRequest;
  config: ConfigFile | null;
  localVersion: string;
  info: SchemaInspection;
}

interface Outcome {
  ok: boolean;
  written: string[];
  skipped?: string[];
  warnings?: string[];
  error?: string;
  partial?: boolean;
}

const refused = (error: string, extra: Partial<Outcome> = {}): Outcome => ({ ok: false, written: [], error, ...extra });

/**
 * Fresh `status --all` root checks + symlink refusals. Returns the canonical root or an error.
 * Exported for the dependencies PUT, which applies the same "verify the root first" guard.
 */
export async function writeGuard(cwd: string, deps: WorkflowSchemaDeps): Promise<{ root: string } | { error: string }> {
  let real: string;
  try {
    real = await fsp.realpath(cwd);
  } catch {
    return { error: "cwd does not exist" };
  }
  const r = await deps.cli({ op: "statusAll" }, { cwd: real });
  const top = parseJsonObject(r.stdout);
  const root = top?.root;
  if (!root || typeof root !== "object") {
    return { error: "the OpenSpec CLI reported no root (a CLI without `status --all` cannot write)" };
  }
  const { path: rootPath, source } = root as { path?: unknown; source?: unknown };
  if (source !== "nearest") return { error: `OpenSpec root source is "${String(source)}", not "nearest"; refusing to write` };
  if (typeof rootPath !== "string") return { error: "OpenSpec root has no path" };
  let rootReal: string;
  try {
    rootReal = await fsp.realpath(rootPath);
  } catch {
    return { error: "OpenSpec root path does not exist" };
  }
  if (rootReal !== real) return { error: `OpenSpec root ${rootReal} is not the project directory ${real}` };

  const os_ = await lstatOrNull(path.join(real, "openspec"));
  if (!os_ || os_.isSymbolicLink() || !os_.isDirectory()) return { error: "openspec/ is missing or a symlink" };
  for (const p of ["changes", "schemas", "config.yaml", "config.yml"]) {
    const st = await lstatOrNull(path.join(real, "openspec", p));
    if (st?.isSymbolicLink()) return { error: `openspec/${p} is a symlink; refusing to write` };
  }
  return { root: real };
}

/** Every write target must stay below `<root>/openspec/` (the parent is realpath'd; symlinked structure dirs are already refused). */
async function assertContained(root: string, target: string): Promise<void> {
  const base = path.join(root, "openspec") + path.sep;
  const parent = await fsp.realpath(path.dirname(target));
  if (!(parent + path.sep).startsWith(base)) throw new Error(`write target escapes ${base}: ${target}`);
}

async function validateSchemaName(
  c: Pick<Guarded, "root" | "deps">,
  name: unknown,
  opts: { allowPi?: boolean; label: string },
): Promise<string | null> {
  if (!isKebabCaseName(name)) return `${opts.label} must be a kebab-case schema id`;
  if (!opts.allowPi && name === WORKFLOW_SCHEMA_NAME) return `${opts.label} cannot be ${WORKFLOW_SCHEMA_NAME}`;
  if (!(await c.deps.resolveSchema(c.root, name))) {
    return `${opts.label} "${name}" does not resolve from the project or package schemas (user-level schemas cannot be committed defaults)`;
  }
  return null;
}

async function worktreeInfo(root: string): Promise<{ isWorktree: boolean; branch: string | null }> {
  try {
    const dotGit = path.join(root, ".git");
    const st = await fsp.lstat(dotGit);
    let gitDir = dotGit;
    let isWorktree = false;
    if (st.isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(await fsp.readFile(dotGit, "utf8"));
      if (!m) return { isWorktree: false, branch: null };
      gitDir = path.resolve(root, m[1].trim());
      isWorktree = /[\\/]worktrees[\\/]/.test(gitDir);
    }
    const head = (await fsp.readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
    const b = /^ref: refs\/heads\/(.+)$/.exec(head);
    return { isWorktree, branch: b ? b[1] : null };
  } catch {
    return { isWorktree: false, branch: null };
  }
}

/** Exclusive-create `.openspec.yaml` for each name lacking one. Throws on a real write error (caller reports partial). */
async function createPins(
  c: Guarded,
  names: string[],
  schemaName: string,
  out: { written: string[]; skipped: string[] },
): Promise<void> {
  const data = YAML.stringify({ schema: schemaName });
  const changesReal = await fsp.realpath(changesDirOf(c.root)).catch(() => changesDirOf(c.root));
  for (const name of names) {
    const dir = path.join(changesDirOf(c.root), name);
    const file = path.join(dir, ".openspec.yaml");
    const st = await lstatOrNull(dir);
    if (!st || !st.isDirectory() || st.isSymbolicLink() || (await fsp.realpath(dir)) !== path.join(changesReal, name)) {
      out.skipped.push(name);
      continue;
    }
    if (await lstatOrNull(file)) {
      out.skipped.push(name);
      continue;
    }
    await assertContained(c.root, file);
    try {
      await c.deps.fs.writeExclusive(file, data);
      out.written.push(rel(c.root, file));
    } catch (err) {
      if (errCode(err) === "EEXIST") out.skipped.push(name);
      else throw err;
    }
  }
}

async function switchDefault(c: Guarded, schemaName: string): Promise<string> {
  const cfg = c.config;
  if (!cfg) throw new Error("no config file");
  cfg.doc.set("schema", schemaName);
  await assertContained(c.root, cfg.path);
  await c.deps.fs.writeAtomic(cfg.path, cfg.doc.toString({ lineWidth: 0 }));
  return rel(c.root, cfg.path);
}

async function generateStep(c: Guarded, previousDefault: string): Promise<{ error: string } | { warnings: string[] }> {
  const g = await generateWorkflowSchema(
    { root: c.root, previousDefault, expectedFingerprint: c.info.fingerprint },
    c.deps,
  );
  return g.ok ? { warnings: g.warnings } : { error: g.error };
}

const SCHEMA_REL = (root: string): string => rel(root, schemaDirOf(root));

async function doEnable(c: Guarded): Promise<Outcome> {
  if (!c.config) return refused("openspec/config.yaml or config.yml is required to enable the workflow schema");
  const prev = c.config.configured ?? BASE_SCHEMA;
  const bad = await validateSchemaName(c, prev, { label: "the current default schema" });
  if (bad) return refused(bad);

  const written: string[] = [];
  const warnings: string[] = [];
  if (c.info.generated === "none") {
    const g = await generateStep(c, prev);
    if ("error" in g) return refused(g.error);
    warnings.push(...g.warnings);
    written.push(SCHEMA_REL(c.root));
  } else if (c.info.stamp?.previousDefault !== prev) {
    return refused(
      `the schema stamp records previousDefault ${c.info.stamp?.previousDefault ?? "(none)"} but the config default is ${prev}; run Update with previousDefault: ${prev}`,
    );
  }

  const pins = { written: [] as string[], skipped: [] as string[] };
  try {
    const toPin: string[] = [];
    for (const name of await enumerateActiveChanges(c.root)) {
      if (!(await lstatOrNull(path.join(changesDirOf(c.root), name, ".openspec.yaml")))) toPin.push(name);
    }
    await createPins(c, toPin, prev, pins);
    written.push(...pins.written);
    written.push(await switchDefault(c, WORKFLOW_SCHEMA_NAME));
  } catch (err) {
    written.push(...pins.written);
    return { ok: false, written, warnings, partial: written.length > 0, error: `enable stopped part-way: ${errMsg(err)}; re-run enable to complete` };
  }
  return { ok: true, written, warnings, ...(pins.skipped.length ? { skipped: pins.skipped } : {}) };
}

async function doDisable(c: Guarded): Promise<Outcome> {
  if (!c.config) return refused("no config file");
  const stampPrev = c.info.generated === "none" || c.info.generated === "unmanaged" ? null : c.info.stamp?.previousDefault ?? null;
  let target: string;
  if (stampPrev) {
    target = stampPrev;
  } else {
    if (!c.req.previousDefault || c.req.confirm !== true) {
      return refused("the schema has no usable previousDefault; Disable needs previousDefault and confirm: true");
    }
    target = c.req.previousDefault;
  }
  const bad = await validateSchemaName(c, target, { label: "previousDefault" });
  if (bad) return refused(bad);
  try {
    return { ok: true, written: [await switchDefault(c, target)] };
  } catch (err) {
    return refused(errMsg(err));
  }
}

async function doUpdate(c: Guarded): Promise<Outcome> {
  const prev = c.req.previousDefault ?? c.info.stamp?.previousDefault ?? undefined;
  if (!prev) return refused("update needs previousDefault (the schema has no usable stamp value)");
  const bad = await validateSchemaName(c, prev, { label: "previousDefault" });
  if (bad) return refused(bad);
  const g = await generateStep(c, prev);
  if ("error" in g) return refused(g.error);
  return { ok: true, written: [SCHEMA_REL(c.root)], warnings: g.warnings };
}

async function doAdopt(c: Guarded): Promise<Outcome> {
  if (c.req.confirm !== true) return refused("adopt replaces the unmanaged schema directory (hand customizations are discarded); confirm: true required");
  if (!c.req.previousDefault) return refused("adopt needs previousDefault");
  const bad = await validateSchemaName(c, c.req.previousDefault, { label: "previousDefault" });
  if (bad) return refused(bad);
  const g = await generateStep(c, c.req.previousDefault);
  if ("error" in g) return refused(g.error);
  return { ok: true, written: [SCHEMA_REL(c.root)], warnings: g.warnings };
}

async function doPin(c: Guarded): Promise<Outcome> {
  const stampPrev = c.info.stamp?.previousDefault ?? null;
  const pinTo = c.req.pinTo;
  if (pinTo !== WORKFLOW_SCHEMA_NAME && pinTo !== stampPrev) {
    return refused(`pinTo must be ${WORKFLOW_SCHEMA_NAME} or the stamp's previousDefault (${stampPrev ?? "none"})`);
  }
  const bad = await validateSchemaName(c, pinTo, { allowPi: true, label: "pinTo" });
  if (bad) return refused(bad);
  const active = await enumerateActiveChanges(c.root);
  const requested = c.req.changes ?? active;
  const unknown = requested.filter((n) => !active.includes(n));
  if (unknown.length > 0) return refused(`unknown change(s): ${unknown.join(", ")}`);
  const pins = { written: [] as string[], skipped: [] as string[] };
  try {
    await createPins(c, requested, pinTo as string, pins);
  } catch (err) {
    return { ok: false, written: pins.written, skipped: pins.skipped, partial: pins.written.length > 0, error: errMsg(err) };
  }
  return { ok: true, written: pins.written, skipped: pins.skipped };
}

async function doRemove(c: Guarded): Promise<Outcome> {
  if (c.config?.configured === WORKFLOW_SCHEMA_NAME) return refused("the config default is still pi-spec-driven; disable first");
  const active: string[] = [];
  for (const name of await enumerateActiveChanges(c.root)) {
    if ((await readChangeSchema(path.join(changesDirOf(c.root), name))) === WORKFLOW_SCHEMA_NAME) active.push(name);
  }
  if (active.length > 0) return refused(`active change(s) still pin ${WORKFLOW_SCHEMA_NAME}: ${active.join(", ")}`);

  const archived: string[] = [];
  const archiveDir = path.join(changesDirOf(c.root), "archive");
  for (const e of await fsp.readdir(archiveDir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && !e.isSymbolicLink() && (await readChangeSchema(path.join(archiveDir, e.name))) === WORKFLOW_SCHEMA_NAME) {
      archived.push(e.name);
    }
  }
  const warnings = ["Unmerged branches may still pin pi-spec-driven; they break once this removal lands."];
  if (archived.length > 0) {
    const w = `archived change(s) reference ${WORKFLOW_SCHEMA_NAME}: ${archived.join(", ")}`;
    if (c.req.confirm !== true) return refused(`${w}; confirm: true required`, { warnings: [w, ...warnings] });
    warnings.unshift(w);
  }

  const target = schemaDirOf(c.root);
  const backup = path.join(schemasDirOf(c.root), `${WORKFLOW_SCHEMA_NAME}.fork-backup-${c.deps.pid}-${c.deps.now()}`);
  try {
    await renameWithRetry(c.deps, target, backup);
  } catch (err) {
    return refused(`could not remove the schema: ${errMsg(err)}`, { warnings });
  }
  try {
    await c.deps.fs.rm(backup);
  } catch (err) {
    warnings.push(`removed, but could not delete the backup ${backup}: ${errMsg(err)}`);
  }
  return { ok: true, written: [SCHEMA_REL(c.root)], warnings };
}

const ACTIONS: Record<WorkflowSchemaAction, (c: Guarded) => Promise<Outcome>> = {
  enable: doEnable,
  disable: doDisable,
  update: doUpdate,
  adopt: doAdopt,
  pin: doPin,
  remove: doRemove,
};

async function snapshot(
  root: string,
  deps: WorkflowSchemaDeps,
  localVersion: string | null,
): Promise<{ status: WorkflowSchemaGenerated; configured: string | null }> {
  let configured: string | null = null;
  try {
    configured = (await readConfigFile(root))?.configured ?? null;
  } catch {
    configured = null;
  }
  try {
    const info = localVersion
      ? await inspectWithValidate(root, localVersion, deps)
      : await inspectSchema(root, { localVersion: "" });
    return { status: info.generated, configured };
  } catch {
    return { status: "none", configured };
  }
}

/**
 * Single dispatcher for all six actions: write guard → state table → action →
 * forced refresh. Refusals carry the current status; nothing is written on a
 * refusal except by an action that reports `partial`.
 */
export async function runWorkflowSchemaAction(
  req: WorkflowSchemaRequest,
  depsIn: Partial<WorkflowSchemaDeps> = {},
): Promise<WorkflowSchemaResult> {
  const deps = resolveDeps(depsIn);
  let root = req.cwd;
  let localVersion: string | null = null;

  const finish = async (o: Outcome): Promise<WorkflowSchemaResult> => {
    if (o.written.length > 0 || o.partial) {
      try {
        await deps.refresh(req.cwd);
      } catch (err) {
        (o.warnings ??= []).push(`forced refresh failed: ${errMsg(err)}`);
      }
    }
    const snap = await snapshot(root, deps, localVersion);
    return {
      ok: o.ok,
      status: snap.status,
      configured: snap.configured,
      written: o.written,
      ...(o.skipped ? { skipped: o.skipped } : {}),
      ...(o.warnings?.length ? { warnings: o.warnings } : {}),
      worktree: await worktreeInfo(root),
      ...(o.error ? { error: o.error } : {}),
      ...(o.partial ? { partial: true } : {}),
    };
  };

  try {
    const guard = await writeGuard(req.cwd, deps);
    if ("error" in guard) return await finish(refused(guard.error));
    root = guard.root;

    const ver = await deps.cli({ op: "version" }, { cwd: root });
    localVersion = ver.ok ? ver.stdout.trim() : null;
    if (!localVersion) return await finish(refused("cannot determine the OpenSpec CLI version"));

    let config: ConfigFile | null;
    try {
      config = await readConfigFile(root);
    } catch (err) {
      return await finish(refused(errMsg(err)));
    }
    const info = await inspectWithValidate(root, localVersion, deps);
    const state = checkActionState(req.action, config?.configured ?? null, info.generated, info.symlink);
    if (state.verdict === "refuse") return await finish(refused(state.reason));
    if (state.verdict === "noop") return await finish({ ok: true, written: [], warnings: [state.reason] });

    return await finish(await ACTIONS[req.action]({ root, deps, req, config, localVersion, info }));
  } catch (err) {
    return await finish(refused(errMsg(err)));
  }
}

/** Pin wrapper over the single dispatcher (the contract), used by the poll tests. */
export const pinWorkflowSchema = (
  req: Omit<WorkflowSchemaRequest, "action">,
  deps?: Partial<WorkflowSchemaDeps>,
): Promise<WorkflowSchemaResult> => runWorkflowSchemaAction({ ...req, action: "pin" }, deps);
