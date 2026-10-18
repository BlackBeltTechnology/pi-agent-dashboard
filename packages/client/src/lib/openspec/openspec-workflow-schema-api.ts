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
import { t as i18nT } from "../i18n/i18n.js";

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
interface WorkflowSchemaResult {
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
  // D3: the server refuses Remove while the config still names the schema.
  if (!enabled && REMOVE_FROM.includes(s.generated)) out.push("remove");
  return out;
}

/**
 * Previous-default candidates: the built-in `spec-driven` plus the project's
 * own schemas (`workflowSchema.projectSchemas`, server-listed from
 * `openspec/schemas/`) — never a user-level-only schema.
 */
export function previousDefaultOptions(s: OpenSpecWorkflowSchemaStatus): string[] {
  const out = [BUILTIN_DEFAULT_SCHEMA];
  for (const name of s.projectSchemas) {
    if (name !== WORKFLOW_SCHEMA_NAME && !out.includes(name)) out.push(name);
  }
  return out;
}

export type WorkflowSchemaSeverity = "error" | "warning" | "success" | "info" | "neutral";

export type WorkflowSchemaCardKey =
  | "missingDefault"
  | "missing"
  | "unmanaged"
  | "incompatible"
  | "conflict"
  | "newer"
  | "kept"
  | "outdated"
  | "unpinned"
  | "enabled"
  | "none";

/** A run of sentence text; `code` parts render monospace (schema / file names). */
export interface SentencePart {
  text: string;
  code?: boolean;
}

export interface WorkflowSchemaPresentation {
  key: WorkflowSchemaCardKey;
  severity: WorkflowSchemaSeverity;
  /** Pill label, e.g. "Update available". */
  label: string;
  /** Folder-chip label (after "Workflow schema: "), counts only. */
  chipLabel: string;
  /** One plain-language sentence for the card. */
  sentence: SentencePart[];
  /** The single recommended action button, if any. */
  recommended: WorkflowSchemaAction | null;
  /** Every other allowed action, in menu order (Remove last). */
  menu: WorkflowSchemaAction[];
}

/**
 * Split a translated template at `{name}` placeholders: `codes` placeholders
 * become `code` parts, `texts` placeholders plain text, so translators get
 * whole sentences. (Fetch the template WITHOUT vars: `t()` blanks every
 * placeholder it was not given.)
 */
export function richParts(template: string, codes: Record<string, string>, texts: Record<string, string> = {}): SentencePart[] {
  return template
    .split(/(\{\w+\})/)
    .filter((chunk) => chunk !== "")
    .map((chunk) => {
      const name = /^\{(\w+)\}$/.exec(chunk)?.[1];
      if (name === undefined) return { text: chunk };
      if (name in codes) return { text: codes[name], code: true };
      return { text: name in texts ? texts[name] : chunk };
    });
}

const MENU_ORDER: WorkflowSchemaAction[] = ["update", "adopt", "pin", "enable", "disable", "remove"];

/** Singular/plural pick: the catalog has no plural rules, so two keys. */
function tn(count: number, oneKey: string, oneFallback: string, otherKey: string, otherFallback: string): string {
  return count === 1
    ? i18nT(oneKey, { count: String(count) }, oneFallback)
    : i18nT(otherKey, { count: String(count) }, otherFallback);
}

/** First matching row of the settings-panel card table wins. */
function cardKey(s: OpenSpecWorkflowSchemaStatus): WorkflowSchemaCardKey {
  const enabled = s.configured === WORKFLOW_SCHEMA_NAME;
  const g = s.generated;
  if (s.missing && !enabled) return "missingDefault";
  if (s.missing || (enabled && g === "none")) return "missing";
  if (g === "unmanaged" || g === "incompatible" || g === "conflict" || g === "newer") return g;
  if (!enabled && (g === "current" || g === "outdated")) return "kept";
  if (g === "outdated") return "outdated";
  if (enabled && s.unpinnedChanges.length > 0) return "unpinned";
  if (enabled) return "enabled";
  return "none";
}

/**
 * Pure card presentation (pill, sentence, recommended action, menu) for one
 * cwd. Mirrors the 11-row table of the settings-panel delta; the allowed
 * actions themselves come from `allowedWorkflowSchemaActions`.
 * See change: add-pi-spec-driven-schema.
 */
