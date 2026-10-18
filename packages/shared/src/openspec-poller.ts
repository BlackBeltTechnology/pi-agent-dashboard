/**
 * Polls the openspec CLI to gather change data for the session's project.
 *
 * This module is a thin aggregator over `platform/openspec.ts`: it
 * calls the Recipe-based primitives and combines `list` + per-change
 * `status` into the dashboard's `OpenSpecData` shape.
 *
 * Two public flavors:
 *
 *   - `pollOpenSpec` (sync) — for the bridge extension where async
 *     isn't practical. Uses `run()` under the hood; each call blocks
 *     the event loop for ~200-2000ms per openspec invocation.
 *
 *   - `pollOpenSpecAsync` (async) — for the server's directory service.
 *     Routes through the runner's `runAsync()` so every spawn goes
 *     through the same binary resolution, `.cmd` shell handling, and
 *     `windowsHide: true` default as everything else. Status queries
 *     run in parallel via `Promise.all`, keeping the event loop free
 *     on Windows where openspec.cmd startup is slow (~2s per call).
 *
 * See change: consolidate-tool-resolution.
 */

import { existsSync, promises as fsp, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  createFsDesignEvidenceProbe,
  type DesignEvidenceProbe,
  evaluateLocalDesignSatisfaction,
} from "./openspec-design-evidence.js";
import {
  createFsSpecsEvidenceProbe,
  evaluateLocalSpecsSatisfaction,
  type SpecsEvidenceProbe,
} from "./openspec-specs-evidence.js";
import {
  canonicalArtifactOrder,
  computeTrackedExtras,
  countTasksFromContent,
  entryError,
  mapCliPath,
  mapLimit,
  type StatusAllEntry,
  type StatusAllRaw,
  selectTrackedArtifact,
  type TrackedExtras,
  taskListStatus,
} from "./openspec-status-all.js";
import { listOr, OPENSPEC_LIST, OPENSPEC_STATUS, OPENSPEC_STATUS_ALL, statusOr, userSchemasDir } from "./platform/openspec.js";
import { type Result, runAsync, unwrap } from "./platform/runner.js";
import type { OpenSpecArtifact, OpenSpecChange, OpenSpecData } from "./types.js";

const EMPTY_DATA: OpenSpecData = { initialized: false, changes: [] };

/**
 * Factory that returns a probe for a given change name. Production callers
 * pass a closure rooted at `<cwd>/openspec/changes/<name>`. Tests pass an
 * in-memory factory. When omitted, the design override does NOT fire and
 * `buildOpenSpecData` matches today's behavior verbatim.
 *
 * See change: fix-openspec-design-detection.
 */
export type DesignProbeFactory = (changeName: string) => DesignEvidenceProbe;

/**
 * Factory that returns a specs-evidence probe for a given change name.
 * Parallel to `DesignProbeFactory` — production callers pass a closure
 * rooted at `<cwd>/openspec/changes/<name>`; tests pass an in-memory
 * factory. When omitted, the specs override does NOT fire and
 * `buildOpenSpecData` matches today's behavior verbatim for the specs
 * artifact.
 *
 * See change: fix-openspec-specs-mtime-gate-blind-spot.
 */
export type SpecsProbeFactory = (changeName: string) => SpecsEvidenceProbe;

