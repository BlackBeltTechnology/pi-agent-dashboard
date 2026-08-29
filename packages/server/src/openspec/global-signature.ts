/**
 * Shared current-global-workflow-signature provider.
 *
 * Extracted from the `openspec-routes.ts` closure (which still keeps its own
 * copy for `update-status` / init recording — those need a DEFINED signature
 * even when the CLI fails, pre-existing semantics) and injected into
 * `directory-service` so the readiness fold can compute profile staleness.
 * See change: add-openspec-init-affordances (D1).
 *
 * Hardening difference vs the routes copy: when `openspec config list` fails,
 * this provider resolves `undefined` and the readiness fold SKIPS the
 * signature-staleness check — a CLI failure must never mark every cwd STALE.
 */
import { configListOrAsync, workflowSetSignature } from "@blackbelt-technology/pi-dashboard-shared/platform/openspec.js";

export async function currentGlobalWorkflowSignature(cwd: string): Promise<string | undefined> {
  const raw = (await configListOrAsync({ cwd }, null)) as { workflows?: string[] } | null;
  if (!raw) return undefined;
  return workflowSetSignature(Array.isArray(raw.workflows) ? raw.workflows : []);
}
