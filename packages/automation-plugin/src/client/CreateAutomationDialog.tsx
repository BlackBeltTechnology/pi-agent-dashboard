/**
 * Create/Edit automation editor.
 *
 * Redesigned (change: redesign-automation-editor-and-board) into grouped
 * sections — Identity, Trigger, Action, and a collapsed Advanced group — with
 * a two-level trigger picker (category tab strip → event-type checklist, or
 * the cron helper for `scheduled`), a `ModelSelector` + `@role` dropdown
 * instead of a free-text model field, inline help on Advanced fields, and
 * worktree gating on git capability.
 *
 * Edit mode: pass `initialConfig` (+ `initialName`, `initialPromptBody`). The
 * name field is disabled on edit to avoid orphaning; Save routes through the
 * update path (overwrite in place) instead of create.
 *
 * See change: add-automation-plugin, redesign-automation-editor-and-board.
 */

import { AutomationActionEditorSlot, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { getPluginConfig } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import {
  mdiCalendarClock,
  mdiClipboardTextOutline,
  mdiFlashOutline,
  mdiSourceBranch,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type {
  ActionDescriptor,
  ActionPayloadField,
  AutomationConfig,
  AutomationScope,
  Concurrency,
  RunMode,
  Sandbox,
  TriggerCategoryDescriptor,
  Visibility,
} from "../shared/automation-types.js";
import { nextFire } from "../shared/cron.js";
import {
  createAutomation,
  isGitCapable,
  listActions,
  listTriggerKinds,
  updateAutomation,
} from "./api.js";

/** Built-in actions shown before/if `listActions` returns nothing. */
const BUILTIN_ACTIONS: ActionDescriptor[] = [
  { id: "core.prompt", source: "core", label: "Prompt", description: "Seed a fresh session with a prompt.", available: true, payloadSchema: [] },
  { id: "core.skill", source: "core", label: "Skill", description: "Invoke a $skill in a fresh session.", available: true, payloadSchema: [] },
];

/** Map a bare `prompt`/`skill` action kind to its `core.*` id. */
function normalizeActionId(kind: string): string {
  if (kind === "prompt") return "core.prompt";
  if (kind === "skill") return "core.skill";
  return kind;
}

/** Initial payload string-map from a saved action payload. The `inputs` key is
 *  an object owned by a contributed `automation-action-editor` (kept out of the
 *  string-map). See change: wire-flow-inputs-in-automation. */
function coercePayload(payload?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (payload)
    for (const [k, v] of Object.entries(payload)) {
      if (k === "inputs") continue;
      out[k] = v == null ? "" : String(v);
    }
  return out;
}

/** Extract a saved `payload.inputs` object (wired flow inputs), else `{}`.
 *  See change: wire-flow-inputs-in-automation. */
function extractInputs(payload?: Record<string, unknown>): Record<string, unknown> {
  const inp = payload?.inputs;
  return inp && typeof inp === "object" && !Array.isArray(inp)
    ? { ...(inp as Record<string, unknown>) }
    : {};
}

/** Default payload values for an action's schema (enum → first option). */
function defaultsForSchema(schema: ActionPayloadField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of schema) out[f.key] = f.type === "enum" ? (f.options?.[0] ?? "") : "";
  return out;
}

export interface CreateAutomationDialogProps {
  /** Repo cwd used for folder-scope writes. */
  cwd?: string;
  onClose: () => void;
  onCreated?: () => void;
  /** Edit mode: existing config to pre-load. When set, Save updates in place. */
  initialConfig?: AutomationConfig;
  /** Edit mode: existing automation name (field disabled on edit). */
  initialName?: string;
  /** Edit mode: existing scope. */
  initialScope?: AutomationScope;
  /** Edit mode: existing prompt.md body for prompt actions. */
  initialPromptBody?: string;
}

type VisibilityChoice = "default" | Visibility;
type ModelMode = "role" | "model";

const DEFAULT_ROLE_KEYS = ["fast", "planning", "coding", "compact", "vision", "research"];

/** Trigger category → leading icon for the level-1 pills. */
const CATEGORY_ICON: Record<string, string> = {
  scheduled: mdiCalendarClock,
  git: mdiSourceBranch,
  openspec: mdiClipboardTextOutline,
};

/** Humanize a future duration as "in 18h 12m" / "in 3d 4h" / "in 45m". */
function relativeFuture(target: Date, now: Date = new Date()): string {
  let secs = Math.round((target.getTime() - now.getTime()) / 1000);
  if (secs <= 0) return "now";
  const d = Math.floor(secs / 86400);
  secs -= d * 86400;
  const h = Math.floor(secs / 3600);
  secs -= h * 3600;
  const m = Math.floor(secs / 60);
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}
const SANDBOX_HELP: Record<Sandbox, string> = {
  "read-only": "No writes — the run can read the workspace but not modify it.",
  "workspace-write": "Write inside the workspace only (no changes outside the folder).",
  "full-access": "Write anywhere on the machine. Use with caution.",
};

/** Map cron helper fields → a 5-field cron string. */
function buildCron(freq: string, time: string, dow: string): string {
  const [hh, mm] = (time || "09:00").split(":");
  const h = String(Number(hh) || 0);
  const m = String(Number(mm) || 0);
  switch (freq) {
    case "hourly":
      return `${m} * * * *`;
    case "daily":
      return `${m} ${h} * * *`;
    case "weekly":
      return `${m} ${h} * * ${dow}`;
    default:
      return `${m} ${h} * * *`;
  }
}

export function CreateAutomationDialog({
  cwd,
  onClose,
  onCreated,
  initialConfig,
  initialName,
  initialScope,
  initialPromptBody,
}: CreateAutomationDialogProps): React.ReactElement {
  const t = useT();
  const editing = !!initialConfig;
  const ModelSelector = useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector);

  // Roles + models live in the host's "roles" plugin config (routed there by
  // the WS layer). Read non-reactively at render — by the time the editor is
  // open the config is populated.
  const rolesCfg = getPluginConfig("roles") as {
    roles?: Record<string, string>;
    models?: Array<{ provider: string; id: string }>;
  };
  const roleKeys = Object.keys(rolesCfg.roles ?? {});
  const roleOptions = (roleKeys.length > 0 ? roleKeys : DEFAULT_ROLE_KEYS).map((k) => `@${k}`);
  const models = rolesCfg.models ?? [];

  const initialModel = initialConfig?.model ?? "@fast";
  const initialModelMode: ModelMode = initialModel.startsWith("@") ? "role" : "model";

  const [name, setName] = useState(initialName ?? "");
  const [scope, setScope] = useState<AutomationScope>(initialScope ?? "folder");
  const [categories, setCategories] = useState<TriggerCategoryDescriptor[]>([
    { category: "scheduled", label: "Scheduled", status: "enabled", events: [] },
  ]);
  const [category, setCategory] = useState<string>(
    initialConfig ? mapKindToCategory(initialConfig.on.kind) : "scheduled",
  );
  const [selectedEvents, setSelectedEvents] = useState<string[]>(
    (initialConfig?.on.events as string[] | undefined) ?? [],
  );
  // cron helper
  const [freq, setFreq] = useState("weekly");
  const [time, setTime] = useState("09:00");
  const [dow, setDow] = useState("1");
  const [rawCronMode, setRawCronMode] = useState(editing && initialConfig?.on.kind === "schedule");
  const [cron, setCron] = useState(
    (initialConfig?.on.cron as string | undefined) ?? "0 9 * * 1",
  );

  const [actionId, setActionId] = useState<string>(
    normalizeActionId(initialConfig?.action.kind ?? "core.prompt"),
  );
  const [actions, setActions] = useState<ActionDescriptor[]>(BUILTIN_ACTIONS);
  const [actionSearch, setActionSearch] = useState("");
  const [actionPayload, setActionPayload] = useState<Record<string, string>>(() =>
    coercePayload(initialConfig?.action.payload),
  );
  // Object payload written by a contributed `automation-action-editor` (e.g.
  // flows-plugin's input wiring). Persisted as `payload.inputs`. Kept separate
  // from the string-map above. See change: wire-flow-inputs-in-automation.
  const [actionInputs, setActionInputs] = useState<Record<string, unknown>>(() =>
    extractInputs(initialConfig?.action.payload),
  );
  // File-trigger folder path (`on.path`). See change: wire-flow-inputs-in-automation.
  const [filePath, setFilePath] = useState<string>(
    (initialConfig?.on.path as string | undefined) ?? "",
  );
  const [openSources, setOpenSources] = useState<Record<string, boolean>>({ core: true });
  const [promptBody, setPromptBody] = useState(initialPromptBody ?? "");
  const [skill, setSkill] = useState(initialConfig?.action.skill ?? "");

  const [modelMode, setModelMode] = useState<ModelMode>(initialModelMode);
  const [roleValue, setRoleValue] = useState(initialModelMode === "role" ? initialModel : "@fast");
  const [modelValue, setModelValue] = useState(initialModelMode === "model" ? initialModel : "");

  const [mode, setMode] = useState<RunMode>(initialConfig?.mode ?? "local");
  const [sandbox, setSandbox] = useState<Sandbox>(initialConfig?.sandbox ?? "workspace-write");
  const [concurrency, setConcurrency] = useState<Concurrency>(initialConfig?.concurrency ?? "skip");
  const [visibility, setVisibility] = useState<VisibilityChoice>(
    initialConfig?.visibility ?? "default",
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [gitCapable, setGitCapable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load trigger taxonomy descriptors.
  useEffect(() => {
    let cancelled = false;
    void listTriggerKinds().then((cats) => {
      if (!cancelled && cats.length > 0) setCategories(cats);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load registered actions resolved for the cwd (availability + enum options).
  useEffect(() => {
    let cancelled = false;
    void listActions(cwd).then((acts) => {
      if (cancelled || acts.length === 0) return;
      setActions(acts);
      // Keep the selected action's source expanded.
      const sel = acts.find((a) => a.id === actionId);
      if (sel) setOpenSources((prev) => ({ ...prev, [sel.source]: true }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  // Probe git capability for the chosen folder cwd (gates worktree mode).
  useEffect(() => {
    let cancelled = false;
    if (scope === "folder" && cwd) {
      void isGitCapable(cwd).then((ok) => {
        if (!cancelled) setGitCapable(ok);
      });
    } else {
      setGitCapable(false);
    }
    return () => {
      cancelled = true;
    };
  }, [scope, cwd]);

  const worktreeAvailable = scope === "folder" && gitCapable;
  // Force `local` whenever worktree is unavailable.
  useEffect(() => {
    if (!worktreeAvailable && mode === "worktree") setMode("local");
  }, [worktreeAvailable, mode]);

  const activeCategory = useMemo(
    () => categories.find((c) => c.category === category),
    [categories, category],
  );
  const isScheduled = category === "scheduled";
  const effectiveCron = rawCronMode ? cron : buildCron(freq, time, dow);
  const nextRun = useMemo(() => {
    const next = nextFire(effectiveCron, new Date());
    return next ? relativeFuture(next) : null;
  }, [effectiveCron]);

  const model = modelMode === "role" ? roleValue.trim() : modelValue.trim();

  // Submission gating.
  const categoryPlanned = activeCategory?.status === "planned";
  const needsEvents = !isScheduled && (activeCategory?.events.length ?? 0) > 0;
  const eventsMissing = needsEvents && selectedEvents.length === 0;
  const cronInvalid = isScheduled && !nextRun;
  const skillMissing = actionId === "core.skill" && !skill.trim();
  const isFile = category === "file";
  const filePathMissing = isFile && !filePath.trim();
  const submitDisabled =
    busy || categoryPlanned || eventsMissing || (isScheduled && cronInvalid) || filePathMissing || !model || skillMissing;

  function toggleEvent(ev: string): void {
    setSelectedEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    );
  }

  async function submit(): Promise<void> {
    setError(null);
    if (!name.trim()) {
      setError(t("nameRequired", undefined, "Name is required."));
      return;
    }
    if (categoryPlanned) {
      setError(t("categoryUnavailable", undefined, "This trigger category is not available yet."));
      return;
    }
    if (actionId === "core.skill" && !skill.trim()) {
      setError(t("skillRequired", undefined, "Skill name is required."));
      return;
    }
    if (filePathMissing) {
      setError(t("filePathRequiredFile", undefined, "Folder to watch is required for a file trigger."));
      return;
    }
    const onBlock: AutomationConfig["on"] = isScheduled
      ? { kind: "schedule", cron: effectiveCron }
      : isFile
        ? { kind: "file", path: filePath.trim(), events: selectedEvents, settle: "rename-only" }
        : { kind: mapCategoryToKind(category), events: selectedEvents };
    let actionBlock: AutomationConfig["action"];
    if (actionId === "core.prompt") {
      actionBlock = { kind: "prompt", prompt: "./prompt.md" };
    } else if (actionId === "core.skill") {
      actionBlock = { kind: "skill", skill: skill.trim().startsWith("$") ? skill.trim() : `$${skill.trim()}` };
    } else {
      const payload: Record<string, unknown> = { ...actionPayload };
      if (Object.keys(actionInputs).length > 0) payload.inputs = actionInputs;
      actionBlock = { kind: actionId, payload };
    }
    const config: AutomationConfig = {
      on: onBlock,
      action: actionBlock,
      model,
      mode,
      sandbox,
      concurrency,
      ...(visibility !== "default" ? { visibility } : {}),
    };
    setBusy(true);
    const body = {
      scope,
      ...(scope === "folder" && cwd ? { cwd } : {}),
      name: name.trim(),
      config,
      ...(actionId === "core.prompt" ? { promptBody } : {}),
    };
    const res = editing ? await updateAutomation(body) : await createAutomation(body);
    setBusy(false);
    if (res.ok) {
      onCreated?.();
      onClose();
    } else {
      setError(res.error ?? t("saveFailed", undefined, "Failed to save automation."));
    }
  }

  return (
    <div
      data-testid="create-automation-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-lg bg-[var(--bg-primary)] p-4 space-y-4 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-base font-semibold">{editing ? t("editAutomation", undefined, "Edit Automation") : t("createAutomationTitle", undefined, "Create Automation")}</h2>
            <p className="text-[10px] text-[var(--text-muted)] font-mono" data-testid="editor-subtitle">
              {scope === "global" ? "global · ~/.pi/automation" : `folder · ${cwd ?? t("thisRepo", undefined, "(this repo)")}`}
            </p>
          </div>
          {!submitDisabled && (
            <span
              data-testid="armed-chip"
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-[rgba(52,211,153,0.14)] text-[#6ee7b7]"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse motion-reduce:animate-none" />
              {t("armedOnSave", undefined, "armed on save")}
            </span>
          )}
        </div>

        {/* ── IDENTITY ─────────────────────────────────────────── */}
        <Group title="Identity" label={t("groupIdentity", undefined, "Identity")}>
          <Field label={t("fieldName", undefined, "Name")}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder", undefined, "weekly-brief")}
              data-testid="create-name"
              disabled={editing}
              className="input font-mono disabled:opacity-60"
            />
          </Field>
          {editing && (
            <p className="text-[10px] text-[var(--text-muted)]" data-testid="create-name-locked">
              {t("nameLocked", undefined, "Name is locked while editing to avoid orphaning the automation.")}
            </p>
          )}
          <Field label={t("fieldScope", undefined, "Scope")}>
            <Segmented
              testid="create-scope"
              value={scope}
              disabled={editing}
              onChange={(v) => setScope(v as AutomationScope)}
              options={[
                { value: "folder", label: t("scopeFolderOption", undefined, "folder (this repo)") },
                { value: "global", label: t("scopeGlobalOption", undefined, "global (~/.pi/automation)") },
              ]}
            />
          </Field>
        </Group>

        {/* ── TRIGGER ──────────────────────────────────────────── */}
        <Group title="Trigger" label={t("groupTrigger", undefined, "Trigger")}>
          <div className="flex flex-wrap gap-1" data-testid="trigger-categories">
            {categories.map((c) => {
              const selected = c.category === category;
              const planned = c.status === "planned";
              return (
                <button
                  key={c.category}
                  type="button"
                  data-testid={`trigger-cat-${c.category}`}
                  disabled={planned}
                  onClick={() => setCategory(c.category)}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border ${
                    selected
                      ? "border-[var(--accent,#6366f1)] text-[var(--accent,#6366f1)] bg-[var(--accent-soft,rgba(99,102,241,0.12))]"
                      : "border-[var(--border-secondary)] text-[var(--text-secondary)]"
                  } ${planned ? "opacity-40 cursor-not-allowed" : ""}`}
                  title={planned ? t("comingSoon", undefined, "Coming soon") : c.label}
                >
                  <Icon path={CATEGORY_ICON[c.category] ?? mdiFlashOutline} size={0.55} />
                  {c.label}
                  {planned && <span className="ml-1 text-[9px]">{t("soon", undefined, "soon")}</span>}
                </button>
              );
            })}
          </div>

          {categoryPlanned ? (
            <p className="text-xs text-[var(--text-muted)]" data-testid="trigger-planned-note">
              {t("categoryComingSoonNote", undefined, "This trigger category is coming soon and cannot be saved yet.")}
            </p>
          ) : isScheduled ? (
            <div className="space-y-2">
              {!rawCronMode ? (
                <div className="grid grid-cols-3 gap-2">
                  <Field label={t("fieldFrequency", undefined, "Frequency")}>
                    <select
                      value={freq}
                      onChange={(e) => setFreq(e.target.value)}
                      data-testid="create-cron-freq"
                      className="input"
                    >
                      <option value="hourly">hourly</option>
                      <option value="daily">daily</option>
                      <option value="weekly">weekly</option>
                    </select>
                  </Field>
                  {freq !== "hourly" && (
                    <Field label={t("fieldTime", undefined, "Time")}>
                      <input
                        type="time"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        data-testid="create-cron-time"
                        className="input"
                      />
                    </Field>
                  )}
                  {freq === "weekly" && (
                    <Field label={t("fieldDay", undefined, "Day")}>
                      <select
                        value={dow}
                        onChange={(e) => setDow(e.target.value)}
                        data-testid="create-cron-dow"
                        className="input"
                      >
                        <option value="1">Mon</option>
                        <option value="2">Tue</option>
                        <option value="3">Wed</option>
                        <option value="4">Thu</option>
                        <option value="5">Fri</option>
                        <option value="6">Sat</option>
                        <option value="0">Sun</option>
                      </select>
                    </Field>
                  )}
                </div>
              ) : (
                <Field label={t("fieldCron", undefined, "Cron expression")}>
                  <input
                    type="text"
                    value={cron}
                    onChange={(e) => setCron(e.target.value)}
                    data-testid="create-cron"
                    className="input font-mono"
                  />
                </Field>
              )}
              <button
                type="button"
                data-testid="create-cron-raw-toggle"
                onClick={() => {
                  if (!rawCronMode) setCron(buildCron(freq, time, dow));
                  setRawCronMode((v) => !v);
                }}
                className="text-[10px] text-[var(--text-secondary)] underline"
              >
                {rawCronMode ? t("useScheduleHelper", undefined, "use schedule helper") : t("editRawCron", undefined, "edit raw cron")}
              </button>
              <p className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]" data-testid="create-next-run">
                {nextRun ? (
                  <>
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse motion-reduce:animate-none" />
                    {t("nextRunLabel", undefined, "Next run:")} {nextRun}
                  </>
                ) : (
                  t("invalidCron", undefined, "Invalid cron expression")
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-1" data-testid="trigger-events">
              {isFile && (
                <Field label={t("fieldFolderToWatch", undefined, "Folder to watch")}>
                  <input
                    type="text"
                    value={filePath}
                    onChange={(e) => setFilePath(e.target.value)}
                    placeholder={t("filePathPlaceholder", undefined, "/spool/invoices")}
                    data-testid="create-file-path"
                    className="input font-mono"
                  />
                  <p className="text-[10px] text-[var(--text-muted)]" data-testid="create-file-path-help">
                    {t("filePathHelp", undefined, "Fires once per new file that arrives here (settle: rename-only).")}
                  </p>
                  {filePathMissing && (
                    <p className="text-[10px] text-[var(--danger,#ef4444)]" data-testid="file-path-missing">
                      {t("filePathRequired", undefined, "Folder to watch is required.")}
                    </p>
                  )}
                </Field>
              )}
              <p className="text-[10px] text-[var(--text-muted)]">{t("selectEventTypes", undefined, "Select one or more event types:")}</p>
              <div className="grid grid-cols-2 gap-1">
              {activeCategory?.events.map((ev) => {
                const planned = ev.status === "planned";
                return (
                  <label
                    key={ev.event}
                    className={`flex items-center gap-2 text-xs rounded border border-[var(--border-secondary)] px-1.5 py-1 ${planned ? "opacity-40" : ""}`}
                  >
                    <input
                      type="checkbox"
                      data-testid={`create-event-${ev.event}`}
                      disabled={planned}
                      checked={selectedEvents.includes(ev.event)}
                      onChange={() => toggleEvent(ev.event)}
                    />
                    <span className="font-mono">{ev.event}</span>
                    <span className="text-[var(--text-muted)]">{ev.label}</span>
                    {planned && <span className="text-[9px]">{t("soon", undefined, "soon")}</span>}
                  </label>
                );
              })}
              </div>
              {eventsMissing && (
                <p className="text-[10px] text-[var(--danger,#ef4444)]" data-testid="events-missing">
                  {t("eventsMissing", undefined, "Select at least one event type.")}
                </p>
              )}
            </div>
          )}
        </Group>

        {/* ── ACTION ───────────────────────────────────────────── */}
        <Group title="Action" label={t("groupAction", undefined, "Action")}>
          <ActionPicker
            actions={actions}
            selectedId={actionId}
            search={actionSearch}
            openSources={openSources}
            onSearch={setActionSearch}
            onToggleSource={(s) => setOpenSources((p) => ({ ...p, [s]: !p[s] }))}
            onSelect={(desc) => {
              setActionId(desc.id);
              if (desc.id !== "core.prompt" && desc.id !== "core.skill") {
                setActionPayload(defaultsForSchema(desc.payloadSchema));
                // Reset wired inputs when switching actions; a contributed
                // editor re-populates from the new action's own schema.
                setActionInputs({});
              }
            }}
          />
          {actionId === "core.prompt" && (
            <Field label={t("fieldPrompt", undefined, "Prompt (durable, saved to prompt.md)")}>
              <textarea
                value={promptBody}
                onChange={(e) => setPromptBody(e.target.value)}
                rows={4}
                data-testid="create-prompt"
                className="input"
              />
            </Field>
          )}
          {actionId === "core.skill" && (
            <Field label={t("fieldSkill", undefined, "Skill ($skill-name)")}>
              <input
                type="text"
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
                placeholder={t("skillPlaceholder", undefined, "$recent-code-bugfix")}
                data-testid="create-skill"
                className="input font-mono"
              />
            </Field>
          )}
          {actionId !== "core.prompt" && actionId !== "core.skill" && (
            <>
              <ActionPayloadForm
                schema={actions.find((a) => a.id === actionId)?.payloadSchema ?? []}
                values={actionPayload}
                onChange={(k, v) => setActionPayload((p) => ({ ...p, [k]: v }))}
              />
              {/* Contributed payload editor for this action id (e.g. flows-plugin's
                  input wiring), rendered additively below the generic form. Renders
                  nothing when no plugin claims the action id. See change:
                  wire-flow-inputs-in-automation. */}
              <AutomationActionEditorSlot
                actionId={actionId}
                payload={{
                  ...actionPayload,
                  ...(Object.keys(actionInputs).length > 0 ? { inputs: actionInputs } : {}),
                }}
                onChange={(p) => setActionInputs(extractInputs(p))}
                cwd={cwd}
              />
            </>
          )}
          <Field label={t("fieldModel", undefined, "Model")}>
            <div className="flex gap-1 mb-1">
              <button
                type="button"
                data-testid="create-model-mode-role"
                onClick={() => setModelMode("role")}
                className={`px-2 py-0.5 text-[10px] rounded border ${
                  modelMode === "role"
                    ? "border-[var(--accent,#6366f1)] text-[var(--accent,#6366f1)]"
                    : "border-[var(--border-secondary)] text-[var(--text-secondary)]"
                }`}
              >
                @role
              </button>
              <button
                type="button"
                data-testid="create-model-mode-model"
                onClick={() => setModelMode("model")}
                className={`px-2 py-0.5 text-[10px] rounded border ${
                  modelMode === "model"
                    ? "border-[var(--accent,#6366f1)] text-[var(--accent,#6366f1)]"
                    : "border-[var(--border-secondary)] text-[var(--text-secondary)]"
                }`}
              >
                {t("specificModel", undefined, "specific model")}
              </button>
            </div>
            {modelMode === "role" ? (
              <select
                value={roleValue}
                onChange={(e) => setRoleValue(e.target.value)}
                data-testid="create-model-role"
                className="input font-mono"
              >
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            ) : (
              <div data-testid="create-model-selector">
                <ModelSelector
                  current={modelValue || undefined}
                  models={models}
                  onSelect={(label: string) => setModelValue(label)}
                />
                {modelValue && (
                  <p className="text-[10px] text-[var(--text-muted)] font-mono mt-1">{modelValue}</p>
                )}
              </div>
            )}
          </Field>
        </Group>

        {/* ── ADVANCED (collapsed) ─────────────────────────────── */}
        <div className="border-t border-[var(--border-secondary)] pt-2">
          <button
            type="button"
            data-testid="create-advanced-toggle"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="text-xs font-medium text-[var(--text-secondary)]"
          >
            {advancedOpen ? "▾" : "▸"} {t("advanced", undefined, "Advanced")}
          </button>
          {advancedOpen && (
            <div className="space-y-2 pt-2" data-testid="create-advanced">
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("fieldMode", undefined, "Mode")}>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as RunMode)}
                    data-testid="create-mode"
                    className="input"
                  >
                    <option value="local">local</option>
                    <option value="worktree" disabled={!worktreeAvailable}>
                      worktree{!worktreeAvailable ? t("needsGit", undefined, " (needs git)") : ""}
                    </option>
                  </select>
                  {!worktreeAvailable && (
                    <p className="text-[10px] text-[var(--text-muted)]" data-testid="create-worktree-hint">
                      {t("worktreeHint", undefined, "Worktree requires a git repository — falling back to local.")}
                    </p>
                  )}
                </Field>
                <Field label={t("fieldConcurrency", undefined, "Concurrency")}>
                  <select
                    value={concurrency}
                    onChange={(e) => setConcurrency(e.target.value as Concurrency)}
                    data-testid="create-concurrency"
                    className="input"
                  >
                    <option value="skip">skip</option>
                    <option value="queue">queue</option>
                    <option value="parallel">parallel</option>
                  </select>
                </Field>
              </div>
              <Field label={t("fieldSandbox", undefined, "Sandbox")}>
                <select
                  value={sandbox}
                  onChange={(e) => setSandbox(e.target.value as Sandbox)}
                  data-testid="create-sandbox"
                  className="input"
                >
                  <option value="read-only">read-only</option>
                  <option value="workspace-write">workspace-write</option>
                  <option value="full-access">full-access</option>
                </select>
                <p className="text-[10px] text-[var(--text-muted)]" data-testid="create-sandbox-help">
                  {SANDBOX_HELP[sandbox]}
                </p>
              </Field>
              <Field label={t("fieldVisibility", undefined, "Board visibility override")}>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as VisibilityChoice)}
                  data-testid="create-visibility"
                  className="input"
                >
                  <option value="default">{t("visibilityDefaultOption", undefined, "use settings default")}</option>
                  <option value="hidden">hidden</option>
                  <option value="shown">shown</option>
                </select>
              </Field>
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs text-[var(--danger,#ef4444)]" data-testid="create-error">
            {error}
          </p>
        )}

        <p className="text-[10px] text-[var(--text-muted)] font-mono" data-testid="editor-footer-caption">
          {t("writes", undefined, "Writes")} .pi/automation/{name.trim() || "<name>"}/automation.yaml
          {actionId === "core.prompt" ? " + prompt.md" : ""}
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1 text-xs rounded border border-[var(--border-secondary)]">
            {t("cancel", undefined, "Cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitDisabled}
            data-testid="create-submit"
            className="px-3 py-1 text-xs rounded bg-[var(--accent,#6366f1)] text-white disabled:opacity-50"
          >
            {busy ? t("saving", undefined, "Saving…") : editing ? t("save", undefined, "Save") : t("create", undefined, "Create")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** UI category id → on-disk `on.kind` (scheduled → schedule). */
function mapCategoryToKind(category: string): string {
  return category === "scheduled" ? "schedule" : category;
}
/** On-disk `on.kind` → UI category id (schedule → scheduled). */
function mapKindToCategory(kind: string): string {
  return kind === "schedule" ? "scheduled" : kind;
}

function Group({ title, label, children }: { title: string; label?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section
      data-testid={`group-${title.toLowerCase()}`}
      className="space-y-2 rounded-lg border border-[var(--border-secondary)] p-3"
    >
      <h3 className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label ?? title}</h3>
      {children}
    </section>
  );
}

/** Segmented control — a row of pill buttons writing a single value. */
function Segmented<T extends string>({
  testid,
  value,
  options,
  onChange,
  disabled,
}: {
  testid: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <div data-testid={testid} className="inline-flex rounded border border-[var(--border-secondary)] p-0.5">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            data-testid={`${testid}-${o.value}`}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`px-2 py-0.5 text-[11px] rounded ${
              selected
                ? "bg-[var(--accent,#6366f1)] text-white"
                : "text-[var(--text-secondary)]"
            } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="block text-xs text-[var(--text-secondary)]">
      <span className="block mb-0.5">{label}</span>
      {children}
    </label>
  );
}

/**
 * Grouped, searchable action picker (Direction A). Actions grouped by source
 * plugin in collapsible groups; a filter narrows the list; unavailable sources
 * render disabled-with-reason (kept visible for discoverability).
 * See change: register-plugin-automation-events.
 */
function ActionPicker({
  actions,
  selectedId,
  search,
  openSources,
  onSearch,
  onToggleSource,
  onSelect,
}: {
  actions: ActionDescriptor[];
  selectedId: string;
  search: string;
  openSources: Record<string, boolean>;
  onSearch: (v: string) => void;
  onToggleSource: (source: string) => void;
  onSelect: (desc: ActionDescriptor) => void;
}): React.ReactElement {
  const t = useT();
  const q = search.trim().toLowerCase();
  const matched = actions.filter(
    (a) => !q || a.id.toLowerCase().includes(q) || a.label.toLowerCase().includes(q) || a.source.toLowerCase().includes(q),
  );
  // Group by source, preserving the descriptor sort order.
  const sources: string[] = [];
  const bySource = new Map<string, ActionDescriptor[]>();
  for (const a of matched) {
    if (!bySource.has(a.source)) {
      bySource.set(a.source, []);
      sources.push(a.source);
    }
    bySource.get(a.source)!.push(a);
  }
  return (
    <div data-testid="create-action-picker">
      <input
        type="text"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={t("filterActions", { count: actions.length }, `Filter ${actions.length} actions…`)}
        aria-label={t("filterActionsAria", undefined, "Filter actions")}
        data-testid="create-action-search"
        className="input mb-2"
      />
      {matched.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)] px-1 py-2" data-testid="create-action-zero">
          {t("noActionsMatch", { query: search }, `No actions match “${search}”. Try a plugin (`)}<code>flows</code>{t("noActionsOrVerb", undefined, ") or verb (")}<code>run</code>).
        </p>
      ) : (
        <div className="rounded border border-[var(--border-secondary)] divide-y divide-[var(--border-secondary)]">
          {sources.map((src) => {
            const items = bySource.get(src)!;
            const sourceAvailable = items.some((a) => a.available);
            const open = (openSources[src] ?? false) || q.length > 0;
            return (
              <div key={src}>
                <button
                  type="button"
                  onClick={() => onToggleSource(src)}
                  aria-expanded={open}
                  data-testid={`action-group-${src}`}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] font-semibold"
                >
                  <span className="text-[var(--text-muted)]">{open ? "▾" : "▸"}</span>
                  <span className="capitalize">{src}</span>
                  <span className="ml-auto text-[10px] font-normal text-[var(--text-muted)]">
                    {sourceAvailable ? `${items.length} action${items.length !== 1 ? "s" : ""}` : t("notAvailableHere", undefined, "⚠ not available here")}
                  </span>
                </button>
                {open && (
                  <div className="px-2 pb-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {items.map((a) => {
                      const selected = a.id === selectedId;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          disabled={!a.available}
                          title={!a.available ? a.unavailableReason : a.description}
                          onClick={() => onSelect(a)}
                          aria-pressed={selected}
                          data-testid={`create-action-${a.id}`}
                          className={`flex items-center gap-2 rounded border px-2 py-1.5 text-left text-[11px] ${
                            selected
                              ? "border-[var(--accent,#6366f1)] bg-[var(--accent,#6366f1)]/10"
                              : "border-[var(--border-secondary)]"
                          } ${a.available ? "" : "opacity-50 cursor-not-allowed"}`}
                        >
                          <span className="font-mono">
                            <span className="text-[var(--text-muted)]">{a.source}.</span>
                            {a.id.slice(a.source.length + 1)}
                          </span>
                          {a.description && (
                            <span className="ml-auto text-[9.5px] text-[var(--text-muted)] truncate">{a.description}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Schema-driven payload form for the selected plugin action. */
function ActionPayloadForm({
  schema,
  values,
  onChange,
}: {
  schema: ActionPayloadField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}): React.ReactElement {
  const t = useT();
  if (schema.length === 0) {
    return (
      <p className="text-[11px] text-[var(--text-muted)] mt-2" data-testid="action-payload-empty">
        {t("payloadEmpty", undefined, "This action takes no payload. It runs with the automation’s folder scope.")}
      </p>
    );
  }
  return (
    <div className="mt-2 space-y-2" data-testid="action-payload">
      {schema.map((f) => (
        <Field key={f.key} label={f.label}>
          {f.type === "enum" ? (
            <select
              value={values[f.key] ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
              data-testid={`action-payload-${f.key}`}
              className="input"
            >
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : f.type === "multiline" ? (
            <textarea
              value={values[f.key] ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
              rows={3}
              data-testid={`action-payload-${f.key}`}
              className="input"
            />
          ) : (
            // string | text | any UNKNOWN type → plain text input (forward-compat
            // fallback for a newer contributor). See change: decouple-automation-action-registry.
            <input
              type="text"
              value={values[f.key] ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
              data-testid={`action-payload-${f.key}`}
              className="input"
            />
          )}
          {f.help && <span className="block mt-0.5 text-[9.5px] text-[var(--text-muted)]">{f.help}</span>}
        </Field>
      ))}
    </div>
  );
}