export function buildOpenSpecData(
  listResult: { changes?: Array<{ name: string; status: string; completedTasks: number; totalTasks: number }> } | null,
  statusResults: Map<string, { artifacts?: Array<{ id: string; status: string }>; isComplete?: boolean; schemaName?: string } | null>,
  probeFactory?: DesignProbeFactory,
  specsProbeFactory?: SpecsProbeFactory,
): OpenSpecData {
  if (!listResult || !Array.isArray(listResult.changes)) {
    return EMPTY_DATA;
  }

  const changes: OpenSpecChange[] = listResult.changes.map((c) => {
    const statusResult = statusResults.get(c.name) ?? null;
    const artifacts: OpenSpecArtifact[] = (statusResult?.artifacts ?? []).map((a) => ({
      id: a.id,
      // `skipped` passes through: a skip_specs change's specs artifact arrives
      // as "skipped" from the raw CLI, and collapsing it to "blocked" broke
      // poller/CLI parity. See change: dispatch-provider-auth-event.
      status: (a.status === "done" ? "done" : a.status === "ready" ? "ready" : a.status === "skipped" ? "skipped" : "blocked") as OpenSpecArtifact["status"],
    }));

    // Design-artifact override: promote-only, design-only. See change:
    // fix-openspec-design-detection.
    if (probeFactory) {
      const designIdx = artifacts.findIndex((a) => a.id === "design");
      if (designIdx !== -1 && artifacts[designIdx].status === "ready") {
        const probe = probeFactory(c.name);
        // pi-spec-driven skips evidence: per-change `schemaName` (status --all /
        // status --change), else resolved locally from `.openspec.yaml` on the
        // fallback `list` path. See change: add-pi-spec-driven-schema.
        const schemaName = statusResult?.schemaName ?? probe.localSchemaName?.("");
        if (evaluateLocalDesignSatisfaction("", probe, schemaName)) {
          artifacts[designIdx] = { ...artifacts[designIdx], status: "done" };
        }
      }
    }

    // Specs-artifact override: promote-only, specs-only. See change:
    // fix-openspec-specs-mtime-gate-blind-spot.
    if (specsProbeFactory) {
      const specsIdx = artifacts.findIndex((a) => a.id === "specs");
      if (specsIdx !== -1 && artifacts[specsIdx].status === "ready") {
        const probe = specsProbeFactory(c.name);
        if (evaluateLocalSpecsSatisfaction("", probe)) {
          artifacts[specsIdx] = { ...artifacts[specsIdx], status: "done" };
        }
      }
    }

    const cliIsComplete =
      typeof statusResult?.isComplete === "boolean" ? statusResult.isComplete : undefined;

    // Re-derive isComplete from post-override artifacts. Promote false→true
    // only when every artifact is done; never demote CLI true.
    let isComplete = cliIsComplete;
    if (artifacts.length > 0 && artifacts.every((a) => a.status === "done")) {
      isComplete = true;
    }

    const change: OpenSpecChange = {
      name: c.name,
      status: (c.status === "complete" ? "complete" : c.status === "in-progress" ? "in-progress" : "no-tasks") as OpenSpecChange["status"],
      completedTasks: c.completedTasks ?? 0,
      totalTasks: c.totalTasks ?? 0,
      artifacts,
    };
    if (isComplete !== undefined) change.isComplete = isComplete;
    return change;
  });

  return { initialized: true, changes };
}

/**
 * Pure, local derivation of a change's per-artifact status WITHOUT spawning
 * `openspec status`. Used on the periodic / gated poll path to replace the
 * per-change CLI spawn (the spawn storm). Returns the same
 * `{ artifacts, isComplete }` shape `runOpenSpecStatus` returns, so it flows
 * through `buildOpenSpecData` unchanged.
 *
 * Rules (mirror raw-CLI semantics after `buildOpenSpecData`'s design/specs
 * promote-only overrides are applied):
 *   - `proposal`: `done` iff `proposal.md` exists, else `ready`.
 *   - `design`:   `done` iff the design evidence probe (R1/R2/R3) fires, else `ready`.
 *   - `specs`:    `done` iff ≥1 `specs/**\/*.md` per the specs evidence probe, else `ready`.
 *                 A change whose `.openspec.yaml` declares `skip_specs: true` reports
 *                 `skipped` instead — a declaration of absence, not outstanding work
 *                 (mirrors the raw CLI and satisfies isComplete).
 *   - `tasks`:    `done` iff `totalTasks > 0`. The CLI keys the `tasks`
 *                 artifact on whether tasks were authored, NOT on completion
 *                 (a 0/21 change still reports `tasks: done`). With no tasks
 *                 authored it distinguishes prerequisites: `ready` when
 *                 proposal + design + specs are all `done` (tasks are the next
 *                 artifact to write), else `blocked`.
 *                 See change: fix-optimistic-prompt-stuck-sending.
 *   - `isComplete`: `true` iff every artifact is `done`.
 *
 * Artifact order matches the CLI: proposal, design, specs, tasks. Probes are
 * injected so this is unit-testable without fs mocks, mirroring the
 * `buildOpenSpecData` test style.
 *
 * See change: optimize-openspec-poll-derive-artifacts-locally.
 */
