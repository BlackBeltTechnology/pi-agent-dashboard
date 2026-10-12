import { mdiAlert, mdiCheck, mdiFolderOutline, mdiLock } from "@mdi/js";
import Icon from "@mdi/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useAcpAgents } from "../../hooks/useAcpAgents.js";
import { useAnthropicPeerProbe } from "../../hooks/useAnthropicPeerProbe.js";
import { useRecommendedExtensions } from "../../hooks/useRecommendedExtensions.js";
import { getRememberedAgent } from "../../lib/acp/agent-memory.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { ANTHROPIC_PEER_ENTRY_ID } from "../../lib/package/anthropic-peer.js";
import { peerAutoInstallStore, usePeerAutoInstall } from "../../lib/package/peer-auto-install-store.js";
import { InlineMessage } from "../primitives/InlineMessage.js";
import { PeerAutoInstallStatus, SECONDARY_BUTTON_CLASS } from "../settings/PeerAutoInstallStatus.js";

/** Result of the app-level create-project call (see `lib/create-project.ts`). */
type LandingCreateProjectResult =
  | { ok: true; path: string; existed: boolean }
  | { ok: false; reason?: string };

export interface LandingPageProps {
  /** True when at least one LLM provider has a non-empty apiKey. */
  providersReady?: boolean;
  /**
   * Whether the `anthropic` subscription is authenticated: `null` when the
   * status read failed. Landing requests peer state only while `true`.
   */
  anthropicAuthenticated?: boolean | null;
  /** Number of pinned directories. */
  pinnedCount?: number;
  /** Number of active sessions. */
  sessionsCount?: number;
  /** First pinned cwd (null when none). Used as the target for step 3. */
  firstPinnedCwd?: string | null;
  /** Opens the app-level PinDirectoryDialog. */
  onOpenPinDialog?: () => void;
  /** Creates `<home>/Projects/<name>` on the server and pins it. Never rejects. */
  onCreateProject?: (name: string) => Promise<LandingCreateProjectResult>;
  /** Spawns a session in the given cwd. */
  onSpawnSession?: (cwd: string, attachProposal?: string, opts?: { agent?: string }) => void;
  /** Router navigation function (e.g. wouter's navigate). */
  navigate?: (to: string) => void;
}

type StepState = "pending" | "done" | "locked";

const DEFAULT_PROJECT_NAME = "my-first-project";

/** ui-contract primary-button recipe — the single call-to-action of the first pending step. */
const PRIMARY_BUTTON =
  "focus-ring rounded-md bg-[var(--accent-solid)] px-3 min-h-[44px] sm:min-h-[36px] text-white font-semibold text-sm disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]";
const LINK_BUTTON =
  "focus-ring rounded-md px-1 min-h-[44px] sm:min-h-[32px] text-[12px] text-[var(--text-secondary)] underline hover:text-[var(--text-primary)] disabled:opacity-60 disabled:no-underline";

const KNOWN_REASONS = new Set([
  "invalid_name",
  "reserved_name",
  "too_long",
  "not_a_directory",
  "root_not_a_directory",
  "outside_root",
  "home_missing",
  "fs_error",
]);

function Marker({ state, number }: { state: StepState; number: number }) {
  const { t } = useI18n();
  const base = "shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-semibold";
  if (state === "done") {
    return (
      <span
        className={`${base} bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)] border border-[var(--severity-success-border)]`}
      >
        <Icon path={mdiCheck} size={0.6} aria-hidden="true" />
        <span className="sr-only">{t("landing.stateDone", undefined, "Done")}</span>
      </span>
    );
  }
  if (state === "locked") {
    return (
      <span className={`${base} bg-[var(--bg-tertiary)] text-[var(--text-secondary)]`}>
        <Icon path={mdiLock} size={0.55} aria-hidden="true" />
        <span className="sr-only">{t("landing.stateLocked", undefined, "Locked")}</span>
      </span>
    );
  }
  return (
    <span className={`${base} border border-[var(--accent-primary)] text-[var(--text-primary)]`}>
      <span aria-hidden="true">{number}</span>
      <span className="sr-only">{t("landing.step", { step: number }, `Step ${number}`)}</span>
    </span>
  );
}

