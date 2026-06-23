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
import React, { useEffect, useMemo, useState } from "react";
import { useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { getPluginConfig } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import {
  createAutomation,
  updateAutomation,
  listTriggerKinds,
  isGitCapable,
} from "./api.js";
import { nextFire } from "../shared/cron.js";
import type {
  AutomationConfig,
  AutomationScope,
  Concurrency,
  RunMode,
  Sandbox,
  Visibility,
  TriggerCategoryDescriptor,
} from "../shared/automation-types.js";

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

  const [actionKind, setActionKind] = useState<"prompt" | "skill">(
    initialConfig?.action.kind ?? "prompt",
  );
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
    return next ? next.toLocaleString() : null;
  }, [effectiveCron]);

  const model = modelMode === "role" ? roleValue.trim() : modelValue.trim();

  // Submission gating.
  const categoryPlanned = activeCategory?.status === "planned";
  const needsEvents = !isScheduled && (activeCategory?.events.length ?? 0) > 0;
  const eventsMissing = needsEvents && selectedEvents.length === 0;
  const cronInvalid = isScheduled && !nextRun;
  const submitDisabled =
    busy || categoryPlanned || eventsMissing || (isScheduled && cronInvalid) || !model;

  function toggleEvent(ev: string): void {
    setSelectedEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    );
  }

  async function submit(): Promise<void> {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (categoryPlanned) {
      setError("This trigger category is not available yet.");
      return;
    }
    const onBlock: AutomationConfig["on"] = isScheduled
      ? { kind: "schedule", cron: effectiveCron }
      : { kind: mapCategoryToKind(category), events: selectedEvents };
    const config: AutomationConfig = {
      on: onBlock,
      action:
        actionKind === "prompt"
          ? { kind: "prompt", prompt: "./prompt.md" }
          : { kind: "skill", skill: skill.trim().startsWith("$") ? skill.trim() : `$${skill.trim()}` },
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
      ...(actionKind === "prompt" ? { promptBody } : {}),
    };
    const res = editing ? await updateAutomation(body) : await createAutomation(body);
    setBusy(false);
    if (res.ok) {
      onCreated?.();
      onClose();
    } else {
      setError(res.error ?? "Failed to save automation.");
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
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{editing ? "Edit Automation" : "Create Automation"}</h2>
          {!submitDisabled && (
            <span
              data-testid="armed-chip"
              className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse motion-reduce:animate-none" />
              armed on save
            </span>
          )}
        </div>

        {/* ── IDENTITY ─────────────────────────────────────────── */}
        <Group title="Identity">
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="weekly-brief"
              data-testid="create-name"
              disabled={editing}
              className="input font-mono disabled:opacity-60"
            />
          </Field>
          {editing && (
            <p className="text-[10px] text-[var(--text-muted)]" data-testid="create-name-locked">
              Name is locked while editing to avoid orphaning the automation.
            </p>
          )}
          <Field label="Scope">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as AutomationScope)}
              data-testid="create-scope"
              disabled={editing}
              className="input disabled:opacity-60"
            >
              <option value="folder">folder (this repo)</option>
              <option value="global">global (~/.pi/automation)</option>
            </select>
          </Field>
        </Group>

        {/* ── TRIGGER ──────────────────────────────────────────── */}
        <Group title="Trigger">
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
                  className={`px-2 py-1 text-xs rounded border ${
                    selected
                      ? "border-[var(--accent,#6366f1)] text-[var(--accent,#6366f1)]"
                      : "border-[var(--border-secondary)] text-[var(--text-secondary)]"
                  } ${planned ? "opacity-40 cursor-not-allowed" : ""}`}
                  title={planned ? "Coming soon" : c.label}
                >
                  {c.label}
                  {planned && <span className="ml-1 text-[9px]">soon</span>}
                </button>
              );
            })}
          </div>

          {categoryPlanned ? (
            <p className="text-xs text-[var(--text-muted)]" data-testid="trigger-planned-note">
              This trigger category is coming soon and cannot be saved yet.
            </p>
          ) : isScheduled ? (
            <div className="space-y-2">
              {!rawCronMode ? (
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Frequency">
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
                    <Field label="Time">
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
                    <Field label="Day">
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
                <Field label="Cron expression">
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
                {rawCronMode ? "use schedule helper" : "edit raw cron"}
              </button>
              <p className="text-[10px] text-[var(--text-muted)]" data-testid="create-next-run">
                {nextRun ? `Next run: ${nextRun}` : "Invalid cron expression"}
              </p>
            </div>
          ) : (
            <div className="space-y-1" data-testid="trigger-events">
              <p className="text-[10px] text-[var(--text-muted)]">Select one or more event types:</p>
              {activeCategory?.events.map((ev) => {
                const planned = ev.status === "planned";
                return (
                  <label
                    key={ev.event}
                    className={`flex items-center gap-2 text-xs ${planned ? "opacity-40" : ""}`}
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
                    {planned && <span className="text-[9px]">soon</span>}
                  </label>
                );
              })}
              {eventsMissing && (
                <p className="text-[10px] text-[var(--danger,#ef4444)]" data-testid="events-missing">
                  Select at least one event type.
                </p>
              )}
            </div>
          )}
        </Group>

        {/* ── ACTION ───────────────────────────────────────────── */}
        <Group title="Action">
          <Field label="Action">
            <select
              value={actionKind}
              onChange={(e) => setActionKind(e.target.value as "prompt" | "skill")}
              data-testid="create-action-kind"
              className="input"
            >
              <option value="prompt">prompt</option>
              <option value="skill">skill</option>
            </select>
          </Field>
          {actionKind === "prompt" ? (
            <Field label="Prompt (durable, saved to prompt.md)">
              <textarea
                value={promptBody}
                onChange={(e) => setPromptBody(e.target.value)}
                rows={4}
                data-testid="create-prompt"
                className="input"
              />
            </Field>
          ) : (
            <Field label="Skill ($skill-name)">
              <input
                type="text"
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
                placeholder="$recent-code-bugfix"
                data-testid="create-skill"
                className="input font-mono"
              />
            </Field>
          )}
          <Field label="Model">
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
                specific model
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
            {advancedOpen ? "▾" : "▸"} Advanced
          </button>
          {advancedOpen && (
            <div className="space-y-2 pt-2" data-testid="create-advanced">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Mode">
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as RunMode)}
                    data-testid="create-mode"
                    className="input"
                  >
                    <option value="local">local</option>
                    <option value="worktree" disabled={!worktreeAvailable}>
                      worktree{!worktreeAvailable ? " (needs git)" : ""}
                    </option>
                  </select>
                  {!worktreeAvailable && (
                    <p className="text-[10px] text-[var(--text-muted)]" data-testid="create-worktree-hint">
                      Worktree requires a git repository — falling back to local.
                    </p>
                  )}
                </Field>
                <Field label="Concurrency">
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
              <Field label="Sandbox">
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
              <Field label="Board visibility override">
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as VisibilityChoice)}
                  data-testid="create-visibility"
                  className="input"
                >
                  <option value="default">use settings default</option>
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

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1 text-xs rounded border border-[var(--border-secondary)]">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitDisabled}
            data-testid="create-submit"
            className="px-3 py-1 text-xs rounded bg-[var(--accent,#6366f1)] text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : editing ? "Save" : "Create"}
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

function Group({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section data-testid={`group-${title.toLowerCase()}`} className="space-y-2">
      <h3 className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{title}</h3>
      {children}
    </section>
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
