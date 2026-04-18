/**
 * Polls the openspec CLI to gather change data for the session's project.
 *
 * This module is now a thin aggregator over `platform/openspec.ts`: it
 * calls the Recipe-based primitives and combines `list` + per-change
 * `status` into the dashboard's `OpenSpecData` shape. The low-level
 * spawn / windowsHide / timeout / JSON-parse concerns live in the
 * platform module. See change: platform-command-executor.
 */
import { listOr, statusOr } from "./platform/openspec.js";
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
 * Async poll — runs status queries in parallel. Used by the server's
 * directory service. Despite the name, the current implementation is
 * synchronous internally because the shared runner is sync (spawnSync).
 * Kept as `async` for API compatibility and future migration to async
 * spawn.
 */
export async function pollOpenSpecAsync(cwd: string): Promise<OpenSpecData> {
  // Current runner is synchronous; `pollOpenSpec` covers the real work.
  // Returning a resolved Promise preserves the async signature that
  // `directory-service.ts` expects.
  return pollOpenSpec(cwd);
}