export function workflowSchemaPresentation(s: OpenSpecWorkflowSchemaStatus): WorkflowSchemaPresentation {
  const key = cardKey(s);
  const cfg = s.configured ?? BUILTIN_DEFAULT_SCHEMA;
  const n = s.unpinnedChanges.length;
  const T = (k: string, fb: string) => i18nT(`openspec.schemaPill.${k}`, undefined, fb);
  const C = (k: string, fb: string) => i18nT(`openspec.schemaChip.${k}`, undefined, fb);
  const rich = (k: string, fb: string, codes: Record<string, string>) => richParts(i18nT(`openspec.schemaSentence.${k}`, undefined, fb), codes);

  let severity: WorkflowSchemaSeverity;
  let label: string;
  let chipLabel: string;
  let sentence: SentencePart[];
  let recommended: WorkflowSchemaAction | null;
  switch (key) {
    case "missingDefault":
      severity = "error";
      label = T("missingDefault", "Default schema missing");
      chipLabel = C("missingDefault", "default schema missing");
      sentence = rich("missingDefault", "The config names {cfg}, which no schema directory provides.", { cfg });
      recommended = null;
      break;
    case "missing":
      severity = "error";
      label = T("missing", "Schema files missing");
      chipLabel = C("missing", "files missing");
      sentence = rich("missing", "The config names {cfg} but its files are absent (partial checkout?).", { cfg: WORKFLOW_SCHEMA_NAME });
      recommended = "update";
      break;
    case "unmanaged":
      severity = "warning";
      label = T("unmanaged", "Not managed");
      chipLabel = C("unmanaged", "not managed");
      sentence = rich("unmanaged", "{dir} has no dashboard stamp. Adopting regenerates it.", { dir: `${WORKFLOW_SCHEMA_NAME}/` });
      recommended = "adopt";
      break;
    case "incompatible":
      severity = "error";
      label = T("incompatible", "CLI too old");
      chipLabel = C("incompatible", "CLI too old");
      sentence = rich("incompatible", "This schema needs a newer OpenSpec CLI. Update the CLI.", {});
      recommended = null;
      break;
    case "conflict":
      severity = "error";
      label = T("conflict", "Version conflict");
      chipLabel = C("conflict", "version conflict");
      sentence = rich("conflict", "Stamp is newer in one part and older in the other. Align the dashboard and CLI versions.", {});
      recommended = null;
      break;
    case "newer":
      severity = "info";
      label = T("newer", "Newer version");
      chipLabel = C("newer", "newer version");
      sentence = rich("newer", "Generated by a newer dashboard; left untouched.", {});
      recommended = null;
      break;
    case "kept":
      severity = "neutral";
      label = T("kept", "Disabled, files kept");
      // Chip mirrors the card pill (settings-panel spec: same severity + label, lower case).
      chipLabel = C("kept", "disabled, files kept");
      sentence =
        s.generated === "outdated"
          ? rich("keptOutdated", "Schema files are still in the repo (an update is available); new changes use {cfg}.", { cfg })
          : rich("kept", "Schema files are still in the repo; new changes use {cfg}.", { cfg });
      recommended = "enable";
      break;
    case "outdated":
      severity = "warning";
      label = T("outdated", "Update available");
      chipLabel = C("outdated", "update available");
      sentence = rich("outdated", "Generated by an older dashboard or CLI.", {});
      recommended = "update";
      break;
    case "unpinned":
      severity = "warning";
      label = tn(n, "openspec.schemaPill.unpinnedOne", "{count} change not pinned", "openspec.schemaPill.unpinnedMany", "{count} changes not pinned");
      chipLabel = tn(n, "openspec.schemaChip.unpinnedOne", "{count} change not pinned", "openspec.schemaChip.unpinnedMany", "{count} changes not pinned");
      sentence = rich("unpinned", "These changes follow the new default because they have no {file}:", { file: ".openspec.yaml" });
      recommended = "pin";
      break;
    case "enabled":
      severity = "success";
      label = T("enabled", "Enabled");
      chipLabel = T("enabled", "Enabled");
      sentence = rich("use", "New changes use {cfg}.", { cfg: WORKFLOW_SCHEMA_NAME });
      recommended = null;
      break;
    default:
      severity = "neutral";
      label = T("none", "Not enabled");
      chipLabel = T("none", "Not enabled");
      sentence = rich("use", "New changes use {cfg}.", { cfg });
      recommended = "enable";
  }

  const allowed = allowedWorkflowSchemaActions(s);
  const menu = MENU_ORDER.filter((a) => allowed.includes(a) && a !== recommended);
  return { key, severity, label, chipLabel, sentence, recommended, menu };
}

/** Severity pill / chip classes — severity fg only ever on its own bg. */
export const SEVERITY_PILL_CLASS: Record<WorkflowSchemaSeverity, string> = {
  success: "bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)] border-[var(--severity-success-border)]",
  info: "bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)] border-[var(--severity-info-border)]",
  warning: "bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)] border-[var(--severity-warning-border)]",
  error: "bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)] border-[var(--severity-error-border)]",
  neutral: "bg-[var(--severity-neutral-bg)] text-[var(--severity-neutral-fg)] border-[var(--severity-neutral-border)]",
};

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