/** One row of the ordered list. Expanded only for the first pending step. */
function StepRow({
  n,
  state,
  title,
  expanded,
  testId,
  children,
  below,
}: {
  n: number;
  state: StepState;
  title: string;
  expanded: boolean;
  testId: string;
  /** Body of an expanded step, or the one-line label of a collapsed one. */
  children: React.ReactNode;
  /** Extra content beneath a done row's line (peer status / existed note). */
  below?: React.ReactNode;
}) {
  return (
    <li
      data-testid={`onboarding-step-${n}`}
      data-state={state}
      data-expanded={expanded ? "true" : "false"}
      className="flex gap-3 px-4 py-3 border-t first:border-t-0 border-[var(--border-secondary)]"
    >
      <Marker state={state} number={n} />
      <div className="flex-1 min-w-0">
        {expanded ? (
          <>
            <div className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</div>
            <div className="mt-1 flex flex-col gap-2">{children}</div>
          </>
        ) : (
          <div data-testid={testId} className="text-[13px] text-[var(--text-secondary)] pt-0.5">
            {children}
          </div>
        )}
        {below}
      </div>
    </li>
  );
}

/**
 * Step ① done-row peer status. Mounted only when Step ① is done AND `anthropic`
 * is authenticated, so its two requests (probe + recommended) happen only then.
 * First match wins (design D3c).
 */
function Step1PeerStatus() {
  const { t } = useI18n();
  const probe = useAnthropicPeerProbe();
  const { recommended, refresh: refreshRecommended } = useRecommendedExtensions();
  const store = usePeerAutoInstall();

  // A probe that reports the peer resolving drops installed/failed.
  useEffect(() => {
    if (probe.peerResolving) peerAutoInstallStore.notifyPeerResolving();
  }, [probe.peerResolving, store.outcome]);

  const entry = recommended.find((e) => e.id === ANTHROPIC_PEER_ENTRY_ID);
  const install = () => {
    // Same decision (vetoes + pending rule) as the automatic path; then re-read
    // so a veto the fresh read found (e.g. an import failure) is shown.
    void peerAutoInstallStore.ensureInstall("manual").then(() => {
      void probe.refresh();
      void refreshRecommended();
    });
  };

  let content: React.ReactNode = null;
  if (probe.importFailed) {
    content = (
      <InlineMessage
        severity="warning"
        icon={mdiAlert}
        testId="onboarding-step-1-peer-importfailed"
        title={t(
          "landing.peerImportFailed",
          undefined,
          "pi-anthropic-messages failed to load — see Settings › Providers",
        )}
      />
    );
  } else if (probe.peerResolving) {
    content = null;
  } else if (store.outcome === "deciding" || store.outcome === "running" || store.outcome === "failed") {
    content = (
      <PeerAutoInstallStatus
        outcome={store.outcome}
        message={store.message}
        onRetry={() => void peerAutoInstallStore.retry()}
        testId="anthropic-peer-autoinstall"
        retryTestId="onboarding-step-1-peer-retry"
      />
    );
  } else if (store.outcome === "installed") {
    content = null;
  } else if (entry && !entry.activeInPi) {
    content = (
      <InlineMessage
        severity="warning"
        icon={mdiAlert}
        testId="onboarding-step-1-peer-missing"
        title={t("landing.peerNeedsInstall", undefined, "Claude tool calls need pi-anthropic-messages")}
        actions={
          <button
            type="button"
            data-testid="onboarding-step-1-peer-install"
            onClick={install}
            className={SECONDARY_BUTTON_CLASS}
          >
            {t("landing.peerInstall", undefined, "Install")}
          </button>
        }
      />
    );
  }

  return (
    <div role="status" aria-live="polite" data-testid="onboarding-step-1-peer-status" className="mt-2">
      {content}
    </div>
  );
}

