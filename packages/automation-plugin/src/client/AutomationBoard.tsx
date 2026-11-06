/**
 * Automation board (shell-overlay-route `/folder/:encodedCwd/automations`).
 *
 * Per-automation definition cards reuse the dashboard's session-status visual
 * language (status rail + dot, headless source icon, status pill, neon glow +
 * rim on the selected card) via the local `automation-card-visuals` replica;
 * the running stripe sits on the rail and running pill only. Each card owns:
 *
 *  - a humanised schedule (cron on hover), relative next fire, action summary;
 *  - a visible Edit button (the name opens the editor too); only Delete stays
 *    under `⋯` (popover portal);
 *  - a last-run line and a collapsible run history grouped by (scope, name):
 *    latest 3 + "Show all (N)", human start label (run id as tooltip),
 *    duration or reason, findings chip only above 0, **Open session** and a
 *    status link (Monitor / Result / Log); parents expand to child rows;
 *  - an orphaned state (pill + warning notice + confirm-before-Stop) and one
 *    honest Stop outcome notice (killed / not-found / unconfirmed).
 *
 * Result / Log render as markdown in the `ui:dialog` primitive.
 *
 * See change: add-automation-plugin, fix-automation-slot-parity-and-routing,
 * redesign-automation-editor-and-board, automation-ui-mockup-parity,
 * polish-automation-board.
 */

