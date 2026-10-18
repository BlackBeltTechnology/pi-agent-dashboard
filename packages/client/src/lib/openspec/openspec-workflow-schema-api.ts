/**
 * Client helpers for the `pi-spec-driven` workflow schema:
 * `POST /api/openspec/workflow-schema` (per-cwd actions that write repository
 * files immediately) plus the pure state gating that mirrors the server's
 * "Actions are allowed only in defined states" table.
 *
 * See change: add-pi-spec-driven-schema.
 */

import type { OpenSpecWorkflowSchemaStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getApiBase } from "../api/api-context.js";

export const WORKFLOW_SCHEMA_NAME = "pi-spec-driven";
export const BUILTIN_DEFAULT_SCHEMA = "spec-driven";

export type WorkflowSchemaAction = "enable" | "disable" | "update" | "adopt" | "pin" | "remove";

export interface WorkflowSchemaRequest {
  cwd: string;
  action: WorkflowSchemaAction;
  confirm?: boolean;
  pinTo?: string;
  changes?: string[];
  previousDefault?: string;
}

/** Mirror of the server `WorkflowSchemaResult` (no shared declaration). */
export interface WorkflowSchemaResult {
  ok: boolean;
  status: string;
  configured: string | null;
  written: string[];
  skipped?: string[];
  warnings?: string[];
  worktree: { isWorktree: boolean; branch: string | null };
  error?: string;
  partial?: boolean;
}

export interface WorkflowSchemaOutcome {
  success: boolean;
  httpStatus: number;
  error?: string;
  /** Present on 200 and on 422/500 refusals/partials; absent on 400/409. */
  data?: WorkflowSchemaResult;
}

/**
 * Run one action. Unlike the other openspec helpers this never throws on a
 * non-2xx status: 422 (refusal), 500 (partial failure) and 409 (in flight)
 * carry a body the UI must show, so the JSON is always read.
 */
export async function runWorkflowSchemaAction(req: WorkflowSchemaRequest): Promise<WorkflowSchemaOutcome> {
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}/api/openspec/workflow-schema`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch (err) {
    return { success: false, httpStatus: 0, error: err instanceof Error ? err.message : String(err) };
  }
  const body = await res.json().catch(() => null);
  const success = res.ok && body?.success === true;
  return {
    success,
    httpStatus: res.status,
    ...(success ? {} : { error: body?.error ?? body?.data?.error ?? `HTTP ${res.status}` }),
    ...(body?.data ? { data: body.data as WorkflowSchemaResult } : {}),
  };
}

const ENABLE_FROM = ["none", "current", "outdated", "newer", "conflict"];
const REMOVE_FROM = ["current", "outdated", "newer", "conflict", "incompatible"];

/**
 * Buttons offered for a cwd, mirroring the server table. `newer`/`conflict`
 * enable additionally needs a local validate pass — the server decides; the
 * client offers the button.
 */
export function allowedWorkflowSchemaActions(s: OpenSpecWorkflowSchemaStatus): WorkflowSchemaAction[] {
  const enabled = s.configured === WORKFLOW_SCHEMA_NAME;
  const out: WorkflowSchemaAction[] = [];
  if (!enabled && ENABLE_FROM.includes(s.generated)) out.push("enable");
  if (enabled) out.push("disable");
  if (s.generated === "outdated" || s.generated === "current" || (s.generated === "none" && enabled)) out.push("update");
  if (s.generated === "unmanaged") out.push("adopt");
  if (enabled && s.unpinnedChanges.length > 0) out.push("pin");
  if (REMOVE_FROM.includes(s.generated)) out.push("remove");
  return out;
}

/**
 * Previous-default candidates. The client has no project-schema listing, so
 * this is derived from the status alone: the built-in `spec-driven` plus the
 * cwd's configured default when it is some other (non-managed) schema.
 */
export function previousDefaultOptions(s: OpenSpecWorkflowSchemaStatus): string[] {
  const out = [BUILTIN_DEFAULT_SCHEMA];
  if (s.configured && s.configured !== WORKFLOW_SCHEMA_NAME && !out.includes(s.configured)) out.push(s.configured);
  return out;
}

/** True when the folder-section notice chip applies. */
export function workflowSchemaNeedsAttention(s: OpenSpecWorkflowSchemaStatus | undefined): boolean {
  if (!s) return false;
  return (
    s.missing ||
    ["outdated", "newer", "incompatible", "conflict", "unmanaged"].includes(s.generated) ||
    s.unpinnedChanges.length > 0
  );
}

/** Deep link to the Settings section with the cwd preselected. */
export function workflowSchemaSettingsHref(cwd: string): string {
  return `/settings/openspec?cwd=${encodeURIComponent(cwd)}#workflow-schema`;
}