function CreateProjectForm({
  onCreateProject,
  onOpenPinDialog,
  onCreated,
}: {
  onCreateProject?: LandingPageProps["onCreateProject"];
  onOpenPinDialog?: () => void;
  onCreated: (existed: boolean) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(DEFAULT_PROJECT_NAME);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  // Synchronous guard: a double click must never issue a second request, even
  // before React has re-rendered the disabled state.
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current || !onCreateProject) return;
    inFlight.current = true;
    setBusy(true);
    setReason(null);
    let result: LandingCreateProjectResult;
    try {
      result = await onCreateProject(name);
    } catch {
      result = { ok: false };
    }
    inFlight.current = false;
    // Unconditional on purpose: the pin lands in App state before this continuation
    // runs, which unmounts this form (step ② becomes done) — the existed note lives in the parent.
    if (result.ok) onCreated(result.existed);
    if (!mounted.current) return;
    setBusy(false);
    if (!result.ok) setReason(result.reason && KNOWN_REASONS.has(result.reason) ? result.reason : "generic");
  };

  const errorCopy: Record<string, string> = {
    invalid_name: t("landing.createError.invalid_name", undefined, "Use a single folder name without / or \\, for example my-project."),
    reserved_name: t("landing.createError.reserved_name", undefined, "That name is reserved by Windows. Choose another, for example my-project."),
    too_long: t("landing.createError.too_long", undefined, "That name is too long. Use at most 255 bytes."),
    not_a_directory: t("landing.createError.not_a_directory", undefined, "A file with that name already exists in your Projects folder. Choose another name."),
    root_not_a_directory: t("landing.createError.root_not_a_directory", undefined, "Your Projects folder is not a folder. Rename it, or use an existing folder."),
    outside_root: t("landing.createError.outside_root", undefined, "That name points outside your Projects folder. Choose another name."),
    home_missing: t("landing.createError.home_missing", undefined, "Your home folder could not be found."),
    fs_error: t("landing.createError.fs_error", undefined, "The folder could not be created. Check permissions, or use an existing folder."),
    generic: t("landing.createError.generic", undefined, "Couldn't create the project. Try another name, or use an existing folder."),
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2" noValidate>
      <label
        htmlFor="onboarding-step-2-name"
        className="text-[12px] font-semibold text-[var(--text-primary)]"
      >
        {t("landing.createProjectLabel", undefined, "Project name")}
      </label>
      {reason && (
        <p
          id="onboarding-step-2-error"
          data-testid="onboarding-step-2-error"
          className="flex items-start gap-1.5 text-[12px] text-[var(--severity-error-fg)]"
        >
          <Icon path={mdiAlert} size={0.6} aria-hidden="true" className="shrink-0 mt-0.5" />
          <span>{errorCopy[reason] ?? errorCopy.generic}</span>
        </p>
      )}
      <input
        id="onboarding-step-2-name"
        data-testid="onboarding-step-2-name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (reason) setReason(null);
        }}
        disabled={busy}
        aria-invalid={reason ? "true" : undefined}
        aria-describedby={reason ? "onboarding-step-2-error" : "onboarding-step-2-hint"}
        autoComplete="off"
        spellCheck={false}
        className="focus-ring rounded-md border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)] px-3 min-h-[44px] sm:min-h-[36px] text-[13px] font-mono"
      />
      <p id="onboarding-step-2-hint" className="text-[11px] text-[var(--text-secondary)]">
        {t("landing.createProjectHint", undefined, "Creates a folder with this name in your Projects folder.")}
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="submit"
          data-testid="onboarding-step-2-create"
          disabled={busy}
          aria-busy={busy ? "true" : undefined}
          className={PRIMARY_BUTTON}
        >
          {busy ? t("landing.creating", undefined, "Creating…") : t("landing.createProject", undefined, "Create project")}
        </button>
        <button
          type="button"
          data-testid="onboarding-step-2-cta"
          disabled={busy}
          onClick={() => onOpenPinDialog?.()}
          className={LINK_BUTTON}
        >
          <Icon path={mdiFolderOutline} size={0.55} aria-hidden="true" className="inline mr-1" />
          {t("landing.useExistingFolder", undefined, "Use an existing folder…")}
        </button>
      </div>
    </form>
  );
}

