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
import { listOr, statusOr, OPENSPEC_LIST, OPENSPEC_STATUS } from "./platform/openspec.js";
import { runAsync, unwrap } from "./platform/runner.js";
import type { OpenSpecData, OpenSpecChange, OpenSpecArtifact } from "./types.js";
import {
  evaluateLocalDesignSatisfaction,
  createFsDesignEvidenceProbe,
  type DesignEvidenceProbe,
} from "./openspec-design-evidence.js";
import {
  evaluateLocalSpecsSatisfaction,
  createFsSpecsEvidenceProbe,
  type SpecsEvidenceProbe,
} from "./openspec-specs-evidence.js";
import { existsSync } from "node:fs";
import path from "node:path";

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
  statusResults: Map<string, { artifacts?: Array<{ id: string; status: string }>; isComplete?: boolean } | null>,
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
      status: (a.status === "done" ? "done" : a.status === "ready" ? "ready" : "blocked") as OpenSpecArtifact["status"],
    }));

    // Design-artifact override: promote-only, design-only. See change:
    // fix-openspec-design-detection.
    if (probeFactory) {
      const designIdx = artifacts.findIndex((a) => a.id === "design");
      if (designIdx !== -1 && artifacts[designIdx].status === "ready") {
        const probe = probeFactory(c.name);
        if (evaluateLocalDesignSatisfaction("", probe)) {
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
 *   - `tasks`:    `done` iff `totalTasks > 0`, else `blocked`. The CLI keys the
 *                 `tasks` artifact on whether tasks were authored, NOT on
 *                 completion (a 0/21 change still reports `tasks: done`); it
 *                 reports `blocked` when `totalTasks === 0`.
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
  const specsDone = evaluateLocalSpecsSatisfaction(changeDir, probes.specs);
  const tasksAuthored = (listEntry.totalTasks ?? 0) > 0;

  const artifacts = [
    { id: "proposal", status: proposalDone ? "done" : "ready" },
    { id: "design", status: designDone ? "done" : "ready" },
    { id: "specs", status: specsDone ? "done" : "ready" },
    { id: "tasks", status: tasksAuthored ? "done" : "blocked" },
  ];
  const isComplete = artifacts.every((a) => a.status === "done");
  return { artifacts, isComplete };
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