export function deriveArtifactStatus(
  changeDir: string,
  listEntry: { completedTasks: number; totalTasks: number },
  probes: { design: DesignEvidenceProbe; specs: SpecsEvidenceProbe },
): { artifacts: Array<{ id: string; status: string }>; isComplete: boolean } {
  const proposalDone = existsSync(path.join(changeDir, "proposal.md"));
  const designDone = evaluateLocalDesignSatisfaction(changeDir, probes.design);
  // A change whose .openspec.yaml declares `skip_specs: true` has NO specs
  // artifact by declaration — the raw CLI emits it as `skipped` and it
  // satisfies planning completeness without a specs dir. Keying on the specs
  // evidence probe instead reported `ready` forever and broke poller/CLI
  // parity. See change: dispatch-provider-auth-event.
  const skipSpecs = isSkipSpecsChange(changeDir);
  const specsDone = skipSpecs || evaluateLocalSpecsSatisfaction(changeDir, probes.specs);
  const tasksAuthored = (listEntry.totalTasks ?? 0) > 0;

  const artifacts = [
    { id: "proposal", status: proposalDone ? "done" : "ready" },
    // design/specs `requires: [proposal]` in spec-driven: without proposal.md
    // the CLI reports them `blocked`, not `ready`.
    { id: "design", status: designDone ? "done" : proposalDone ? "ready" : "blocked" },
    {
      id: "specs",
      status: skipSpecs ? "skipped" : specsDone ? "done" : proposalDone ? "ready" : "blocked",
    },
    {
      id: "tasks",
      status: tasksAuthored ? "done" : proposalDone && designDone && specsDone ? "ready" : "blocked",
    },
  ];
  // `skipped` satisfies: it is a declaration of absence, not outstanding work
  // (mirrors the CLI's isPlanningComplete).
  const isComplete = artifacts.every((a) => a.status === "done" || a.status === "skipped");
  return { artifacts, isComplete };
}

/** True when the change's `.openspec.yaml` declares `skip_specs: true`. */
function isSkipSpecsChange(changeDir: string): boolean {
  try {
    const raw = readFileSync(path.join(changeDir, ".openspec.yaml"), "utf8");
    return /^skip_specs:\s*true\s*$/m.test(raw);
  } catch {
    return false; // no .openspec.yaml — not a skip_specs change
  }
}

/**
 * Build a real-fs probe factory rooted at `<cwd>/openspec/changes/<name>`.
 * Production callers (`pollOpenSpec`, `pollOpenSpecAsync`,
 * `directory-service.ts`) use this to wire the override. Tests inject
 * their own factory.
 */
export function createFsProbeFactory(cwd: string): DesignProbeFactory {
  const probe = createFsDesignEvidenceProbe();
  const changesRoot = path.join(cwd, "openspec", "changes");
  return (changeName) => {
    const changeDir = path.join(changesRoot, changeName);
    return {
      hasDesignFile: () => probe.hasDesignFile(changeDir),
      hasDesignDirWithMd: () => probe.hasDesignDirWithMd(changeDir),
      tasksHasCheckboxes: () => probe.tasksHasCheckboxes(changeDir),
      localSchemaName: () => probe.localSchemaName?.(changeDir),
    };
  };
}

/**
 * Build a real-fs specs-probe factory rooted at `<cwd>/openspec/changes/<name>`.
 * Parallel to `createFsProbeFactory` — production callers (`pollOpenSpec`,
 * `pollOpenSpecAsync`, `directory-service.ts`) use this to wire the specs
 * override. Tests inject their own factory.
 *
 * See change: fix-openspec-specs-mtime-gate-blind-spot.
 */
export function createFsSpecsProbeFactory(cwd: string): SpecsProbeFactory {
  const probe = createFsSpecsEvidenceProbe();
  const changesRoot = path.join(cwd, "openspec", "changes");
  return (changeName) => {
    const changeDir = path.join(changesRoot, changeName);
    return {
      hasAnySpecFile: () => probe.hasAnySpecFile(changeDir),
    };
  };
}

/**
 * Synchronous poll — blocks the event loop. Used by the bridge extension
 * where async isn't practical (some pi extension hooks are sync).
 */
export function pollOpenSpec(cwd: string): OpenSpecData {
  const listResult = listOr({ cwd }) as any;
  if (!listResult || !Array.isArray(listResult.changes)) return EMPTY_DATA;

  const statusResults = new Map<string, any>();
  for (const c of listResult.changes) {
    statusResults.set(c.name, statusOr({ cwd, change: c.name }));
  }
  return buildOpenSpecData(
    listResult,
    statusResults,
    createFsProbeFactory(cwd),
    createFsSpecsProbeFactory(cwd),
  );
}

/**
 * Run `openspec list --json` for a single cwd. Exposed so callers that
 * want their own concurrency control or mtime-gate logic can compose
 * the list + per-change status calls themselves.
 */
export async function runOpenSpecList(cwd: string): Promise<
  | { changes?: Array<{ name: string; status: string; completedTasks: number; totalTasks: number }> }
  | null
> {
  return unwrap(await runAsync(OPENSPEC_LIST, { cwd }, { cwd }), null) as any;
}

/**
 * Run `openspec status --change <name> --json` for a single change.
 * Exposed for the same reason as `runOpenSpecList`.
 */