export function LandingPage({
  providersReady = false,
  anthropicAuthenticated = null,
  pinnedCount = 0,
  sessionsCount = 0,
  firstPinnedCwd = null,
  onOpenPinDialog,
  onCreateProject,
  onSpawnSession,
  navigate,
}: LandingPageProps = {}) {
  const { t } = useI18n();
  // The quick-spawn uses the folder's remembered agent (pi when none).
  // See change: add-acp-session-driver (D16).
  const acpAgents = useAcpAgents();
  // Page-instance state: gone once Landing unmounts (opening a session).
  const [existed, setExisted] = useState(false);
  // Legacy behaviour: if no onboarding props are supplied at all, fall back to the
  // original minimal placeholder (keeps existing tests and stories intact).
  const hasOnboardingContext =
    onOpenPinDialog !== undefined ||
    onSpawnSession !== undefined ||
    navigate !== undefined;

  if (!hasOnboardingContext) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
        <div className="text-center">
          <div className="text-6xl mb-4 text-[var(--accent-primary)] opacity-50">π</div>
          <p className="text-sm">{t("landing.selectSession", undefined, "Select a session to get started")}</p>
        </div>
      </div>
    );
  }

  // Derive states per design.md D1
  const step1: StepState = providersReady ? "done" : "pending";
  const step2: StepState = !providersReady
    ? "locked"
    : pinnedCount > 0
      ? "done"
      : "pending";
  const step3: StepState = pinnedCount === 0
    ? "locked"
    : sessionsCount > 0
      ? "done"
      : "pending";
  const states = [step1, step2, step3];
  const doneCount = states.filter((s) => s === "done").length;
  const firstPending = states.indexOf("pending");
  const allDone = doneCount === 3;

  const titles = [
    t("landing.stepTitle1", undefined, "Connect a model provider"),
    t("landing.stepTitle2", undefined, "Create your first project"),
    t("landing.stepTitle3", undefined, "Start your first session"),
  ];

  /** A collapsed, non-done row's reason text. */
  const lockText = (n: number): string => {
    if (n === 2) return t("landing.needsProvider", undefined, "Needs a model provider");
    if (!providersReady && pinnedCount > 0) {
      return t("landing.waitsOnStep", { step: 1, title: titles[0] }, `Waits for step 1: ${titles[0]}`);
    }
    return t("landing.needsFolder", undefined, "Needs a project folder");
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
      <div className="flex flex-col gap-4 w-full max-w-xl">
        <div className="text-center">
          <div className="text-6xl mb-2 text-[var(--accent-primary)] opacity-50" aria-hidden="true">π</div>
          <div className="text-lg font-semibold text-[var(--text-primary)]">
            {allDone
              ? t("landing.pickSession", undefined, "Pick a session on the left to continue")
              : t("landing.welcome", undefined, "Welcome to pi-dashboard")}
          </div>
          {!allDone && (
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              {t("landing.stepsHint", undefined, "Three quick steps to get your first session running.")}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border-secondary)]">
            <div data-testid="onboarding-progress" className="text-[12px] font-semibold text-[var(--text-secondary)]">
              {t("landing.progress", { done: doneCount }, `${doneCount} of 3 done`)}
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden" aria-hidden="true">
              <div
                className="h-full rounded-full bg-[var(--accent-primary)]"
                style={{ width: `${Math.round((doneCount / 3) * 100)}%` }}
              />
            </div>
          </div>

          <ol className="list-none m-0 p-0">
            {/* Step 1 */}
            <StepRow
              n={1}
              state={step1}
              title={titles[0]}
              expanded={firstPending === 0}
              testId={step1 === "done" ? "onboarding-step-1-done" : "onboarding-step-1-locked"}
              below={step1 === "done" && anthropicAuthenticated === true ? <Step1PeerStatus /> : undefined}
            >
              {step1 === "done" ? (
                t("landing.credentialsConfigured", undefined, "Credentials configured")
              ) : (
                <>
                  <p className="text-[12px] text-[var(--text-secondary)]">
                    {t("landing.setupCredentialsDescription", undefined, "Connect an LLM provider (Anthropic, OpenAI, ...) so sessions can reach a model.")}
                  </p>
                  <div>
                    <button
                      type="button"
                      data-testid="onboarding-step-1-cta"
                      onClick={() => navigate?.("/settings/providers")}
                      className={PRIMARY_BUTTON}
                    >
                      {t("landing.connectProvider", undefined, "Connect a provider")}
                    </button>
                  </div>
                </>
              )}
            </StepRow>

            {/* Step 2 */}
            <StepRow
              n={2}
              state={step2}
              title={titles[1]}
              expanded={firstPending === 1}
              testId={step2 === "done" ? "onboarding-step-2-done" : "onboarding-step-2-locked"}
              below={
                step2 === "done" && existed ? (
                  <p data-testid="onboarding-step-2-existed" className="mt-1 text-[12px] text-[var(--text-secondary)]">
                    {t("landing.createProjectExisted", undefined, "That folder already existed, so it was pinned as-is.")}
                  </p>
                ) : undefined
              }
            >
              {step2 === "done" ? (
                t("landing.pinnedFolders", { count: pinnedCount }, `${pinnedCount} folder${pinnedCount === 1 ? "" : "s"} pinned`)
              ) : step2 === "locked" ? (
                lockText(2)
              ) : (
                <CreateProjectForm
                  onCreateProject={onCreateProject}
                  onOpenPinDialog={onOpenPinDialog}
                  onCreated={setExisted}
                />
              )}
            </StepRow>

            {/* Step 3 */}
            <StepRow
              n={3}
              state={step3}
              title={titles[2]}
              expanded={firstPending === 2}
              testId={step3 === "done" ? "onboarding-step-3-done" : "onboarding-step-3-locked"}
            >
              {step3 === "done" ? (
                t("landing.activeSessions", { count: sessionsCount }, `${sessionsCount} active session${sessionsCount === 1 ? "" : "s"}`)
              ) : firstPending !== 2 ? (
                lockText(3)
              ) : (
                <>
                  <p className="text-[12px] text-[var(--text-secondary)]">
                    {firstPinnedCwd
                      ? t("landing.startSessionDescription", { path: truncatePath(firstPinnedCwd) }, `+Session: a pi session in ${truncatePath(firstPinnedCwd)}.`)
                      : t("landing.startSessionDescriptionFallback", undefined, "+Session: your first pi session in a pinned folder.")}
                  </p>
                  <div>
                    <button
                      type="button"
                      data-testid="onboarding-step-3-cta"
                      onClick={() => {
                        if (!firstPinnedCwd) return;
                        const agent = getRememberedAgent(firstPinnedCwd, acpAgents);
                        if (agent) onSpawnSession?.(firstPinnedCwd, undefined, { agent });
                        else onSpawnSession?.(firstPinnedCwd);
                      }}
                      disabled={!firstPinnedCwd}
                      className={PRIMARY_BUTTON}
                    >
                      {t("landing.startSession", undefined, "Start session")}
                    </button>
                  </div>
                </>
              )}
            </StepRow>
          </ol>
        </div>
      </div>
    </div>
  );
}

function truncatePath(p: string, max = 40): string {
  if (p.length <= max) return p;
  return "…" + p.slice(-(max - 1));
}
