/**
 * OpenSpec Workflow Schema settings section (`/settings/openspec#workflow-schema`).
 *
 * - "Default for new projects" switch: a Save-Bar draft owned by the caller
 *   (SettingsPanel config draft → `PUT /api/config`); this component only
 *   renders it.
 * - Per-cwd status list + Enable / Disable / Update / Adopt / Pin / Remove.
 *   These write repository files IMMEDIATELY after a confirmation dialog and
 *   are NOT a Save Bar source (no draft, no baseline, no dirty count).
 *   Button availability mirrors the server's allowed-state table.
 *
 * There is no dry-run endpoint, so the dialog's path list is derived
 * client-side from known data; the worktree branch comes from
 * `GET /api/git/worktrees` (best-effort).
 *
 * See change: add-pi-spec-driven-schema.
 */

import { ToggleField } from "@blackbelt-technology/dashboard-plugin-runtime";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { OpenSpecWorkflowSchemaStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { fetchWorktrees } from "../../lib/git/git-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useOpenSpecMap } from "../../lib/openspec/OpenSpecMapContext.js";
import {
  allowedWorkflowSchemaActions,
  BUILTIN_DEFAULT_SCHEMA,
  previousDefaultOptions,
  runWorkflowSchemaAction,
  WORKFLOW_SCHEMA_NAME,
  type WorkflowSchemaAction,
  type WorkflowSchemaOutcome,
} from "../../lib/openspec/openspec-workflow-schema-api.js";

interface Props {
  defaultForNewProjects: boolean;
  onDefaultChange: (next: boolean) => void;
}

const SCHEMA_DIR = "openspec/schemas/pi-spec-driven/";
const CONFIG_PATH = "openspec/config.yaml";
const KEEP_RECORDED = "";

function actionLabel(a: WorkflowSchemaAction): string {
  switch (a) {
    case "enable": return i18nT("openspec.schemaActionEnable", undefined, "Enable");
    case "disable": return i18nT("openspec.schemaActionDisable", undefined, "Disable");
    case "update": return i18nT("openspec.schemaActionUpdate", undefined, "Update");
    case "adopt": return i18nT("openspec.schemaActionAdopt", undefined, "Adopt");
    case "pin": return i18nT("openspec.schemaActionPin", undefined, "Pin…");
    case "remove": return i18nT("openspec.schemaActionRemove", undefined, "Remove");
  }
}

/** Paths the action will write — derived client-side (no dry-run endpoint). */
function pathsFor(action: WorkflowSchemaAction, s: OpenSpecWorkflowSchemaStatus): string[] {
  switch (action) {
    case "enable":
      return [SCHEMA_DIR, CONFIG_PATH, i18nT("openspec.schemaPathEachChange", undefined, "`.openspec.yaml` for each change without one")];
    case "disable":
      return [CONFIG_PATH];
    case "update":
    case "adopt":
      return [SCHEMA_DIR];
    case "remove":
      return [SCHEMA_DIR];
    case "pin":
      return s.unpinnedChanges.map((n) => `openspec/changes/${n}/.openspec.yaml`);
  }
}

/** Stamp-less Disable (no usable recorded previous default) must name one. */
const isStampless = (s: OpenSpecWorkflowSchemaStatus) => s.generated === "none" || s.generated === "unmanaged";

function needsPreviousDefault(action: WorkflowSchemaAction, s: OpenSpecWorkflowSchemaStatus): boolean {
  return action === "adopt" || action === "update" || (action === "disable" && isStampless(s));
}

interface PendingAction {
  cwd: string;
  action: WorkflowSchemaAction;
}

interface ActionResult {
  ok: boolean;
  message: string;
  written: string[];
  warnings: string[];
}

export function OpenSpecWorkflowSchemaSection({ defaultForNewProjects, onDefaultChange }: Props) {
  const map = useOpenSpecMap();
  const entries = [...map.entries()].filter(([, d]) => d.workflowSchema !== undefined);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busyCwd, setBusyCwd] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ActionResult>>({});

  // Deep link: `?cwd=<cwd>#workflow-schema` (folder-section notice chip).
  const search = useSearch();
  const targetCwd = new URLSearchParams(search).get("cwd");
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  // The target row mounts only once its status has hydrated, so re-run on that.
  const targetRowReady = targetCwd !== null && map.get(targetCwd)?.workflowSchema !== undefined;
  useEffect(() => {
    if (window.location.hash !== "#workflow-schema" && !targetCwd) return;
    if (targetCwd && targetRowReady) rowRefs.current.get(targetCwd)?.scrollIntoView?.({ block: "center" });
    else if (!targetCwd) rootRef.current?.scrollIntoView?.({ block: "start" });
  }, [targetCwd, targetRowReady]);

  async function run(p: PendingAction, extra: { previousDefault?: string; pinTo?: string }) {
    const s = map.get(p.cwd)?.workflowSchema;
    if (!s) return;
    setPending(null);
    setBusyCwd(p.cwd);
    const outcome = await runWorkflowSchemaAction({
      cwd: p.cwd,
      action: p.action,
      // `confirm` is the server's explicit-consent flag for Adopt / stamp-less Disable.
      ...(p.action === "adopt" || (p.action === "disable" && isStampless(s)) ? { confirm: true } : {}),
      ...(p.action === "pin" ? { changes: s.unpinnedChanges } : {}),
      ...(extra.pinTo ? { pinTo: extra.pinTo } : {}),
      ...(extra.previousDefault ? { previousDefault: extra.previousDefault } : {}),
    });
    setBusyCwd(null);
    setResults((r) => ({ ...r, [p.cwd]: toResult(outcome) }));
  }

  return (
    <div id="workflow-schema" ref={rootRef} data-testid="openspec-workflow-schema-settings" className="mt-6">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 pb-1 border-b border-[var(--border-secondary)]">
        {i18nT("openspec.workflowSchemaTitle", undefined, "OpenSpec Workflow Schema")}
      </h2>
      <p className="text-xs text-[var(--text-tertiary)] mb-3">
        {i18nT(
          "openspec.workflowSchemaIntro",
          undefined,
          "Manage the dashboard's pi-spec-driven workflow schema per project. Actions below write repository files immediately after you confirm; only the default switch waits for Save.",
        )}
      </p>

      <ToggleField
        label={i18nT("openspec.schemaDefaultLabel", undefined, "Default for new projects")}
        hint={i18nT(
          "openspec.schemaDefaultHint",
          undefined,
          "When on, initializing OpenSpec in a directory that had none also enables pi-spec-driven. Never applies to existing OpenSpec projects.",
        )}
        keyLabel="openspec.workflowSchema.defaultForNewProjects"
        value={defaultForNewProjects}
        onChange={onDefaultChange}
        testIds={{ control: "workflow-schema-default-switch" }}
      />

      <div className="mt-3 space-y-1.5" data-testid="workflow-schema-list">
        {entries.length === 0 && (
          <p className="text-[11px] text-[var(--text-muted)]" data-testid="workflow-schema-empty">
            {i18nT("openspec.schemaNoProjects", undefined, "No project reports a workflow schema status yet.")}
          </p>
        )}
        {entries.map(([cwd, data]) => {
          const s = data.workflowSchema as OpenSpecWorkflowSchemaStatus;
          const result = results[cwd];
          return (
            <div
              key={cwd}
              ref={(el) => {
                if (el) rowRefs.current.set(cwd, el);
                else rowRefs.current.delete(cwd);
              }}
              data-testid={`workflow-schema-row-${cwd}`}
              data-selected={cwd === targetCwd || undefined}
              className={`px-2.5 py-2 rounded border bg-[var(--bg-tertiary)] ${
                cwd === targetCwd ? "border-blue-500/60" : "border-[var(--border-subtle)]"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-[var(--text-secondary)] truncate flex-1 min-w-0">{cwd}</span>
                <span className="text-[10px] text-[var(--text-tertiary)]" data-testid={`workflow-schema-status-${cwd}`}>
                  {i18nT("openspec.schemaStatusLine", { configured: s.configured ?? "—", generated: s.generated }, "schema: {configured} · generated: {generated}")}
                  {s.missing ? ` · ${i18nT("openspec.schemaMissing", undefined, "missing")}` : ""}
                  {s.unpinnedChanges.length > 0
                    ? ` · ${i18nT("openspec.schemaUnpinned", { count: String(s.unpinnedChanges.length) }, "{count} unpinned")}`
                    : ""}
                </span>
                {allowedWorkflowSchemaActions(s).map((a) => (
                  <button
                    key={a}
                    type="button"
                    data-testid={`workflow-schema-${a}-${cwd}`}
                    data-action={a}
                    disabled={busyCwd !== null}
                    onClick={() => setPending({ cwd, action: a })}
                    className="focus-ring text-[10px] px-2 py-1 rounded text-cyan-400 border border-cyan-500/40 bg-cyan-500/[0.06] disabled:opacity-35"
                  >
                    {actionLabel(a)}
                  </button>
                ))}
              </div>
              {result && (
                <div
                  role={result.ok ? "status" : "alert"}
                  data-testid={`workflow-schema-result-${cwd}`}
                  className={`mt-1.5 text-[11px] ${result.ok ? "text-green-400" : "text-red-400"}`}
                >
                  <span>{result.message}</span>
                  {result.written.length > 0 && (
                    <span className="block font-mono text-[10px] text-[var(--text-tertiary)]">{result.written.join(", ")}</span>
                  )}
                  {result.warnings.map((w) => (
                    <span key={w} className="block text-yellow-400">{w}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pending && map.get(pending.cwd)?.workflowSchema && (
        <ConfirmDialog
          pending={pending}
          status={map.get(pending.cwd)?.workflowSchema as OpenSpecWorkflowSchemaStatus}
          onCancel={() => setPending(null)}
          onConfirm={(extra) => void run(pending, extra)}
        />
      )}
    </div>
  );
}

function toResult(o: WorkflowSchemaOutcome): ActionResult {
  const written = o.data?.written ?? [];
  const warnings = o.data?.warnings ?? [];
  if (o.success) {
    const branch = o.data?.worktree.isWorktree && o.data.worktree.branch ? ` (${o.data.worktree.branch})` : "";
    return {
      ok: true,
      message:
        (written.length > 0
          ? i18nT("openspec.schemaDone", undefined, "Done.")
          : i18nT("openspec.schemaNoop", undefined, "Nothing to change.")) + branch,
      written,
      warnings,
    };
  }
  const partial = o.data?.partial
    ? ` ${i18nT("openspec.schemaPartial", undefined, "Partially applied — review the written files.")}`
    : "";
  return { ok: false, message: `${o.error ?? i18nT("openspec.schemaFailed", undefined, "Action failed")}${partial}`, written, warnings };
}

function ConfirmDialog({
  pending,
  status,
  onCancel,
  onConfirm,
}: {
  pending: PendingAction;
  status: OpenSpecWorkflowSchemaStatus;
  onCancel: () => void;
  onConfirm: (extra: { previousDefault?: string; pinTo?: string }) => void;
}) {
  const { cwd, action } = pending;
  const options = previousDefaultOptions(status);
  const hasRecordedStamp = action === "update" && !isStampless(status);
  // Update with a recorded stamp keeps it unless the user picks otherwise;
  // when the repository default is another schema (schema disabled), offer it.
  const initialPrev = hasRecordedStamp
    ? status.configured === WORKFLOW_SCHEMA_NAME || !status.configured ? KEEP_RECORDED : status.configured
    : BUILTIN_DEFAULT_SCHEMA;
  const [previousDefault, setPreviousDefault] = useState(initialPrev);
  const [pinTo, setPinTo] = useState(WORKFLOW_SCHEMA_NAME);
  const [branch, setBranch] = useState<string | null>(null);

  // Worktree branch: best-effort lookup; the dialog still works without it.
  useEffect(() => {
    let live = true;
    fetchWorktrees(cwd)
      .then((list) => {
        const norm = (p: string) => p.replace(/\/+$/, "");
        const hit = list.find((w) => norm(w.path) === norm(cwd));
        if (live && hit && !hit.isMain) setBranch(hit.branch ?? i18nT("openspec.schemaDetached", undefined, "(detached)"));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [cwd]);

  const paths = pathsFor(action, status);
  const showPrev = needsPreviousDefault(action, status);
  const label = actionLabel(action).replace("…", "");

  return (
    <Dialog
      open
      onClose={onCancel}
      title={i18nT("openspec.schemaConfirmTitle", { action: label }, "{action} pi-spec-driven?")}
      testId="workflow-schema-confirm"
    >
      <div className="space-y-2 text-xs text-[var(--text-secondary)] leading-relaxed">
        <p className="font-mono text-[11px] break-all">{cwd}</p>
        {branch !== null && (
          <p data-testid="workflow-schema-branch">
            {i18nT("openspec.schemaWorktreeBranch", { branch }, "Worktree branch: {branch}")}
          </p>
        )}
        <p>{i18nT("openspec.schemaWillWrite", undefined, "These paths will be written:")}</p>
        <ul className="list-disc pl-4 font-mono text-[11px]" data-testid="workflow-schema-paths">
          {paths.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {action === "update" && (
          <p data-testid="workflow-schema-affected">
            {i18nT(
              "openspec.schemaAffected",
              { count: String(status.affectedChanges.length) },
              "{count} active change(s) resolve to pi-spec-driven and are affected.",
            )}
          </p>
        )}
        {action === "adopt" && (
          <p className="text-yellow-400">
            {i18nT(
              "openspec.schemaAdoptWarning",
              undefined,
              "Adopting regenerates pi-spec-driven from the package base: any hand customizations are discarded.",
            )}
          </p>
        )}
        {showPrev && (
          <label className="flex items-center gap-2">
            <span>{i18nT("openspec.schemaPreviousDefault", undefined, "Previous default")}</span>
            <select
              data-testid="workflow-schema-previous-default"
              value={previousDefault}
              onChange={(e) => setPreviousDefault(e.target.value)}
              className="focus-ring rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-1.5 py-1"
            >
              {hasRecordedStamp && (
                <option value={KEEP_RECORDED}>{i18nT("openspec.schemaKeepRecorded", undefined, "keep recorded value")}</option>
              )}
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        )}
        {action === "pin" && (
          <label className="flex items-center gap-2">
            <span>{i18nT("openspec.schemaPinTo", undefined, "Pin to")}</span>
            <select
              data-testid="workflow-schema-pin-target"
              value={pinTo}
              onChange={(e) => setPinTo(e.target.value)}
              className="focus-ring rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-1.5 py-1"
            >
              <option value={WORKFLOW_SCHEMA_NAME}>{WORKFLOW_SCHEMA_NAME}</option>
              <option value={BUILTIN_DEFAULT_SCHEMA}>{BUILTIN_DEFAULT_SCHEMA}</option>
            </select>
          </label>
        )}
      </div>
      <Dialog.Footer>
        <Dialog.Cancel onClick={onCancel} testId="workflow-schema-cancel" />
        <Dialog.Action
          intent={action === "remove" || action === "adopt" ? "danger" : "primary"}
          testId="workflow-schema-confirm-action"
          onClick={() =>
            onConfirm({
              ...(showPrev && previousDefault ? { previousDefault } : {}),
              ...(action === "pin" ? { pinTo } : {}),
            })
          }
        >
          {label}
        </Dialog.Action>
      </Dialog.Footer>
    </Dialog>
  );
}
