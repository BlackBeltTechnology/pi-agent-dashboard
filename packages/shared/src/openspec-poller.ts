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

const EMPTY_DATA: OpenSpecData = { initialized: false, changes: [] };

function buildOpenSpecData(
  listResult: { changes?: Array<{ name: string; status: string; completedTasks: number; totalTasks: number }> } | null,
  statusResults: Map<string, { artifacts?: Array<{ id: string; status: string }> } | null>,
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

    return {
      name: c.name,
      status: (c.status === "complete" ? "complete" : c.status === "in-progress" ? "in-progress" : "no-tasks") as OpenSpecChange["status"],
      completedTasks: c.completedTasks ?? 0,
      totalTasks: c.totalTasks ?? 0,
      artifacts,
    };
  });

  return { initialized: true, changes };
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
  return buildOpenSpecData(listResult, statusResults);
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
  return buildOpenSpecData(listResult, statusResults);
}