import { SettingsNotice, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { encodeFolderPath } from "@blackbelt-technology/dashboard-plugin-runtime/sdk";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { Icon } from "@mdi/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import type { AutomationConfig, AutomationScope, DiscoveredAutomation, RunRecord } from "../shared/automation-types.js";
import { nextFire } from "../shared/cron.js";
import {
  deleteAutomation,
  getAutomationDefinition,
  getRunResult,
  listAutomations,
  listRuns,
  runAutomationNow,
  type StopRunResult,
  stopAutomationRun,
  updateAutomation,
} from "./api.js";
import {
  cardButtonClass,
  deriveCardState,
  dotClass,
  GLOW_FX_CLASS,
  GLOW_FX_OUTER_CLASS,
  headlessSourceIcon,
  pillClass,
  pillLabel,
  RING_FX_CLASS,
  type RunPillStatus,
  railBgClass,
  runPillClass,
  stripeFxClass,
} from "./automation-card-visuals.js";
import { CreateAutomationDialog, type EditorSection } from "./CreateAutomationDialog.js";
import { humanizeCron, relativeFire, runDuration, runStartLabel, sessionHref } from "./schedule-format.js";

export interface AutomationBoardProps {
  params?: Record<string, string>;
  /** Decoded folder path of the `/folder/:encodedCwd/automations` route (host-provided). */
  cwd?: string;
  onBack?: () => void;
}

/** Runs shown per card before "Show all". */
const HISTORY_PREVIEW = 3;

interface EditTarget {
  name: string;
  scope: DiscoveredAutomation["scope"];
  config: AutomationConfig;
  promptBody?: string;
  section: EditorSection;
}

/** A run's visible status: the listing's `orphaned` flag wins over `running`. */
export function runPillStatus(r: RunRecord): RunPillStatus {
  return r.orphaned ? "orphaned" : r.status;
}

const scopeOf = (r: RunRecord): AutomationScope => (r.scope === "global" ? "global" : "folder");
const keyOf = (scope: AutomationScope, name: string) => `${scope}:${name}`;

export function AutomationBoard({ params, cwd, onBack }: AutomationBoardProps): React.ReactElement {
  const t = useT();
  const [, setLocation] = useLocation();
  const Dialog = useUiPrimitive(UI_PRIMITIVE_KEYS.dialog);
  const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
  // The host decodes the folder segment; a route that carries one but yields no `cwd` is malformed.
  const invalidRoute = !!params?.encodedCwd && cwd === undefined;
  const repoCrumb = cwd ? cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || cwd : undefined;
  const [automations, setAutomations] = useState<DiscoveredAutomation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [openResult, setOpenResult] = useState<{ title: string; text: string } | null>(null);

  useEffect(() => {
    if (invalidRoute) return;
    let cancelled = false;
    async function load() {
      const a = await listAutomations(cwd);
      if (cancelled) return;
      setAutomations(a);
      setLoaded(true);
      // The listing tags every record with its scope; older servers do not, so
      // fill it from the request (same-named folder/global automations must
      // keep separate histories).
      const folderRuns = (await listRuns("folder", cwd)).map((r) => ({ ...r, scope: r.scope ?? ("folder" as const) }));
      const globalRuns = (await listRuns("global", undefined)).map((r) => ({ ...r, scope: r.scope ?? ("global" as const) }));
      if (!cancelled) setRuns([...folderRuns, ...globalRuns]);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [cwd, reloadKey, invalidRoute]);

  const refresh = () => setReloadKey((k) => k + 1);

  /** Runs per (scope, name), newest first. */
  const runsByKey = useMemo(() => {
    const m = new Map<string, RunRecord[]>();
    for (const r of runs) {
      const k = keyOf(scopeOf(r), r.name);
      const list = m.get(k) ?? [];
      list.push(r);
      m.set(k, list);
    }
    for (const list of m.values()) list.sort((a, b) => b.startedAt - a.startedAt);
    return m;
  }, [runs]);

  async function openEditor(a: DiscoveredAutomation, section: EditorSection): Promise<void> {
    const def = await getAutomationDefinition(a.scope, a.scope === "folder" ? cwd : undefined, a.name);
    if (!def) return;
    setEditTarget({
      name: a.name,
      scope: a.scope,
      config: def.config,
      section,
      ...(def.promptBody !== undefined ? { promptBody: def.promptBody } : {}),
    });
  }

  async function onDelete(a: DiscoveredAutomation): Promise<void> {
    const ok = typeof window !== "undefined" ? window.confirm(t("deleteConfirm", { name: a.name }, `Delete automation "${a.name}"?`)) : true;
    if (!ok) return;
    await deleteAutomation(a.scope, a.scope === "folder" ? cwd : undefined, a.name);
    refresh();
  }

  async function onToggleEnabled(a: DiscoveredAutomation): Promise<void> {
    if (!a.config) return;
    const def = await getAutomationDefinition(a.scope, a.scope === "folder" ? cwd : undefined, a.name);
    if (!def) return;
    const nextConfig: AutomationConfig = { ...def.config, disabled: !def.config.disabled };
    await updateAutomation({
      scope: a.scope,
      ...(a.scope === "folder" && cwd ? { cwd } : {}),
      name: a.name,
      config: nextConfig,
      ...(def.promptBody !== undefined ? { promptBody: def.promptBody } : {}),
    });
    refresh();
  }

  async function onRunNow(a: DiscoveredAutomation): Promise<void> {
    await runAutomationNow(a.scope, a.scope === "folder" ? cwd : undefined, a.name);
    refresh();
  }

  async function onStop(a: DiscoveredAutomation, run: RunRecord): Promise<StopRunResult> {
    try {
      return await stopAutomationRun(a.scope, a.scope === "folder" ? cwd : undefined, run.runId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      refresh();
    }
  }

  async function onViewResult(r: RunRecord): Promise<void> {
    const scope = scopeOf(r);
    const text = await getRunResult(scope, scope === "folder" ? cwd : undefined, r.runId);
    setOpenResult({
      title: `${r.actionLabel ?? r.name} · ${runStartLabel(r.startedAt, new Date())}`,
      text: text ?? t("noResult", undefined, "(no result)"),
    });
  }

  const nav = {
    session: (r: RunRecord) => {
      const href = sessionHref(r);
      if (href) setLocation(href);
    },
    monitor: (r: RunRecord) => {
      if (cwd && r.sessionId) {
        setLocation(`/folder/${encodeFolderPath(cwd)}/automations/run/${encodeURIComponent(r.sessionId)}`);
      }
    },
    result: (r: RunRecord) => void onViewResult(r),
  };

  if (invalidRoute) {
    return (
      <div data-testid="automation-board" className="flex flex-col gap-3 p-3 text-sm">
        <div className="flex items-center gap-3">
          {onBack && (
            <button type="button" data-testid="automation-board-back" onClick={onBack} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              {t("back", undefined, "← Back")}
            </button>
          )}
          <p className="text-xs text-[var(--severity-error-fg)]" data-testid="automation-board-invalid">
            {t("invalidRoute", undefined, "Invalid folder route.")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="automation-board" className="flex flex-col gap-3 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {onBack && (
            <button type="button" data-testid="automation-board-back" onClick={onBack} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              {t("back", undefined, "← Back")}
            </button>
          )}
          <h2 className="text-base font-semibold">{t("automations", undefined, "Automations")}</h2>
          {repoCrumb && (
            <span className="text-xs text-[var(--text-secondary)]" data-testid="automation-repo-crumb">
              {repoCrumb}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" data-testid="automation-create-btn" onClick={() => setCreating(true)} className={cardButtonClass("primary")}>
            {t("createAutomation", undefined, "+ Create Automation")}
          </button>
          <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} data-testid="automation-show-all" />
            {t("showArchived", undefined, "Show archived")}
          </label>
        </div>
      </div>

      {creating && (
        <CreateAutomationDialog cwd={cwd} onClose={() => setCreating(false)} onCreated={refresh} />
      )}
      {editTarget && (
        <CreateAutomationDialog
          cwd={cwd}
          onClose={() => setEditTarget(null)}
          onCreated={refresh}
          initialName={editTarget.name}
          initialScope={editTarget.scope}
          initialConfig={editTarget.config}
          initialSection={editTarget.section}
          {...(editTarget.promptBody !== undefined ? { initialPromptBody: editTarget.promptBody } : {})}
        />
      )}

      <section data-testid="automation-list">
        <h3 className="text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-1">{t("definitions", undefined, "Definitions")}</h3>
        {automations.length === 0 ? (
          loaded && (
            <div data-testid="automation-empty" className="flex flex-col items-start gap-2 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{t("noAutomations", undefined, "No automations in this folder.")}</p>
              <p className="text-xs text-[var(--text-secondary)]">
                {t(
                  "emptyExplainer",
                  undefined,
                  "An automation runs a prompt, skill or flow in its own session on a schedule. Each run keeps its result here, one click from its session.",
                )}
              </p>
              <button type="button" data-testid="automation-empty-create" onClick={() => setCreating(true)} className={cardButtonClass("primary")}>
                {t("createAutomation", undefined, "+ Create Automation")}
              </button>
            </div>
          )
        ) : (
          <ul className="space-y-2">
            {automations.map((a) => {
              const key = keyOf(a.scope, a.name);
              return (
                <AutomationCard
                  key={key}
                  automation={a}
                  runs={runsByKey.get(key) ?? []}
                  showArchived={showArchived}
                  selected={selected === key}
                  onSelect={() => setSelected(key)}
                  onRunNow={() => void onRunNow(a)}
                  onStop={(run) => onStop(a, run)}
                  onEdit={(section) => void openEditor(a, section)}
                  onToggle={() => void onToggleEnabled(a)}
                  onDelete={() => void onDelete(a)}
                  nav={nav}
                />
              );
            })}
          </ul>
        )}
      </section>

      {openResult && (
        <Dialog open onClose={() => setOpenResult(null)} title={openResult.title} size="lg" testId="run-result-panel">
          <MarkdownContent content={openResult.text} />
        </Dialog>
      )}
    </div>
  );
}

interface RunNav {
  session: (r: RunRecord) => void;
  monitor: (r: RunRecord) => void;
  result: (r: RunRecord) => void;
}

/** Honest Stop outcome (or a failed request) → notice tone + text. */
function stopNotice(
  t: ReturnType<typeof useT>,
  res: StopRunResult,
): { tone: "success" | "warning" | "error"; text: string } {
  if (!res.ok) return { tone: "error", text: t("stopFailed", { error: res.error ?? "" }, `Stop failed: ${res.error ?? "unknown error"}`) };
  const suffix = res.alreadyFinalized ? ` ${t("stopAlreadyFinalized", undefined, "The run had already been finalized.")}` : "";
  switch (res.outcome) {
    case "killed":
      return { tone: "success", text: t("stopKilled", undefined, "Stopped. The process is gone.") + suffix };
    case "not-found":
      return { tone: "warning", text: t("stopNotFound", undefined, "Run marked stopped. No session was found to terminate.") + suffix };
    default:
      return { tone: "warning", text: t("stopUnconfirmed", undefined, "Stop requested, but the process may still be running.") + suffix };
  }
}

function AutomationCard({
  automation: a,
  runs,
  showArchived,
  selected,
  onSelect,
  onRunNow,
  onStop,
  onEdit,
  onToggle,
  onDelete,
  nav,
}: {
  automation: DiscoveredAutomation;
  runs: RunRecord[];
  showArchived: boolean;
  selected: boolean;
  onSelect: () => void;
  onRunNow: () => void;
  onStop: (run: RunRecord) => Promise<StopRunResult>;
  onEdit: (section: EditorSection) => void;
  onToggle: () => void;
  onDelete: () => void;
  nav: RunNav;
}): React.ReactElement {
  const t = useT();
  const Popover = useUiPrimitive(UI_PRIMITIVE_KEYS.popover);
  const cfg = a.config;
  const disabled = !!cfg?.disabled;
  const liveRun = runs.find((r) => r.status === "running");
  const orphaned = !!liveRun?.orphaned;
  const state = deriveCardState({ valid: a.valid, disabled, running: !!liveRun, orphaned });
  const lastRun = runs[0];
  const now = new Date();
  const cron = cfg && cfg.on.kind === "schedule" && typeof cfg.on.cron === "string" ? cfg.on.cron : null;
  const next = cron ? nextFire(cron, now) : null;
  const stripeFx = stripeFxClass(state);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stopPending, setStopPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [historyAll, setHistoryAll] = useState(false);
  const overflowRef = useRef<HTMLButtonElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);

  const visibleRuns = showArchived ? runs : runs.filter((r) => !r.archived);
  const shownRuns = historyAll ? visibleRuns : visibleRuns.slice(0, HISTORY_PREVIEW);

  async function doStop(run: RunRecord): Promise<void> {
    setConfirmOpen(false);
    setStopPending(true);
    setNotice(null);
    const res = await onStop(run);
    setStopPending(false);
    setNotice(stopNotice(t, res));
  }

  return (
    <li
      data-testid={`automation-def-${a.name}`}
      onClick={onSelect}
      className={`relative isolate flex overflow-hidden rounded-xl border bg-[var(--bg-secondary)] ${
        selected ? "border-[var(--accent)]" : "border-[var(--border-secondary)]"
      }`}
    >
      {selected && <div className={`${GLOW_FX_CLASS} ${GLOW_FX_OUTER_CLASS}`} aria-hidden="true" />}
      {selected && <div className={GLOW_FX_CLASS} aria-hidden="true" />}
      {selected && <div className={RING_FX_CLASS} aria-hidden="true" />}

      <div className={`relative isolate w-1 self-stretch overflow-hidden ${railBgClass(state)}`} data-testid={`automation-rail-${a.name}`} aria-hidden="true">
        {stripeFx && <div className={stripeFx} data-testid={`automation-rail-stripe-${a.name}`} />}
      </div>

      <div className="flex-1 min-w-0 p-3 flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Icon path={headlessSourceIcon} size={0.5} className="text-[var(--text-secondary)]" data-testid={`automation-source-icon-${a.name}`} />
          <span className={`inline-block w-2 h-2 rounded-full ${dotClass(state)}`} data-testid={`automation-dot-${a.name}`} />
          <button
            type="button"
            data-testid={`automation-name-${a.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onEdit("identity");
            }}
            className="focus-ring rounded font-mono text-[13px] font-semibold text-[var(--text-primary)] hover:underline"
            title={t("editName", { name: a.name }, `Edit ${a.name}`)}
          >
            {a.name}
          </button>
          <span className="text-[11px] rounded px-1 bg-[var(--bg-surface)] text-[var(--text-secondary)]">{a.scope}</span>
          <span className={pillClass(state)} data-testid={`automation-enabled-${a.name}`}>
            {stripeFx && <span className={stripeFx} data-testid={`automation-pill-stripe-${a.name}`} aria-hidden="true" />}
            {pillLabel(state)}
          </span>
          <span className="flex-1" />
          <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {a.valid && (liveRun ? (
              <button
                ref={stopRef}
                type="button"
                data-testid={`stop-${a.name}`}
                disabled={stopPending}
                onClick={() => (orphaned ? setConfirmOpen((v) => !v) : void doStop(liveRun))}
                className={cardButtonClass("danger")}
              >
                {stopPending ? t("stopping", undefined, "Stopping…") : t("stop", undefined, "⏹ Stop")}
              </button>
            ) : (
              <>
                <button type="button" data-testid={`run-now-${a.name}`} onClick={onRunNow} className={cardButtonClass()}>
                  {t("runNow", undefined, "▶ Run now")}
                </button>
                <button type="button" data-testid={`toggle-${a.name}`} onClick={onToggle} className={cardButtonClass()}>
                  {disabled ? t("enable", undefined, "Enable") : t("disable", undefined, "Disable")}
                </button>
              </>
            ))}
            <button type="button" data-testid={`edit-${a.name}`} onClick={() => onEdit("identity")} className={cardButtonClass()}>
              {t("edit", undefined, "Edit")}
            </button>
            <button
              ref={overflowRef}
              type="button"
              data-testid={`overflow-${a.name}`}
              aria-label={t("moreActions", undefined, "More actions")}
              onClick={() => setMenuOpen((v) => !v)}
              className={cardButtonClass()}
            >
              ⋯
            </button>
            {menuOpen && overflowRef.current && (
              // Body portal so the card's `overflow-hidden` (which clips the
              // decorative FX layers) does not clip the menu. See change:
              // fix-automation-overflow-menu-clip.
              <Popover anchorEl={overflowRef.current} onDismiss={() => setMenuOpen(false)}>
                <div
                  data-testid={`overflow-menu-${a.name}`}
                  className="flex min-w-[160px] flex-col rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-1"
                >
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`delete-${a.name}`}
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="focus-ring flex items-center min-h-[36px] max-sm:min-h-[44px] px-3 rounded text-sm text-[var(--severity-error-fg)] hover:bg-[var(--bg-hover)]"
                  >
                    {t("delete", undefined, "Delete")}
                  </button>
                </div>
              </Popover>
            )}
            {confirmOpen && liveRun && stopRef.current && (
              <Popover anchorEl={stopRef.current} onDismiss={() => setConfirmOpen(false)}>
                <div
                  data-testid={`stop-confirm-${a.name}`}
                  role="dialog"
                  aria-label={t("stopConfirmTitle", undefined, "Stop this run?")}
                  className="flex max-w-[320px] flex-col gap-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]"
                >
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{t("stopConfirmTitle", undefined, "Stop this run?")}</p>
                  <p>
                    {liveRun.sessionConnected
                      ? t("stopConfirmConnected", undefined, "Its session is still connected. Stop kills it only if it is this run's own session in this folder, then marks the run stopped.")
                      : t("stopConfirmDisconnected", undefined, "Its session is not connected, so nothing can be killed. Stop marks the run stopped; the process may still be running.")}
                  </p>
                  <div className="flex justify-end gap-2">
                    <button type="button" data-testid={`stop-confirm-cancel-${a.name}`} onClick={() => setConfirmOpen(false)} className={cardButtonClass()}>
                      {t("cancel", undefined, "Cancel")}
                    </button>
                    <button type="button" data-testid={`stop-confirm-yes-${a.name}`} onClick={() => void doStop(liveRun)} className={cardButtonClass("danger")}>
                      {t("stopRun", undefined, "Stop run")}
                    </button>
                  </div>
                </div>
              </Popover>
            )}
          </div>
        </div>

        {a.valid ? (
          <div className="text-xs text-[var(--text-secondary)] flex flex-wrap gap-x-3 gap-y-0.5">
            <button
              type="button"
              data-testid={`automation-summary-${a.name}`}
              title={cron ?? undefined}
              onClick={(e) => {
                e.stopPropagation();
                onEdit("trigger");
              }}
              className="focus-ring rounded font-semibold text-[var(--text-primary)] hover:underline"
            >
              {cfg ? triggerSummary(cfg) : ""}
            </button>
            {next && (
              <span data-testid={`automation-next-${a.name}`}>
                {t("cardNext", undefined, "next")} {relativeFire(next, now)}
              </span>
            )}
            <span data-testid={`automation-action-${a.name}`}>{actionSummary(cfg)}</span>
            <span>{cfg?.model ?? "?"}</span>
            <span data-testid={`automation-mode-${a.name}`}>{t("cardMode", undefined, "mode:")} {cfg?.mode ?? "?"}</span>
          </div>
        ) : (
          <p className="text-xs text-[var(--severity-error-fg)]" data-testid={`automation-error-${a.name}`}>{a.error}</p>
        )}

        {orphaned && liveRun && (
          <div onClick={(e) => e.stopPropagation()}>
            <SettingsNotice tone="warning" testId={`automation-orphan-notice-${a.name}`}>
              <p>
                <b>{t("orphanTitle", undefined, "Lost track of this run.")}</b>{" "}
                {t("orphanBody", undefined, "The server restarted while it was running, so its completion was not recorded.")}{" "}
                {liveRun.sessionId
                  ? liveRun.sessionConnected
                    ? t("orphanConnected", undefined, "Its session is still connected.")
                    : t("orphanDisconnected", undefined, "Its session is not connected.")
                  : t("orphanNoSession", undefined, "It never registered a session.")}
              </p>
              {liveRun.sessionId && (
                <button type="button" data-testid={`orphan-session-${a.name}`} onClick={() => nav.session(liveRun)} className="mt-1 text-xs font-semibold text-[var(--accent-text)] underline">
                  {t("openSession", undefined, "Open session ↗")}
                </button>
              )}
            </SettingsNotice>
          </div>
        )}

        {notice && (
          <div onClick={(e) => e.stopPropagation()}>
            <SettingsNotice tone={notice.tone} testId={`automation-stop-notice-${a.name}`}>
              {notice.text}
            </SettingsNotice>
          </div>
        )}

        {lastRun && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-md bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-secondary)]"
            data-testid={`automation-last-run-${a.name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <RunPill run={lastRun} />
            <span title={lastRun.runId} className="text-[var(--text-primary)]">{runStartLabel(lastRun.startedAt, now)}</span>
            <span>{runSub(lastRun, now.getTime())}</span>
            <FindingsChip run={lastRun} testid={`last-run-findings-${a.name}`} />
            <span className="flex-1" />
            <RunLinks run={lastRun} nav={nav} sessionTestid={`last-run-session-${a.name}`} linkTestid={`last-run-link-${a.name}`} />
          </div>
        )}

        {runs.length > 0 && (
          <div onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              data-testid={`run-history-toggle-${a.name}`}
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((v) => !v)}
              className="focus-ring inline-flex items-center gap-1 min-h-[32px] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <span aria-hidden="true">{historyOpen ? "▾" : "▸"}</span>
              {t("runsCount", { count: visibleRuns.length }, `Runs (${visibleRuns.length})`)}
            </button>
            {historyOpen && (
              <div data-testid={`run-history-${a.name}`} className="rounded-lg border border-[var(--border-primary)]">
                {shownRuns.map((r) => (
                  <RunRow key={r.runId} run={r} now={now} nav={nav} />
                ))}
                {visibleRuns.length > HISTORY_PREVIEW && (
                  <button
                    type="button"
                    data-testid={`run-history-all-${a.name}`}
                    onClick={() => setHistoryAll((v) => !v)}
                    className="focus-ring w-full min-h-[32px] px-2 text-left text-xs text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
                  >
                    {historyAll
                      ? t("showLatest", undefined, "Show latest")
                      : t("showAllRuns", { count: visibleRuns.length }, `Show all (${visibleRuns.length})`)}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function RunPill({ run, testid }: { run: RunRecord; testid?: string }): React.ReactElement {
  const status = runPillStatus(run);
  const stripe = stripeFxClass(status);
  return (
    <span className={runPillClass(status)} data-testid={testid} data-status={status}>
      {stripe && <span className={stripe} aria-hidden="true" />}
      {status}
    </span>
  );
}

function FindingsChip({ run, testid }: { run: RunRecord; testid: string }): React.ReactElement | null {
  const n = run.findings ?? 0;
  if (run.archived || n <= 0) return null;
  return (
    <span data-testid={testid} className="rounded px-1.5 text-[11px] bg-[var(--bg-surface)] text-[var(--text-secondary)]">
      {n === 1 ? "1 finding" : `${n} findings`}
    </span>
  );
}

/** Duration, plus the error / stop reason for a run that did not complete. */
function runSub(r: RunRecord, now: number): string {
  const d = runDuration(r.startedAt, r.status === "running" ? undefined : (r.endedAt ?? r.startedAt), now);
  if ((r.status === "error" || r.status === "stopped") && r.error) return `${d}, ${r.error}`;
  return d;
}

/** Status-specific secondary link label (non-parent runs). */
function secondaryLink(r: RunRecord): "Monitor" | "Result" | "Log" {
  if (r.status === "running") return "Monitor";
  if (r.status === "error") return "Log";
  return "Result";
}

function RunLinks({
  run: r,
  nav,
  sessionTestid,
  linkTestid,
}: {
  run: RunRecord;
  nav: RunNav;
  sessionTestid: string;
  linkTestid: string;
}): React.ReactElement {
  const t = useT();
  const isParent = (r.childRuns?.length ?? 0) > 0 || (r.children?.length ?? 0) > 0;
  const link = secondaryLink(r);
  const linkLabel =
    link === "Monitor" ? t("monitor", undefined, "Monitor") : link === "Log" ? t("log", undefined, "Log") : t("result", undefined, "Result");
  const cls = "focus-ring rounded text-xs text-[var(--accent-text)] hover:underline";
  return (
    <span className="flex items-center gap-3">
      {r.sessionId && (
        <button type="button" data-testid={sessionTestid} onClick={() => nav.session(r)} className={cls}>
          {t("openSession", undefined, "Open session ↗")}
        </button>
      )}
      {!isParent && !(link === "Monitor" && !r.sessionId) && (
        <button
          type="button"
          data-testid={linkTestid}
          onClick={() => (link === "Monitor" ? nav.monitor(r) : nav.result(r))}
          className={cls}
        >
          {linkLabel}
        </button>
      )}
    </span>
  );
}

function RunRow({ run: r, now, nav }: { run: RunRecord; now: Date; nav: RunNav }): React.ReactElement {
  const t = useT();
  const kids = r.childRuns ?? [];
  const isParent = kids.length > 0;
  const [expanded, setExpanded] = useState(false);
  const row = "flex flex-wrap items-center gap-2 border-b border-[var(--border-primary)] px-2 py-1.5 text-xs last:border-b-0";
  return (
    <>
      <div data-testid={`automation-run-${r.runId}`} className={row}>
        {isParent && (
          <button
            type="button"
            data-testid={`run-expand-${r.runId}`}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={t("expandChildren", undefined, "Show child runs")}
            className="focus-ring min-h-[24px] px-1 text-[var(--text-secondary)]"
          >
            {expanded ? "▾" : "▸"}
          </button>
        )}
        <RunPill run={r} />
        <span title={r.runId} className="text-[var(--text-primary)]" data-testid={`run-label-${r.runId}`}>
          {runStartLabel(r.startedAt, now)}
        </span>
        {isParent && (
          <span className="text-[var(--text-secondary)]" data-testid={`run-child-count-${r.runId}`}>
            ({kids.length})
          </span>
        )}
        <span className="text-[var(--text-secondary)]">{runSub(r, now.getTime())}</span>
        <FindingsChip run={r} testid={`run-findings-${r.runId}`} />
        {r.warning && (
          <span className="text-[11px] text-[var(--severity-warning-fg)]" data-testid={`run-warning-${r.runId}`}>
            {r.warning}
          </span>
        )}
        {r.archived && (
          <span className="text-[11px] text-[var(--text-secondary)]" data-testid={`run-archived-${r.runId}`}>
            {t("archived", undefined, "archived")}
          </span>
        )}
        <span className="flex-1" />
        <RunLinks run={r} nav={nav} sessionTestid={`run-session-${r.runId}`} linkTestid={`run-result-${r.runId}`} />
      </div>
      {isParent &&
        expanded &&
        kids.map((c) => (
          <div key={c.runId} data-testid={`automation-child-run-${c.runId}`} className={`${row} pl-8 bg-[var(--bg-tertiary)]`}>
            <RunPill run={c} />
            <span className="text-[var(--text-primary)]" data-testid={`child-action-${c.runId}`} title={c.runId}>
              {c.actionLabel ?? c.runId}
            </span>
            <span className="text-[var(--text-secondary)]">{runSub(c, now.getTime())}</span>
            <FindingsChip run={c} testid={`child-findings-${c.runId}`} />
            <span className="flex-1" />
            <RunLinks run={c} nav={nav} sessionTestid={`child-session-${c.runId}`} linkTestid={`child-result-${c.runId}`} />
          </div>
        ))}
    </>
  );
}

/** Action summary: "flow <name>" for flows.run, "N actions" for a fan-out, else the kind. */
function actionSummary(cfg: AutomationConfig | undefined): string {
  if (!cfg) return "?";
  if (cfg.actions && cfg.actions.length > 0) return `${cfg.actions.length} actions`;
  const kind = cfg.action?.kind;
  if (kind === "flows.run") {
    const p = cfg.action?.payload as Record<string, unknown> | undefined;
    const flow = typeof p?.flow === "string" ? p.flow : typeof p?.flowName === "string" ? p.flowName : undefined;
    if (flow) return `flow ${flow}`;
  }
  return kind ?? "?";
}

/** Humanised schedule (raw cron as fallback); event triggers list their events. */
function triggerSummary(cfg: AutomationConfig): string {
  if (cfg.on.kind === "schedule") {
    const cron = typeof cfg.on.cron === "string" ? cfg.on.cron : "?";
    return humanizeCron(cron) ?? cron;
  }
  const events = (cfg.on.events as string[] | undefined) ?? [];
  return `${cfg.on.kind}: ${events.join(", ")}`;
}
