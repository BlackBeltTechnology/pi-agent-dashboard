/**
 * Automation board (shell-overlay-route `/folder/:encodedCwd/automations`).
 *
 * Per-automation definition cards reuse the dashboard's session-status visual
 * language (status rail + dot, headless source icon, status pill) via the
 * local `automation-card-visuals` replica; the running stripe sits on the rail
 * and running pill only. Selection uses the selected-chip recipe (accent
 * border, accent-soft header row, bold name, `aria-current`), not the session
 * card's neon. Each card owns:
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
 * Editing is inline: Edit / the name / the trigger summary expand that card
 * into `AutomationEditor`; + Create (and `?new=1` from the folder menu) opens a
 * draft card above the list. One editor at a time: every open / switch / close
 * goes through `requestEditor`, which raises the editor's unsaved-changes guard
 * when it is dirty. Leaving the board is not guarded.
 *
 * See change: add-automation-plugin, fix-automation-slot-parity-and-routing,
 * redesign-automation-editor-and-board, automation-ui-mockup-parity,
 * polish-automation-board, use-selector-style-for-automation-selection,
 * inline-automation-editor.
 */

import { SettingsNotice, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { encodeFolderPath } from "@blackbelt-technology/dashboard-plugin-runtime/sdk";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import type { AutomationConfig, AutomationScope, DiscoveredAutomation, RunRecord } from "../shared/automation-types.js";
import { nextFire } from "../shared/cron.js";
import {
  deleteAutomation,
  fetchAutomations,
  getAutomationDefinition,
  getRunResult,
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
  headlessSourceIcon,
  pillClass,
  pillLabel,
  type RunPillStatus,
  railBgClass,
  runPillClass,
  stripeFxClass,
} from "./automation-card-visuals.js";
import { AutomationEditor, type EditorSaveOutcome, type EditorSection } from "./AutomationEditor.js";
import { humanizeCron, relativeFire, runDuration, runStartLabel, sessionHref } from "./schedule-format.js";

export interface AutomationBoardProps {
  params?: Record<string, string>;
  /** Decoded folder path of the `/folder/:encodedCwd/automations` route (host-provided). */
  cwd?: string;
  onBack?: () => void;
}

/** Runs shown per card before "Show all". */
const HISTORY_PREVIEW = 3;

/** Editor key of the new-automation draft (cards use `scope:name`). */
const DRAFT_KEY = "new";

/** An in-board request to open an editor (`null` = close the open one). */
interface EditorRequest {
  key: string;
  section: EditorSection;
}

/** The single open editor. See change: inline-automation-editor (design D2). */
interface EditorState extends EditorRequest {
  status: "loading" | "ready" | "error";
  /** Loaded definition (cards only). */
  def?: { config: AutomationConfig; promptBody?: string };
  dirty: number;
  /** Bumped when the open editor is re-requested: re-focus `section`, nothing else. */
  focusSeq: number;
  /** The control that opened this editor; focus returns there on close. */
  opener: HTMLElement | null;
  /** Pending request held by the unsaved-changes guard (`null` = close). */
  guard?: { next: EditorRequest | null; opener: HTMLElement | null };
}

/** A run's visible status: the listing's `orphaned` flag wins over `running`. */
export function runPillStatus(r: RunRecord): RunPillStatus {
  return r.orphaned ? "orphaned" : r.status;
}

const scopeOf = (r: RunRecord): AutomationScope => (r.scope === "global" ? "global" : "folder");
const keyOf = (scope: AutomationScope, name: string) => `${scope}:${name}`;

/**
 * The run that carries the session for a top-level record. The engine wraps
 * every action in a parent occurrence whose `sessionId` lives on a child, so
 * the card's summary line + orphan notice resolve session/connectivity through
 * the running child (or the first child). A flat/legacy record is its own
 * bearer. See change: polish-automation-board.
 */
export function sessionBearer(run: RunRecord): RunRecord {
  const kids = run.childRuns;
  if (!kids || kids.length === 0) return run;
  return kids.find((c) => c.status === "running") ?? kids[0] ?? run;
}

export function AutomationBoard({ params, cwd, onBack }: AutomationBoardProps): React.ReactElement {
  const t = useT();
  const [location, setLocation] = useLocation();
  const Dialog = useUiPrimitive(UI_PRIMITIVE_KEYS.dialog);
  const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
  // The host decodes the folder segment; a route that carries one but yields no `cwd` is malformed.
  const invalidRoute = !!params?.encodedCwd && cwd === undefined;
  const repoCrumb = cwd ? cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || cwd : undefined;
  const [automations, setAutomations] = useState<DiscoveredAutomation[]>([]);
  // `loading` only on initial load / cwd change / Retry; mutation refreshes revalidate in place.
  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  // Last-request-wins for definition loads.
  const editorLoadSeq = useRef(0);
  // Focus to restore once the closing render lands: an element (opener) or a new card's Edit.
  const pendingFocus = useRef<{ el?: HTMLElement | null; editOf?: string } | null>(null);
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [openResult, setOpenResult] = useState<{ title: string; text: string } | null>(null);

  // A cwd change is an initial-load trigger: clear the stale list during render
  // (no frame of the old folder's cards) and block on `loading`.
  const [prevCwd, setPrevCwd] = useState(cwd);
  if (prevCwd !== cwd) {
    setPrevCwd(cwd);
    setAutomations([]);
    setRuns([]);
    setLoadState("loading");
    setEditor(null);
  }

  useEffect(() => {
    if (invalidRoute) return;
    let cancelled = false; // last-request-wins: a stale cwd/Retry/refresh result is ignored
    async function load() {
      const res = await fetchAutomations(cwd).catch(() => ({ ok: false as const, error: "request failed" }));
      if (cancelled) return;
      if (!res.ok) {
        setAutomations([]);
        setRuns([]);
        setLoadState("error");
        return;
      }
      setAutomations(res.automations);
      setLoadState("ready");
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
  const retry = () => {
    setLoadState("loading");
    refresh();
  };

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

  /** Load a card's definition into the open editor (ignored once superseded). */
  async function loadDefinition(key: string): Promise<void> {
    const seq = ++editorLoadSeq.current;
    const a = automations.find((x) => keyOf(x.scope, x.name) === key);
    const def = a
      ? await getAutomationDefinition(a.scope, a.scope === "folder" ? cwd : undefined, a.name).catch(() => null)
      : null;
    if (seq !== editorLoadSeq.current) return;
    setEditor((cur) => {
      if (!cur || cur.key !== key) return cur;
      return def ? { ...cur, status: "ready", def } : { ...cur, status: "error" };
    });
  }

  /** Open / switch / close without asking (clean editor, Discard, or after a save). */
  function applyEditor(next: EditorRequest | null, opener: HTMLElement | null): void {
    const cur = editorRef.current;
    editorLoadSeq.current++;
    if (!next) {
      pendingFocus.current = { el: cur?.opener ?? null };
      setEditor(null);
      return;
    }
    const isDraft = next.key === DRAFT_KEY;
    // The editing card is the selected card (design D3).
    if (!isDraft) setSelected(next.key);
    setEditor({ ...next, status: isDraft ? "ready" : "loading", dirty: 0, focusSeq: 0, opener });
    if (!isDraft) void loadDefinition(next.key);
  }

  /** Every in-board open / switch / close goes through here (design D2). */
  function requestEditor(next: EditorRequest | null, opener?: HTMLElement | null): void {
    const cur = editorRef.current;
    const from = opener !== undefined ? opener : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (cur && next && next.key === cur.key) {
      // Already open: only move focus to the requested section.
      setEditor({ ...cur, section: next.section, focusSeq: cur.focusSeq + 1 });
      return;
    }
    if (!cur && !next) return;
    if (cur && cur.status === "ready" && cur.dirty > 0) {
      setEditor({ ...cur, guard: { next, opener: from } });
      return;
    }
    applyEditor(next, from);
  }

  function onEditorSaved(outcome: EditorSaveOutcome, savedName: string): void {
    const cur = editorRef.current;
    if (outcome === "switch" && cur?.guard) {
      applyEditor(cur.guard.next, cur.guard.opener);
    } else {
      applyEditor(null, null);
      // A created automation: focus its card's Edit once the refresh lists it.
      if (cur?.key === DRAFT_KEY) pendingFocus.current = { editOf: savedName };
    }
    refresh();
  }

  // Restore focus after the editor closed (opener, a created card's Edit, or + Create).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `automations` is the trigger — a created card's Edit exists only after the refresh lists it
  useEffect(() => {
    const p = pendingFocus.current;
    if (!p || editor) return;
    if (p.editOf) {
      const testId = `edit-${p.editOf}`;
      const btn = [...document.querySelectorAll<HTMLElement>('[data-testid^="edit-"]')].find((el) => el.dataset.testid === testId);
      if (!btn) return; // wait for the refresh to list it
      pendingFocus.current = null;
      btn.focus();
      return;
    }
    pendingFocus.current = null;
    (p.el?.isConnected ? p.el : createBtnRef.current)?.focus();
  }, [editor, automations]);

  // Close a card editor whose card is gone (deleted, no longer listed, or a failed refresh cleared the list).
  useEffect(() => {
    if (!editor || editor.key === DRAFT_KEY || loadState === "loading") return;
    if (loadState === "error" || !automations.some((a) => keyOf(a.scope, a.name) === editor.key)) {
      editorLoadSeq.current++;
      setEditor(null);
    }
  }, [editor, automations, loadState]);

  // `?new=1` (folder menu "New automation"): open the draft once the list is
  // ready, and strip the param in the same tick (replace) so history never
  // reopens it. Waits while loading; stripped on error. See design D5.
  const search = useSearch();
  const wantsDraft = new URLSearchParams(search).get("new") === "1";
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on the param / load-state transition only; `requestEditor` and `location` are read at that moment
  useEffect(() => {
    if (!wantsDraft || invalidRoute || loadState === "loading") return;
    if (loadState === "ready") requestEditor({ key: DRAFT_KEY, section: "identity" }, createBtnRef.current);
    setLocation(location, { replace: true });
  }, [wantsDraft, invalidRoute, loadState]);

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

  /** Props every open editor shares (create draft and card). */
  function editorProps(key: string) {
    return {
      cwd,
      ...(editor ? { initialSection: editor.section, focusSeq: editor.focusSeq } : {}),
      guard: editor?.guard ? { count: editor.dirty, closing: editor.guard.next === null } : null,
      onClose: () => requestEditor(null),
      onSaved: onEditorSaved,
      onDiscard: () => {
        const g = editorRef.current?.guard;
        if (g) applyEditor(g.next, g.opener);
      },
      onDirtyChange: (n: number) =>
        setEditor((cur) => (cur && cur.key === key && cur.dirty !== n ? { ...cur, dirty: n } : cur)),
    };
  }

  /** A card's editor area: loading line, fetch error (Retry / Close) or the editor. */
  function cardEditor(a: DiscoveredAutomation): React.ReactNode {
    if (!editor) return null;
    if (editor.status === "loading") {
      return (
        <p role="status" data-testid={`card-editor-loading-${a.name}`} className="text-xs text-[var(--text-secondary)]">
          {t("editorLoadingDefinition", undefined, "Loading the automation…")}
        </p>
      );
    }
    if (editor.status === "error" || !editor.def) {
      return (
        <div role="alert" data-testid={`card-editor-error-${a.name}`} className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-[var(--severity-error-fg)]">{t("editorLoadFailed", undefined, "Could not load this automation.")}</p>
          <button
            type="button"
            data-testid={`card-editor-retry-${a.name}`}
            onClick={() => {
              setEditor((cur) => (cur && cur.key === editor.key ? { ...cur, status: "loading" } : cur));
              void loadDefinition(editor.key);
            }}
            className={cardButtonClass("primary")}
          >
            {t("retry", undefined, "Retry")}
          </button>
          <button type="button" data-testid={`card-editor-close-${a.name}`} onClick={() => requestEditor(null)} className={cardButtonClass()}>
            {t("close", undefined, "Close")}
          </button>
        </div>
      );
    }
    return (
      <AutomationEditor
        key={`${cwd ?? ""}:${editor.key}`}
        {...editorProps(editor.key)}
        initialName={a.name}
        initialScope={a.scope}
        initialConfig={editor.def.config}
        {...(editor.def.promptBody !== undefined ? { initialPromptBody: editor.def.promptBody } : {})}
      />
    );
  }

  const draftOpen = editor?.key === DRAFT_KEY;
  const emptyReady = loadState === "ready" && automations.length === 0;
  const draftCard = draftOpen ? (
    <div
      data-testid="automation-draft"
      className="rounded-xl border border-dashed border-[var(--accent)] bg-[var(--bg-secondary)] px-3 pt-3"
    >
      <h3 className="mb-2 text-[13px] font-semibold text-[var(--text-primary)]">{t("newAutomation", undefined, "New automation")}</h3>
      <AutomationEditor key={`${cwd ?? ""}:${DRAFT_KEY}`} {...editorProps(DRAFT_KEY)} />
    </div>
  ) : null;

  if (invalidRoute) {
    return (
      <div data-testid="automation-board" className="flex flex-col flex-1 min-h-0 overflow-y-auto gap-3 p-3 text-sm">
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
    <div data-testid="automation-board" className="flex flex-col flex-1 min-h-0 overflow-y-auto text-sm">
      <div className="sticky top-0 z-10 shrink-0 px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          {onBack && (
            <button type="button" data-testid="automation-board-back" onClick={onBack} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              {t("back", undefined, "← Back")}
            </button>
          )}
          <h2 className="truncate text-base font-semibold">{t("automations", undefined, "Automations")}</h2>
          {repoCrumb && (
            <span className="min-w-0 truncate text-xs text-[var(--text-secondary)]" data-testid="automation-repo-crumb">
              {repoCrumb}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" ref={createBtnRef} data-testid="automation-create-btn" onClick={(e) => requestEditor({ key: DRAFT_KEY, section: "identity" }, e.currentTarget)} className={cardButtonClass("primary")}>
            {t("createAutomation", undefined, "+ Create Automation")}
          </button>
          <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} data-testid="automation-show-all" />
            {t("showArchived", undefined, "Show archived")}
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-3">
        {/* The draft renders above the list, outside its loading/error swap;
            on an empty folder it sits below the explainer instead. */}
        {draftOpen && !emptyReady && draftCard}

        <section data-testid="automation-list">
          <h3 className="text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-1">{t("definitions", undefined, "Definitions")}</h3>
          {loadState === "loading" ? (
            <p data-testid="automation-loading" role="status" aria-busy="true" className="text-xs text-[var(--text-secondary)]">
              {t("loading", undefined, "Loading automations…")}
            </p>
          ) : loadState === "error" ? (
            <div data-testid="automation-error" role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-4">
              <p className="text-sm font-semibold text-[var(--severity-error-fg)]">{t("loadFailed", undefined, "Could not load automations.")}</p>
              <button type="button" data-testid="automation-retry" onClick={retry} className={cardButtonClass("primary")}>
                {t("retry", undefined, "Retry")}
              </button>
            </div>
          ) : automations.length === 0 ? (
            loadState === "ready" && (
              <>
              <div data-testid="automation-empty" className="flex flex-col items-start gap-2 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-4">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{t("noAutomations", undefined, "No automations in this folder.")}</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {t(
                    "emptyExplainer",
                    undefined,
                    "An automation runs a prompt, skill or flow in its own session on a schedule. Each run keeps its result here, one click from its session.",
                  )}
                </p>
                <button type="button" data-testid="automation-empty-create" onClick={(e) => requestEditor({ key: DRAFT_KEY, section: "identity" }, e.currentTarget)} className={cardButtonClass("primary")}>
                  {t("createAutomation", undefined, "+ Create Automation")}
                </button>
              </div>
              {draftOpen && draftCard}
              </>
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
                    onEdit={(section, opener) => requestEditor({ key, section }, opener)}
                    onCloseEditor={(opener) => requestEditor(null, opener)}
                    editing={editor?.key === key}
                    editorContent={editor?.key === key ? cardEditor(a) : null}
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
  onCloseEditor,
  editing,
  editorContent,
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
  onEdit: (section: EditorSection, opener: HTMLElement) => void;
  onCloseEditor: (opener: HTMLElement) => void;
  /** This card's inline editor is open (design D3). */
  editing: boolean;
  /** The editor area rendered below the summary while `editing`. */
  editorContent: React.ReactNode;
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
      aria-current={selected ? "true" : undefined}
      className={`relative isolate flex overflow-clip rounded-xl border bg-[var(--bg-secondary)] ${
        selected ? "border-[var(--accent)]" : "border-[var(--border-secondary)]"
      }`}
    >
      <div className={`relative isolate w-1 self-stretch overflow-hidden ${railBgClass(state)}`} data-testid={`automation-rail-${a.name}`} aria-hidden="true">
        {stripeFx && <div className={stripeFx} data-testid={`automation-rail-stripe-${a.name}`} />}
      </div>

      <div className="flex-1 min-w-0 p-3 flex flex-col gap-1.5">
        {/* Header row stays the column's first child: when selected it bleeds
            out of the column padding so the accent-soft band spans rail → right
            edge. The body (with --accent-text links) keeps --bg-secondary.
            The -mx-3/-mt-3/px-3/pt-3 bleed mirrors the column's p-3; change both together. */}
        <div
          data-testid={`automation-header-${a.name}`}
          className={`flex flex-wrap items-center gap-2 ${selected ? "-mx-3 -mt-3 px-3 pt-3 pb-1.5 bg-[var(--accent-soft)]" : ""}`}
        >
          <Icon path={headlessSourceIcon} size={0.5} className="text-[var(--text-secondary)]" data-testid={`automation-source-icon-${a.name}`} />
          <span className={`inline-block w-2 h-2 rounded-full ${dotClass(state)}`} data-testid={`automation-dot-${a.name}`} />
          <button
            type="button"
            data-testid={`automation-name-${a.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onEdit("trigger", e.currentTarget);
            }}
            className={`focus-ring max-w-full truncate rounded font-mono text-[13px] ${selected ? "font-bold" : "font-semibold"} text-[var(--text-primary)] hover:underline`}
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
              // Hidden while editing: avoids a Disable-then-Save race on the same config (design D3).
              !editing && <>
                <button type="button" data-testid={`run-now-${a.name}`} onClick={onRunNow} className={cardButtonClass()}>
                  {t("runNow", undefined, "▶ Run now")}
                </button>
                <button type="button" data-testid={`toggle-${a.name}`} onClick={onToggle} className={cardButtonClass()}>
                  {disabled ? t("enable", undefined, "Enable") : t("disable", undefined, "Disable")}
                </button>
              </>
            ))}
            <button
              type="button"
              data-testid={`edit-${a.name}`}
              aria-expanded={editing}
              onClick={(e) => (editing ? onCloseEditor(e.currentTarget) : onEdit("trigger", e.currentTarget))}
              className={cardButtonClass()}
            >
              {editing ? t("closeEditor", undefined, "Close editor") : t("edit", undefined, "Edit")}
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
              // header fill to the rounded corners) does not clip the menu.
              // See change: fix-automation-overflow-menu-clip.
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
                    {sessionBearer(liveRun).sessionConnected
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
                onEdit("trigger", e.currentTarget);
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

        {orphaned && liveRun && (() => {
          const bearer = sessionBearer(liveRun);
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <SettingsNotice tone="warning" testId={`automation-orphan-notice-${a.name}`}>
                <p>
                  <b>{t("orphanTitle", undefined, "Lost track of this run.")}</b>{" "}
                  {t("orphanBody", undefined, "The server restarted while it was running, so its completion was not recorded.")}{" "}
                  {bearer.sessionId
                    ? bearer.sessionConnected
                      ? t("orphanConnected", undefined, "Its session is still connected.")
                      : t("orphanDisconnected", undefined, "Its session is not connected.")
                    : t("orphanNoSession", undefined, "It never registered a session.")}
                </p>
                {bearer.sessionId && (
                  <button type="button" data-testid={`orphan-session-${a.name}`} onClick={() => nav.session(bearer)} className="mt-1 text-xs font-semibold text-[var(--accent-text)] underline">
                    {t("openSession", undefined, "Open session ↗")}
                  </button>
                )}
              </SettingsNotice>
            </div>
          );
        })()}

        {notice && (
          <div onClick={(e) => e.stopPropagation()}>
            <SettingsNotice tone={notice.tone} testId={`automation-stop-notice-${a.name}`}>
              {notice.text}
            </SettingsNotice>
          </div>
        )}

        {editing && (
          // Clicks inside the editor never re-select the card (design D3).
          <div className="min-w-0" onClick={(e) => e.stopPropagation()}>
            {editorContent}
          </div>
        )}

        {!editing && lastRun && (
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
            <RunLinks run={lastRun} sessionRun={sessionBearer(lastRun)} nav={nav} sessionTestid={`last-run-session-${a.name}`} linkTestid={`last-run-link-${a.name}`} />
          </div>
        )}

        {!editing && runs.length > 0 && (
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
  sessionRun,
  nav,
  sessionTestid,
  linkTestid,
}: {
  run: RunRecord;
  /** The run that carries the session link (defaults to `run`; a parent passes its bearer child). */
  sessionRun?: RunRecord;
  nav: RunNav;
  sessionTestid: string;
  linkTestid: string;
}): React.ReactElement {
  const t = useT();
  const sr = sessionRun ?? r;
  const isParent = (r.childRuns?.length ?? 0) > 0 || (r.children?.length ?? 0) > 0;
  const link = secondaryLink(r);
  const linkLabel =
    link === "Monitor" ? t("monitor", undefined, "Monitor") : link === "Log" ? t("log", undefined, "Log") : t("result", undefined, "Result");
  const cls = "focus-ring rounded text-xs text-[var(--accent-text)] hover:underline";
  return (
    <span className="flex items-center gap-3">
      {sr.sessionId && (
        <button type="button" data-testid={sessionTestid} onClick={() => nav.session(sr)} className={cls}>
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