export async function runOpenSpecStatus(
  cwd: string,
  changeName: string,
): Promise<{ artifacts?: Array<{ id: string; status: string }>; isComplete?: boolean } | null> {
  return unwrap(await runAsync(OPENSPEC_STATUS, { cwd, change: changeName }, { cwd }), null) as any;
}

/**
 * Async poll — genuinely async. Runs per-change status queries in
 * parallel via the shared `runAsync()`, so each spawn goes through the
 * central binary resolution + `windowsHide: true` default.
 */
export async function pollOpenSpecAsync(cwd: string): Promise<OpenSpecData> {
  const listResult = unwrap(await runAsync(OPENSPEC_LIST, { cwd }, { cwd }), null) as
    | { changes?: Array<{ name: string; status: string; completedTasks: number; totalTasks: number }> }
    | null;
  if (!listResult || !Array.isArray(listResult.changes)) return EMPTY_DATA;

  const statusEntries = await Promise.all(
    listResult.changes.map(async (c) => {
      const result = await runAsync(OPENSPEC_STATUS, { cwd, change: c.name }, { cwd });
      return [c.name, unwrap(result, null)] as const;
    }),
  );
  const statusResults = new Map<string, any>(statusEntries);
  return buildOpenSpecData(
    listResult,
    statusResults,
    createFsProbeFactory(cwd),
    createFsSpecsProbeFactory(cwd),
  );
}

// ── `openspec status --all` path ────────────────────────────────────────────

/**
 * Run `openspec status --all --json` for one cwd and return the RAW outcome
 * regardless of exit code (a single broken change exits 1 with complete JSON).
 * Never throws; spawn-level failures set `failure`. Classification and
 * parsing happen later, off the main thread. See change: use-openspec-status-all.
 */
export async function runOpenSpecStatusAll(cwd: string): Promise<StatusAllRaw> {
  return statusAllRawFromResult(await runAsync(OPENSPEC_STATUS_ALL, { cwd }, { cwd }));
}

/** Runner `Result` → raw outcome: stdout + stderr whatever the exit code; spawn-level failures set `failure`. */
export function statusAllRawFromResult(result: Result<string>): StatusAllRaw {
  if (result.ok) return { stdout: result.value, stderr: "", exitCode: 0 };
  const err = result.error;
  if (err.kind === "exit") {
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.code ?? null };
  }
  return { stdout: "", stderr: "", exitCode: null, failure: err.kind };
}

/** schema.yaml path → `{ mtimeMs, applyTracks }`, memoized by mtime. */
const schemaTracksMemo = new Map<string, { mtimeMs: number; tracks: string | undefined }>();

async function readApplyTracks(schemaFile: string): Promise<{ exists: boolean; tracks: string | undefined }> {
  let mtimeMs: number;
  try {
    mtimeMs = (await fsp.stat(schemaFile)).mtimeMs;
  } catch {
    return { exists: false, tracks: undefined };
  }
  const memo = schemaTracksMemo.get(schemaFile);
  if (memo && memo.mtimeMs === mtimeMs) return { exists: true, tracks: memo.tracks };
  let tracks: string | undefined;
  try {
    const doc = parseYaml(await fsp.readFile(schemaFile, "utf8")) as { apply?: { tracks?: unknown } } | null;
    const t = doc?.apply?.tracks;
    tracks = typeof t === "string" ? t : undefined;
  } catch {
    tracks = undefined; // unreadable / unparsable ⇒ `apply.tracks` absent
  }
  schemaTracksMemo.set(schemaFile, { mtimeMs, tracks });
  return { exists: true, tracks };
}

/**
 * `apply.tracks` for a schema by OpenSpec's resolution order: project-local
 * `<openspec>/schemas/<name>/schema.yaml`, then the user schema dir; the first
 * existing file wins (even when it declares no `apply.tracks`). The built-in
 * package schemas are not read — `spec-driven` tracks `tasks.md`, which the
 * "artifact with id `tasks`" default yields identically.
 */
export async function resolveApplyTracks(
  schemaName: string | undefined,
  openspecDir: string,
  userDir: string = userSchemasDir(),
): Promise<string | undefined> {
  if (!schemaName || /[\\/]/.test(schemaName) || schemaName === "." || schemaName === ".." || /^[A-Za-z]:/.test(schemaName)) {
    return undefined;
  }
  for (const dir of [path.join(openspecDir, "schemas"), userDir]) {
    const r = await readApplyTracks(path.join(dir, schemaName, "schema.yaml"));
    if (r.exists) return r.tracks;
  }
  return undefined;
}

