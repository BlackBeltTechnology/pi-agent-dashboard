/**
 * Directory home page for ANY groupable folder, reached via the bare
 * `/folder/:encodedCwd` route. A *pre-session pane* inside the same
 * Chat | Split | Editor workspace sessions use:
 *
 *   left  — new-session pane: skill/prompt starter cards + the composer docked
 *           at the bottom (the chat pane's own column geometry, so the
 *           composer's existing height budget resolves against the pane — #877);
 *   right — the folder editor/terminals pane (`EditorPane`).
 *
 * On send it spawns a session in `cwd` with the typed text as `initialPrompt`
 * plus the chosen model / thinking level (and, for a git folder, optionally in
 * a NEW worktree). App's Tier-1 spawn correlation (`pendingSpawnsRef`) owns
 * navigation to the new session — this page never navigates; it only
 * re-enables Start when its own spawn fails.
 *
 * Layout: when rendered under a folder-scoped `SplitWorkspaceProvider`
 * (`FolderSplitProvider`) it hosts the split; with no folder provider (mobile,
 * isolated tests) it renders the pane alone, with no layout switch.
 *
 * The former pinned-OR-workspace eligibility guard is GONE: every cwd the
 * sidebar can group navigates here. See changes: add-directory-home-page,
 * redesign-folder-workspace-add-flow, redesign-directory-home-split.
 */
import type { CommandInfo, ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiCog, mdiFolderOpen } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FolderCommandOrigin } from "../../lib/api/folder-commands-api.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { isFolderPaneId } from "../../lib/layout/folder-pane-id.js";
import { PopoverBoundaryProvider } from "../../lib/state/PopoverBoundaryContext.js";
import { AgentSelect } from "../AgentSelect.js";
import { CommandInput } from "../chat/CommandInput.js";
import { EditorPane } from "../editor-pane/EditorPane.js";
import { LayoutModeSwitch } from "../split/LayoutModeSwitch.js";
import { SplitWorkspace } from "../split/SplitWorkspace.js";
import { useOptionalSplitWorkspace } from "../split/SplitWorkspaceContext.js";
import { WorktreeSpawnDialog } from "../worktree/WorktreeSpawnDialog.js";
import { buildStarters, type Starter, withStarterInserted } from "./starter-cards.js";

export interface SpawnFromHomeOpts {
  gitWorktreeBase?: string;
  placeholderCwd?: string;
  initialPrompt?: string;
  model?: string;
  thinkingLevel?: string;
  /** Configured ACP agent for the first prompt; absent → pi. See change: add-acp-session-driver (D16). */
  agent?: string;
}

export interface DirectoryHomeViewProps {
  /** Decoded cwd for this folder route. */
  cwd: string;
  /** Folder command list (scope-tagged); drives starter cards and the `/` popover. */
  commands?: CommandInfo[];
  /** Origin of `commands`; `scan` marks the `/` popover "from disk". */
  commandsOrigin?: FolderCommandOrigin;
  /** Global model catalogue for the model chip. */
  models?: ModelInfo[];
  /** Settings default model (`provider/id`), pre-selected and tagged `default`. */
  defaultModel?: string;
  /** Settings default thinking level, pre-selected and tagged `default`. */
  defaultThinkingLevel?: string;
  favorites?: string[];
  onToggleFavorite?: (label: string, makeFavorite: boolean) => void;
  onOpenProviderSettings?: () => void;
  /** `folderGitMap`: a string value = git repo, `null` = not git, absent = unknown. */
  folderGitMap?: Map<string, string | null>;
  /** Existing sessions in this folder; `0` focuses the prompt. Never rendered as a list. */
  sessionCount?: number;
  /**
   * `handleSpawnSession`. Called as `(cwd, undefined, opts)` — the 2nd arg is
   * `attachProposal`, NOT an options object. Returns the minted `requestId`.
   */
  onSpawnSession: (cwd: string, attachProposal?: string, opts?: SpawnFromHomeOpts) => string | undefined | void;
  /** The most recent spawn that failed after acceptance (`seq` re-fires an identical id). */
  failedSpawn?: { requestId: string; seq: number } | null;
  /** Worktree dialog placeholder hooks (same wiring the sidebar uses). */
  onWorktreeSpawnStart?: (parentCwd: string) => void;
  onWorktreeSpawnAbort?: (parentCwd: string) => void;
  /** Called with the new worktree path after its spawn is issued (auto-init hook). */
  onWorktreeSpawned?: (path: string) => void;
  /** Open the folder settings surface (header gear). */
  onOpenSettings?: (cwd: string) => void;
}