async function countFile(file: string): Promise<{ total: number; completed: number }> {
  try {
    return countTasksFromContent(await fsp.readFile(file, "utf8"));
  } catch {
    return { total: 0, completed: 0 };
  }
}

export interface StatusAllBuildInput {
  cwd: string;
  /** Server-canonical `<cwd>/openspec` directory (realpath). */
  openspecDir: string;
  /** `root.path` exactly as the CLI emitted it. */
  rootPath: string;
  entries: StatusAllEntry[];
  /** Probe effective mtime per change — the sort key (newest first, ties by name). */
  orderMtimes: Record<string, number | undefined>;
  /** Test seam: user schema directory. */
  userSchemasDir?: string;
}

export interface StatusAllBuildResult {
  data: OpenSpecData;
  /** Tracked extras per change, mapped onto `openspecDir`, for the gate and watcher. */
  extras: Record<string, TrackedExtras>;
}

/** Local task counts for one entry (OpenSpec's file selection; top-level `tasks.md` fallback). */
async function countEntryTasks(
  entry: StatusAllEntry,
  err: ReturnType<typeof entryError>,
  input: StatusAllBuildInput,
): Promise<{ total: number; completed: number }> {
  const { openspecDir, rootPath } = input;
  const tracks = err ? undefined : await resolveApplyTracks(entry.schemaName, openspecDir, input.userSchemasDir);
  const tracked = err ? undefined : selectTrackedArtifact(entry.artifacts, tracks);
  const files: string[] = [];
  for (const p of tracked ? (entry.artifactPaths?.[tracked.id]?.existingOutputPaths ?? []) : []) {
    const mapped = mapCliPath(p, rootPath, openspecDir);
    if (mapped) files.push(mapped);
  }
  if (files.length === 0) files.push(path.join(openspecDir, "changes", entry.changeName, "tasks.md"));
  let total = 0;
  let completed = 0;
  for (const f of files) {
    const c = await countFile(f);
    total += c.total;
    completed += c.completed;
  }
  return { total, completed };
}

/** Newest-first by probe mtime, ties by name. */
function byNewestThenName(orderMtimes: Record<string, number | undefined>) {
  return (a: OpenSpecChange, b: OpenSpecChange): number => {
    const ma = orderMtimes[a.name] ?? 0;
    const mb = orderMtimes[b.name] ?? 0;
    if (ma !== mb) return mb - ma;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  };
}

/**
 * Build `OpenSpecData` from a classified `status --all` envelope: local task
 * counting (OpenSpec's task-line rule and file selection), canonical artifact
 * order, per-change `error`, the promote-only design/specs overrides, and the
 * newest-first change order. All file I/O is async and bounded.
 * See change: use-openspec-status-all.
 */
export async function buildOpenSpecDataFromStatusAll(input: StatusAllBuildInput): Promise<StatusAllBuildResult> {
  const { cwd, openspecDir, rootPath, entries, orderMtimes } = input;

  const counted = await mapLimit(entries, 16, async (entry) => {
    const err = entryError(entry);
    return { entry, err, ...(await countEntryTasks(entry, err, input)) };
  });

  const listEntries = counted.map((c) => ({
    name: c.entry.changeName,
    status: taskListStatus(c.total, c.completed),
    completedTasks: c.completed,
    totalTasks: c.total,
  }));
  const statusResults = new Map<string, { artifacts?: Array<{ id: string; status: string }>; isComplete?: boolean; schemaName?: string } | null>();
  const extras: Record<string, TrackedExtras> = {};
  for (const c of counted) {
    const { entry } = c;
    extras[entry.changeName] = computeTrackedExtras(entry, rootPath, openspecDir, path.join(openspecDir, "changes", entry.changeName));
    statusResults.set(
      entry.changeName,
      c.err
        ? null
        : {
            ...(entry.schemaName ? { schemaName: entry.schemaName } : {}),
            artifacts: canonicalArtifactOrder(entry.artifacts ?? []).map((a) => ({ id: a.id, status: a.status })),
            ...(typeof entry.isComplete === "boolean" ? { isComplete: entry.isComplete } : {}),
          },
    );
  }

  const built = buildOpenSpecData(
    { changes: listEntries },
    statusResults,
    createFsProbeFactory(cwd),
    createFsSpecsProbeFactory(cwd),
  );
  const errorByName = new Map(counted.filter((c) => c.err).map((c) => [c.entry.changeName, c.err!]));
  const changes = built.changes
    .map((c) => (errorByName.has(c.name) ? { ...c, error: errorByName.get(c.name)! } : c))
    .sort(byNewestThenName(orderMtimes));
  return { data: { initialized: true, changes }, extras };
}