function folderName(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

type RunLocation = "folder" | "worktree";

export function DirectoryHomeView({
  cwd,
  commands = [],
  commandsOrigin,
  models,
  defaultModel,
  defaultThinkingLevel,
  favorites,
  onToggleFavorite,
  onOpenProviderSettings,
  folderGitMap,
  sessionCount,
  onSpawnSession,
  failedSpawn,
  onWorktreeSpawnStart,
  onWorktreeSpawnAbort,
  onWorktreeSpawned,
  onOpenSettings,
}: DirectoryHomeViewProps) {
  const { t } = useI18n();
  const split = useOptionalSplitWorkspace();
  const inFolderSplit = !!split && isFolderPaneId(split.sessionId);

  /**
   * The pre-session pane — the clipping boundary for the composer's popovers
   * (the `/` list, model / thinking selectors), which would otherwise measure
   * against the viewport. See change: fix-popover-pane-bounded-height.
   */
  const paneRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [modelPick, setModelPick] = useState<string | undefined>(undefined);
  const [thinkingPick, setThinkingPick] = useState<string | undefined>(undefined);
  const [runLocation, setRunLocation] = useState<RunLocation>("folder");
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  // Agent for the first prompt (ACP agents configured); undefined = pi.
  // See change: add-acp-session-driver (D16).
  const [agent, setAgent] = useState<string | undefined>(undefined);

  // A spawn from this page is in flight until App correlates `session_added`
  // (the page then unmounts as App navigates) or it fails. The ref makes a
  // double Enter / click in the same tick a single spawn.
  const [spawnInFlight, setSpawnInFlight] = useState(false);
  const inFlightRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const sentDraftRef = useRef("");

  const beginSpawn = useCallback(() => {
    inFlightRef.current = true;
    setSpawnInFlight(true);
  }, []);
  const endSpawn = useCallback(() => {
    inFlightRef.current = false;
    requestIdRef.current = null;
    setSpawnInFlight(false);
  }, []);

  // Re-enable Start, keeping the typed text, when THIS page's spawn fails.
  // A failure for another request id is ignored.
  useEffect(() => {
    if (!failedSpawn || !requestIdRef.current || failedSpawn.requestId !== requestIdRef.current) return;
    setDraft((cur) => (cur === "" ? sentDraftRef.current : cur));
    endSpawn();
  }, [failedSpawn, endSpawn]);

  const effectiveModel = modelPick ?? (defaultModel || undefined);
  const effectiveThinking = thinkingPick ?? (defaultThinkingLevel || undefined);
  const isGit = typeof folderGitMap?.get(cwd) === "string";

  const dispatchSpawn = useCallback(
    (spawnCwd: string, text: string, extra: SpawnFromHomeOpts = {}) => {
      sentDraftRef.current = text;
      // 3-positional: (cwd, attachProposal=undefined, opts). Passing the options
      // object as the 2nd arg would serialize `[object Object]` as the proposal.
      const id = onSpawnSession(spawnCwd, undefined, {
        ...(text ? { initialPrompt: text } : {}),
        ...(effectiveModel ? { model: effectiveModel } : {}),
        ...(effectiveThinking ? { thinkingLevel: effectiveThinking } : {}),
        ...(agent ? { agent } : {}),
        ...extra,
      });
      requestIdRef.current = typeof id === "string" ? id : null;
    },
    [onSpawnSession, effectiveModel, effectiveThinking, agent],
  );

  const onSend = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || inFlightRef.current) return;
    beginSpawn();
    dispatchSpawn(cwd, trimmed);
  };

  const starters = useMemo(() => buildStarters(commands), [commands]);

  const insertStarter = useCallback((starter: Starter) => {
    const next = withStarterInserted(draftRef.current, starter.invocation);
    setDraft(next);
    // Caret at the end + focus, after the controlled value has been applied.
    requestAnimationFrame(() => {
      const ta = paneRef.current?.querySelector("textarea");
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(next.length, next.length);
    });
  }, []);

  // An empty folder has nothing else to look at — focus the prompt.
  useEffect(() => {
    if (sessionCount === 0) paneRef.current?.querySelector("textarea")?.focus();
  }, [sessionCount]);

  const name = folderName(cwd);

  const runLocationChip = isGit ? (
    <select
      data-testid="run-location"
      aria-label={t("directoryHome.runLocation", undefined, "Run location")}
      value={runLocation}
      disabled={spawnInFlight}
      onChange={(e) => {
        if (e.target.value === "worktree") {
          setRunLocation("worktree");
          setWorktreeOpen(true);
        } else {
          setRunLocation("folder");
        }
      }}
      className="focus-ring h-[30px] rounded-lg bg-transparent px-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
    >
      <option value="folder">{t("directoryHome.thisFolder", undefined, "This folder")}</option>
      <option value="worktree">{t("directoryHome.newWorktree", undefined, "New worktree…")}</option>
    </select>
  ) : null;

  const pane = (
    <PopoverBoundaryProvider value={paneRef}>
      {/* Same column geometry as the chat pane: scrolling content, then the
          composer as the LAST child, so its `max-h-[40%]` budget resolves
          against this pane and the card renders at natural height (#877). */}
      <div
        ref={paneRef}
        data-testid="directory-home-prompt"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <div data-testid="directory-home-starters" className="min-h-0 flex-1 overflow-auto p-6">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h1 className="text-lg font-semibold text-[var(--text-primary)]">
                {t("directoryHome.newSessionIn", { name }, `New session in ${name}`)}
              </h1>
              <p className="truncate text-xs text-[var(--text-tertiary)]">{cwd}</p>
            </div>
            {starters.length > 0 && (
              <section aria-label={t("directoryHome.startersLabel", undefined, "Skills and prompts in this folder")}>
                <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">
                  {t("directoryHome.startersLabel", undefined, "Skills and prompts in this folder")}
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {starters.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      data-testid={`starter-card-${s.id}`}
                      onClick={() => insertStarter(s)}
                      className="focus-ring flex min-w-0 flex-col gap-0.5 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-2 text-left hover:bg-[var(--bg-hover)]"
                    >
                      <span className="truncate font-mono text-xs text-[var(--text-primary)]">/{s.invocationName}</span>
                      {s.description && (
                        <span className="line-clamp-2 text-xs text-[var(--text-tertiary)]">{s.description}</span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        <AgentSelect cwd={cwd} onChange={setAgent} className="mx-3 mb-1 flex items-center gap-2 text-xs" />
        <CommandInput
          commands={commands}
          commandsOrigin={commandsOrigin}
          onSend={onSend}
          disabled={spawnInFlight}
          draft={draft}
          onDraftChange={setDraft}
          currentCwd={cwd}
          sendLabel={t("directoryHome.start", undefined, "Start session")}
          models={models}
          model={effectiveModel}
          modelTag={effectiveModel && effectiveModel === defaultModel ? t("directoryHome.defaultTag", undefined, "default") : undefined}
          unsetLabel={t("directoryHome.piDefault", undefined, "pi default")}
          onSelectModel={setModelPick}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          onOpenProviderSettings={onOpenProviderSettings}
          thinkingLevel={effectiveThinking}
          thinkingTag={
            effectiveThinking && effectiveThinking === defaultThinkingLevel
              ? t("directoryHome.defaultTag", undefined, "default")
              : undefined
          }
          onSelectThinkingLevel={setThinkingPick}
          toolbarExtra={runLocationChip}
        />
      </div>
    </PopoverBoundaryProvider>
  );

  return (
    <div data-testid="directory-home" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <Icon path={mdiFolderOpen} size={0.8} className="shrink-0 text-[var(--accent-text)]" />
        <span data-testid="directory-home-header" className="truncate text-sm font-semibold text-[var(--text-primary)]">
          {name}
        </span>
        <span className="hidden min-w-0 truncate font-mono text-xs text-[var(--text-tertiary)] sm:inline">{cwd}</span>
        <span className="flex-1" />
        {inFolderSplit && <LayoutModeSwitch />}
        <button
          type="button"
          data-testid="directory-home-settings"
          onClick={() => onOpenSettings?.(cwd)}
          title={t("directoryHome.folderSettings", undefined, "Folder settings")}
          aria-label={t("directoryHome.folderSettings", undefined, "Folder settings")}
          className="focus-ring inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          <Icon path={mdiCog} size={0.75} />
        </button>
      </header>

      {inFolderSplit && split ? (
        <SplitWorkspace
          mode={split.split.mode}
          ratio={split.split.ratio}
          orientation={split.split.orientation}
          onRatioChange={(ratio) => split.updateSplit({ ratio })}
          onModeChange={(mode) => split.updateSplit({ mode })}
          chat={pane}
          editor={<EditorPane />}
        />
      ) : (
        pane
      )}

      {worktreeOpen && (
        <WorktreeSpawnDialog
          cwd={cwd}
          onCancel={() => {
            setWorktreeOpen(false);
            setRunLocation("folder");
          }}
          onSpawnStart={(c) => {
            beginSpawn();
            onWorktreeSpawnStart?.(c);
          }}
          onSpawnAbort={(c) => {
            endSpawn();
            onWorktreeSpawnAbort?.(c);
          }}
          onSpawn={(path, opts) => {
            setWorktreeOpen(false);
            setRunLocation("folder");
            const text = draftRef.current.trim();
            dispatchSpawn(path, text, {
              placeholderCwd: cwd,
              ...(opts?.gitWorktreeBase ? { gitWorktreeBase: opts.gitWorktreeBase } : {}),
            });
            setDraft("");
            onWorktreeSpawned?.(path);
          }}
        />
      )}
    </div>
  );
}
