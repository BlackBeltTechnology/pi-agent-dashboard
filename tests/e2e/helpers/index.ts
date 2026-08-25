import { expect, type Locator, type Page } from "@playwright/test";

// Central testid → locator map. Specs select on existing app data-testids
// (693 already shipped) — NOT CSS classes, text copy, or DOM structure.
// A renamed testid breaks here, in one place. Do NOT add app testids for E2E.
// See openspec change add-playwright-e2e/design.md.
export const TESTIDS = {
  // Stable shell — header bar renders on the main dashboard view.
  headerAppBar: "header-app-bar",
  settingsBtn: "settings-btn",
  // Sessions (scenario backlog).
  sessionCardDesktop: "session-card-desktop",
  sessionSearchInput: "session-search-input",
  // Pin folder + spawn (scenario 5.1 — authoritative WS round-trip).
  // Empty-state path: the LandingPage onboarding CTAs drive the same actions
  // (open pin dialog / spawn) and are the deterministic affordances on a
  // fresh container. Step CTAs are gated on `providersReady` (seeded key).
  onboardingStep2Cta: "onboarding-step-2-cta", // "Add folder" → opens AddFoldersDialog
  onboardingStep3Cta: "onboarding-step-3-cta", // "Start session" → spawns
  // The "Add folder" CTAs open the multi-select AddFoldersDialog. The former
  // single-path PinDirectoryDialog (`pin-directory-dialog`) still EXISTS and
  // still renders that testid, but is only reachable from Settings ▸ Packages
  // — no longer from these affordances. The map kept pointing at it, so every
  // spec that pins a folder hung until its 180 s cap.
  // The flow differs too: the row body navigates, a per-row checkbox selects
  // into a basket, and a commit button pins every basket entry.
  // See change: project-scope-disable-global-resources (helper drift fix).
  addFoldersDialog: "add-folders-dialog",
  addFoldersCommit: "add-folders-commit",
  // Accumulated-state path: once a folder/session exists the LandingPage
  // onboarding view is gone and the sidebar exposes these instead. The
  // ensureGitSession() helper falls back to them when the onboarding CTAs
  // are absent (specs share one container, so state persists across specs).
  dashboardAddFolderBtn: "dashboard-add-folder-btn", // sidebar "Add Folder"
  folderSpawnSessionBtn: "folder-spawn-session-btn", // sidebar "New Session"
  // Composer send button (faux round-trip specs drive a prompt through it).
  sendButton: "send-button",
  // Session-header "Refresh Chat" control (SessionHeader.tsx). Drives the
  // durable replay-cache purge the reset-path specs assert against.
  // See change: purge-replay-cache-on-reset-paths.
  refreshChat: "refresh-chat",
  // Flow launch dialog submit (flow-roundtrip L3 spec drives a real pi-flows
  // run through it). Existing app testid on FlowLaunchDialog's Run button — no
  // new app testid added. See change: add-flow-plugin-e2e-tests.
  flowLaunchRun: "flow-launch-run",
  // Chat transcript scroller + its scroll-to-bottom button. The scroller testid
  // is a deliberate exception to "do NOT add app testids for E2E": the windowed
  // transcript needs a stable getScrollElement node, and the virtualization
  // specs must read scrollTop/scrollHeight off it. See change:
  // virtualize-chat-transcript-tanstack (task 9.2).
  chatScrollContainer: "chat-scroll-container",
  scrollToBottom: "scroll-to-bottom",
  // Scroll-to-top control, symmetric to scroll-to-bottom. The estimate-drift
  // e2e reads it to prove scroll-up converges on index 0. See change:
  // fix-chat-scroll-to-top-estimate-drift.
  scrollToTop: "scroll-to-top",
  // TokenStatsBar turn bar — clicking it fires scrollToTurn (jump-to-turn
  // affordance the off-screen scrollToTurn e2e drives). data-turn-index carries
  // the turnIndex. See change: virtualize-chat-transcript-tanstack.
  turnBar: "turn-bar",
  // Optimistic idle-send bubble + mid-turn follow-up queue chip.
  // See change: optimistic-prompt-progress.
  pendingPromptCard: "pending-prompt-card",
  queueChipFollowup: "queue-chip-followup",
  // Follow-up chip surface: the panel, the per-entry attachment-count
  // indicator, and the inline editor controls. The indicator renders only when
  // the entry carries images; bytes never cross the wire, so it is a COUNT and
  // never a thumbnail. See change: fix-bridge-followup-image-drop.
  queuePanel: "queue-panel",
  queueFollowupAttachments: "queue-followup-attachments",
  queueFollowupEdit: "queue-followup-edit",
  queueFollowupEditor: "queue-followup-editor",
  queueFollowupEditorSubmit: "queue-followup-editor-submit",
  queueFollowupPosition: "queue-followup-position",
  // VCS panels (scenario backlog).
  composerGitGroup: "composer-git-group",
  composerStatusGroup: "composer-status-group",
  gitInitBtn: "git-init-btn",
  // Polymorphic Initialize on a no-hook folder row → spawns the interactive
  // project-init scaffolder. See change: project-init-skill-and-profiles.
  projectInitBtn: "project-init-btn",
  // Worktree-init hook feedback surfaces (folder row). See change:
  // friendlier-worktree-init.
  worktreeInitBtn: "worktree-init-btn",
  worktreeInitChip: "worktree-init-chip",
  worktreeInitError: "worktree-init-error",
  worktreeInitRetry: "worktree-init-retry",
  worktreeInitLog: "worktree-init-log",
  worktreeInitGhost: "worktree-init-ghost",
  // Git branch indicator on a session card — renders once the bridge reports
  // session.gitBranch (proves git status read from the repo). Scenario 5.2.
  gitBranchBtn: "git-branch-btn",
  // Uncommitted-indicator + commit-from-card (change:
  // add-session-uncommitted-indicator-and-commit). Pill + drift chips render
  // on the card `GitInfo` (solo/worktree) or the folder-header `GroupGitInfo`
  // (grouped 2+). The CommitDialog is placement-agnostic.
  gitDirtyPill: "git-dirty-pill",
  gitDirtyCount: "git-dirty-count",
  gitAhead: "git-ahead",
  gitBehind: "git-behind",
  groupCommitBtn: "group-commit-btn",
  commitDialog: "commit-dialog",
  commitFileList: "commit-file-list",
  commitSelectAll: "commit-select-all",
  commitSubject: "commit-subject",
  commitBody: "commit-body",
  commitAiDraft: "commit-ai-draft",
  commitDraftUnavailable: "commit-draft-unavailable",
  commitSubmit: "commit-submit",
  commitCancel: "commit-cancel",
  commitError: "commit-error",
  // Terminal (scenario 5.4). open-inline-terminal-button lives in the selected
  // session's composer (CommandInput); terminal-card mounts in the chat stream.
  terminalCard: "terminal-card",
  openInlineTerminalButton: "open-inline-terminal-button",
  // Top-level / folder route containers (scenario 5.6 navigation).
  settingsContent: "settings-content",
  openspecBoard: "openspec-board",
  archiveBrowser: "archive-browser",
  specsBrowser: "specs-browser",
} as const;

export function byTestId(scope: Page | Locator, key: keyof typeof TESTIDS): Locator {
  // Accepts a Locator as well as a Page so a lookup can be scoped to a dialog
  // or card; both expose the same `getByTestId`.
  return scope.getByTestId(TESTIDS[key]);
}

/** Navigate to the dashboard root and wait for the shell to mount. */
// Track pages that already have the first-launch auto-dismiss handler wired, so
// repeated gotoDashboard calls don't stack duplicate handlers.
const firstLaunchHandled = new WeakSet<Page>();

/**
 * On a fresh/wiped container the first-launch display-preset modal renders
 * ASYNCHRONOUSLY (once display prefs arrive over /ws), and its backdrop then
 * intercepts every onboarding/sidebar click. A one-shot check races that
 * render, so register a Playwright locator handler that auto-clicks the modal's
 * own scoped "Skip" the moment it appears, before any action. Idempotent and
 * scoped to the first-launch backdrop testid so no unrelated "Skip" is hit.
 */
async function armFirstLaunchDismiss(page: Page): Promise<void> {
  if (firstLaunchHandled.has(page)) return;
  firstLaunchHandled.add(page);
  const backdrop = page.getByTestId("first-launch-display-backdrop");
  await page.addLocatorHandler(backdrop, async () => {
    await backdrop.getByRole("button", { name: /^skip$/i }).click();
  });
}

export async function gotoDashboard(page: Page): Promise<void> {
  await armFirstLaunchDismiss(page);
  await page.goto("/");
  await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
}

// Baked git fixture, materialized as a real repo by docker/test-entrypoint.sh
// at this path inside the container.
export const FIXTURE_GIT = "/fixtures/sample-git";

async function visible(loc: Locator): Promise<boolean> {
  return loc.isVisible().catch(() => false);
}

/**
 * Open the add-folders dialog, select one absolute path, commit.
 *
 * Uses whichever "add folder" affordance the current state exposes:
 * the onboarding step-2 CTA (fresh container) or the sidebar button
 * (a folder/session already exists). Requires PI_E2E_SEED=1 so the
 * onboarding gate is cleared and the directory-listing endpoint is reachable.
 *
 * Pinning is IMPLICIT here — adding a folder IS pinning it, so the dialog
 * offers no pin control. Typing the full path is still how the target row is
 * reached (`parseInput` splits it into parent + filter, so the parent is
 * listed and filtered down to the leaf), but selection is now the per-row
 * checkbox plus a commit button, not a `Select` confirm.
 */
export async function pinDirectory(page: Page, absPath: string): Promise<void> {
  const onboardingCta = byTestId(page, "onboardingStep2Cta");
  if (await visible(onboardingCta)) {
    await onboardingCta.click();
  } else {
    await byTestId(page, "dashboardAddFolderBtn").first().click();
  }
  const dialog = byTestId(page, "addFoldersDialog");
  await dialog.waitFor({ state: "visible" });
  // The picker lists the typed path's PARENT filtered by its leaf, so typing
  // the full path surfaces the target's own row. Tick that row's checkbox —
  // the basket, not the browsed directory, is what the dialog commits.
  // `.first()` — the dialog grows a second textbox in new-folder mode.
  const textbox = dialog.getByRole("textbox").first();
  // The picker re-lists its initial directory on mount, and that late response
  // can land AFTER an immediate fill and clobber it. Let the first listing
  // render, then fill, then assert the value actually STUCK (auto-retrying)
  // before selecting — otherwise the row below never appears and the spec dies
  // at its timeout with no clue why.
  await dialog.getByRole("option").first().waitFor({ state: "visible", timeout: 20_000 });
  await textbox.fill(absPath);
  await expect(textbox).toHaveValue(absPath);
  // Keyed by the FULL path, so no leaf-regex escaping is needed and a sibling
  // whose name contains the target's cannot be ticked instead.
  const check = dialog.getByTestId(`path-picker-check-${absPath}`);
  await check.waitFor({ state: "visible", timeout: 20_000 });
  await check.click();
  const commit = byTestId(dialog, "addFoldersCommit");
  await expect(commit).toBeEnabled(); // proves the basket actually took the path
  await commit.click();
  await dialog.waitFor({ state: "hidden" });
}

/**
 * Idempotently guarantee a session spawned in the baked git fixture, returning
 * its card locator. Reuses an existing card if one is already present (specs
 * share one container), otherwise pins FIXTURE_GIT and spawns. The spawned
 * `pi` process registers over the bridge `/ws`, which is what makes the card
 * appear — independent of credential validity (no model call at spawn).
 */
export async function ensureGitSession(page: Page): Promise<Locator> {
  await gotoDashboard(page);
  const card = byTestId(page, "sessionCardDesktop").first();
  // Bounded wait, not an instant check: a card from an earlier spec (specs
  // share one container) may still be hydrating after navigation. Reuse it
  // rather than spawning a duplicate.
  const reused = await card
    .waitFor({ state: "visible", timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
  if (reused) return card;

  await pinDirectory(page, FIXTURE_GIT);

  const spawnCta = byTestId(page, "onboardingStep3Cta");
  if (await visible(spawnCta)) {
    await spawnCta.click();
  } else {
    await byTestId(page, "folderSpawnSessionBtn").first().click();
  }
  await card.waitFor({ state: "visible", timeout: 60_000 });
  return card;
}

/**
 * Spawn a BRAND-NEW git session and return its card, isolated from any other
 * session in the shared container.
 *
 * Unlike `ensureGitSession` (which reuses an existing card), this always spawns
 * a fresh session and resolves it by a `data-session-id` not present before the
 * spawn. Faux round-trip specs need isolation: e.g. an `ask_user` scenario
 * leaves a pending interactive prompt that would block a reused session for the
 * next spec. Pins FIXTURE_GIT first if no folder exists yet.
 */
export async function spawnFreshGitSession(page: Page): Promise<Locator> {
  await gotoDashboard(page);
  const cardsSel = '[data-testid="session-card-desktop"]';

  // Settle WS hydration before branching: a fresh load briefly shows the
  // onboarding (empty) view, then flips to the dashboard view once sessions
  // arrive over /ws. Clicking the onboarding CTA mid-flip detaches it. If any
  // card is present after the settle we are in dashboard mode (folder pinned).
  const hasSessions = await page
    .locator(cardsSel)
    .first()
    .waitFor({ state: "visible", timeout: 6_000 })
    .then(() => true)
    .catch(() => false);

  const existing = new Set(
    (
      (await page
        .locator(cardsSel)
        .evaluateAll((els) =>
          els.map((e) => e.getAttribute("data-session-id")),
        )) as (string | null)[]
    ).filter((id): id is string => Boolean(id)),
  );

  const spawnBtn = byTestId(page, "folderSpawnSessionBtn").first();
  if (hasSessions || (await visible(spawnBtn))) {
    // Dashboard mode (a folder is already pinned): spawn via the sidebar.
    await spawnBtn.waitFor({ state: "visible", timeout: 15_000 });
    await spawnBtn.click();
  } else {
    // Truly empty container: the onboarding flow pins the fixture and spawns.
    await pinDirectory(page, FIXTURE_GIT);
    const step3 = byTestId(page, "onboardingStep3Cta");
    if (await visible(step3)) await step3.click();
    else await byTestId(page, "folderSpawnSessionBtn").first().click();
  }

  let card!: Locator;
  await expect
    .poll(
      async () => {
        const ids = (await page
          .locator(cardsSel)
          .evaluateAll((els) =>
            els.map((e) => e.getAttribute("data-session-id")),
          )) as (string | null)[];
        const fresh = ids.find((id) => id && !existing.has(id));
        if (fresh) {
          card = page.locator(`${cardsSel}[data-session-id="${fresh}"]`);
          return true;
        }
        return false;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  return card;
}

/** One observed `tool_execution_update` frame on the browser `/ws` socket. */
export interface TickSample {
  /** Receive time (ms, monotonic-ish wall clock) — the rate measurement's x-axis. */
  at: number;
  /**
   * The event's OWN timestamp, stamped by the bridge when it forwarded the
   * frame. This is the x-axis for stored-tick staleness (P3): receive time on a
   * replay frame measures the replay, not the gap the throttle introduced.
   */
  ts: number;
  toolName: string;
  toolCallId: string;
  /** Owning session id, so a measurement can isolate its OWN run's frames when
   * a previous session's producer is still streaming. */
  sessionId: string;
  /** Payload size in bytes, for the bytes/s half of the D1 baseline. */
  bytes: number;
}

export interface TickCollector {
  /** Every `tool_execution_update` frame, in receive order. */
  all: TickSample[];
  /** Only Agent ticks — the carrier this change throttles. */
  agent: () => TickSample[];
  /** Mean Agent-tick frames/s over the WHOLE window, not per 1 s bucket. */
  agentRate: (windowMs: number) => number;
}

/**
 * Collect `tool_execution_update` frames off the browser's `/ws` socket,
 * broken down by `toolName`.
 *
 * The breakdown is load-bearing, not decoration: the parent change's F4 matcher
 * counts EVERY `tool_execution_update`, so an unfiltered count can be carried
 * entirely by unrelated tools and would pass at any throttle window. Only
 * frames whose `toolName` is `Agent` belong to the throttled carrier.
 *
 * Attach BEFORE the run starts — `page.on("websocket")` only sees sockets
 * opened after it is registered.
 *
 * See change: reduce-bridge-tick-bandwidth (D1, D6).
 */
export function collectAgentTicks(page: Page): TickCollector {
  const all: TickSample[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      const payload = typeof frame.payload === "string" ? frame.payload : "";
      if (!payload.includes("tool_execution_update")) return;
      let parsed: any;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return; // non-JSON frame: not ours
      }
      // Both the live `event` message and a replayed batch carry the same
      // DashboardEvent shape; count each contained event once.
      const events: any[] = parsed?.event
        ? [parsed.event]
        : Array.isArray(parsed?.events)
          ? parsed.events.map((e: any) => e?.event).filter(Boolean)
          : [];
      const frameSessionId = String(parsed?.sessionId ?? "");
      for (const ev of events) {
        if (ev?.eventType !== "tool_execution_update") continue;
        all.push({
          at: Date.now(),
          ts: typeof ev?.timestamp === "number" ? ev.timestamp : 0,
          toolName: String(ev?.data?.toolName ?? ""),
          toolCallId: String(ev?.data?.toolCallId ?? ""),
          sessionId: frameSessionId,
          bytes: payload.length,
        });
      }
    });
  });
  const agent = () => all.filter((s) => s.toolName === "Agent");
  return {
    all,
    agent,
    // Mean over the WHOLE window. A per-1 s-bucket assertion would be wrong:
    // the leading + trailing edges of adjacent windows can legitimately put 3
    // frames in one bucket at a 500 ms window.
    agentRate: (windowMs: number) => (agent().length / windowMs) * 1000,
  };
}

/** One observed subagent-carrying frame, on either carrier. */
export interface SubagentFrameSample {
  at: number;
  /** Owning session id — the shared harness runs one container, so a previous
   *  spec's producer can still be streaming into this window. */
  sessionId: string;
  /** `tool_execution_update` | `subagent_created` | `subagent_started` | … */
  eventType: string;
  /** The watched agent, read from whichever slot the carrier uses. */
  agentId: string;
  status: string;
  /** Timeline length carried by THIS frame (0 when stripped). */
  entryCount: number;
  /**
   * Set ONLY on a resync REPLY (`subagent-forward-sites.ts` echoes the
   * requester's token). This is the ONLY way to tell a reply from a pushed
   * `subagent_started` — they share an eventType, so eventType cannot classify
   * them. See change: verify-subagent-pull-under-load (V2).
   */
  resyncRequestId?: string;
  /**
   * Bytes attributed to THIS frame. A batched replay message carries many
   * events; `collectAgentTicks` charges each of them the WHOLE payload length
   * (an N× over-count). Here each event is charged its own serialized size.
   */
  bytes: number;
}

/**
 * One `subagent_resync_request` the CLIENT sent (outgoing direction).
 * Not exported: reached only through `SubagentWireCollector`, so exporting it
 * would be a dead export (knip `types` class).
 */
interface ResyncRequestSample {
  at: number;
  agentId: string;
  requestId: string;
  /** `"open"` (expand / popout / subscribe) or `"cadence"` (the D4 v1 timer). */
  reason: string;
}

export interface SubagentWireCollector {
  /** Inbound subagent-carrying frames, in receive order. */
  frames: SubagentFrameSample[];
  /** Outbound resync requests, in send order. */
  requests: ResyncRequestSample[];
  /** Inbound frames for one agent. */
  forAgent: (agentId: string) => SubagentFrameSample[];
  /** Resync REPLIES for one agent (frames bearing a requester token). */
  repliesFor: (agentId: string) => SubagentFrameSample[];
  /** PUSHED frames for one agent (everything without a requester token). */
  pushesFor: (agentId: string) => SubagentFrameSample[];
  /** Outbound requests for one agent, optionally filtered by reason. */
  requestsFor: (agentId: string, reason?: string) => ResyncRequestSample[];
}

const SUBAGENT_STATUS_OF = (ev: any): string =>
  String(ev?.data?.details?.status ?? ev?.data?.partialResult?.details?.status ?? "");

const AGENT_ID_OF = (ev: any): string =>
  String(
    ev?.data?.id ??
      ev?.data?.details?.agentId ??
      ev?.data?.partialResult?.details?.agentId ??
      "",
  );

const ENTRY_COUNT_OF = (ev: any): number => {
  const e =
    ev?.data?.details?.entries ??
    ev?.data?.partialResult?.details?.entries ??
    // `tool_execution_end` carries the final snapshot under `result`.
    ev?.data?.result?.details?.entries;
  return Array.isArray(e) ? e.length : 0;
};

/**
 * Collect BOTH subagent carriers off the browser `/ws` socket, in both
 * directions.
 *
 * Why this exists next to `collectAgentTicks` rather than replacing it: the
 * throttle rows measure `tool_execution_update` FRAME RATE filtered by
 * `toolName`, while the pull-path rows measure BYTES per carrier and need the
 * `__resyncRequestId` discriminator plus the outgoing requests. Same socket,
 * different questions.
 *
 * Attach BEFORE the run starts — `page.on("websocket")` only sees sockets opened
 * after it is registered.
 *
 * See change: verify-subagent-pull-under-load (V2/V5).
 */
export function collectSubagentWire(page: Page): SubagentWireCollector {
  const frames: SubagentFrameSample[] = [];
  const requests: ResyncRequestSample[] = [];

  const ingest = (payload: string): void => {
    if (
      !payload.includes("subagent") &&
      !payload.includes("tool_execution_update") &&
      !payload.includes("tool_execution_end")
    ) {
      return;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const events: any[] = parsed?.event
      ? [parsed.event]
      : Array.isArray(parsed?.events)
        ? parsed.events.map((e: any) => e?.event).filter(Boolean)
        : [];
    for (const ev of events) {
      const eventType = String(ev?.eventType ?? "");
      // `tool_execution_end` is admitted deliberately: it is a TERMINAL carrier
      // for an Agent run, and a caller asking "did any terminal frame arrive for
      // this agent?" would otherwise get a vacuous `false` because the event
      // never entered the collector at all.
      const isToolCarrier =
        (eventType === "tool_execution_update" || eventType === "tool_execution_end") &&
        String(ev?.data?.toolName ?? "") === "Agent";
      if (!eventType.startsWith("subagent_") && !isToolCarrier) continue;
      const token = ev?.data?.__resyncRequestId;
      frames.push({
        at: Date.now(),
        sessionId: String(parsed?.sessionId ?? ""),
        eventType,
        agentId: AGENT_ID_OF(ev),
        status: SUBAGENT_STATUS_OF(ev),
        entryCount: ENTRY_COUNT_OF(ev),
        resyncRequestId: typeof token === "string" && token ? token : undefined,
        // Per-frame attribution: charge this event its OWN serialized size, so a
        // batched replay message is not counted once per contained event.
        bytes: JSON.stringify(ev).length,
      });
    }
  };

  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      ingest(typeof frame.payload === "string" ? frame.payload : "");
    });
    ws.on("framesent", (frame) => {
      const payload = typeof frame.payload === "string" ? frame.payload : "";
      if (!payload.includes("subagent_resync_request")) return;
      try {
        const msg = JSON.parse(payload);
        if (msg?.type !== "subagent_resync_request") return;
        requests.push({
          at: Date.now(),
          agentId: String(msg.agentId ?? ""),
          requestId: String(msg.requestId ?? ""),
          reason: String(msg.reason ?? ""),
        });
      } catch {
        /* non-JSON frame: not ours */
      }
    });
  });

  const forAgent = (agentId: string) => frames.filter((f) => f.agentId === agentId);
  return {
    frames,
    requests,
    forAgent,
    repliesFor: (agentId) => forAgent(agentId).filter((f) => f.resyncRequestId !== undefined),
    pushesFor: (agentId) => forAgent(agentId).filter((f) => f.resyncRequestId === undefined),
    requestsFor: (agentId, reason) =>
      requests.filter((r) => r.agentId === agentId && (reason === undefined || r.reason === reason)),
  };
}

/**
 * Write `subagentTickThrottleMs` into the CONTAINER's dashboard config file.
 *
 * The bridge reads `~/.pi/dashboard/config.json` once per bridge init, and no
 * env override exists for it (deliberate — the config surface stays single-
 * sourced). `PUT /api/config` is a shallow partial merge onto that same file,
 * so this is literally "the harness writes the dashboard config file into the
 * container". Call it BEFORE `spawnFreshGitSession()`: only a session spawned
 * after the write picks the value up; an already-running bridge keeps the old
 * one.
 *
 * See change: reduce-bridge-tick-bandwidth (task 1.3, D4).
 */
export async function setSubagentTickThrottle(page: Page, ms: number): Promise<void> {
  const res = await page.request.put("/api/config", { data: { subagentTickThrottleMs: ms } });
  expect(res.ok(), `PUT /api/config subagentTickThrottleMs=${ms} failed: ${res.status()}`).toBe(true);
  // Read back through the same surface the bridge reads, so a silently-dropped
  // unknown key fails the setup rather than the (then-vacuous) measurement.
  const readBack = await page.request.get("/api/config");
  const body = (await readBack.json()) as { data?: Record<string, unknown> };
  const cfg = (body.data ?? {}) as Record<string, unknown>;
  expect(cfg.subagentTickThrottleMs, "config did not retain subagentTickThrottleMs").toBe(ms);
}

/**
 * Type a prompt into the selected session's composer and submit it.
 *
 * Precondition: a session card is already selected (so CommandInput renders).
 * The faux round-trip specs use a `[[faux:<scenario-id>]]` sentinel prefix the
 * faux fixture resolves to a scripted scenario (see
 * `qa/fixtures/faux-provider.ext.ts`). Requires PI_E2E_SEED=1 so the faux model
 * is staged + selected.
 */
export async function sendPrompt(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder(/message/i).first();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await composer.fill(text);
  const send = byTestId(page, "sendButton");
  await send.click();
}

// ── Git working-tree helpers (uncommitted-indicator + commit E2E) ────────────
// Drive the dashboard's OWN same-origin REST from the page context. The
// dashboard is localhost-gated (no auth header), so a page-context `fetch`
// authenticates identically to the app's own calls. Used only to SET UP git
// state (dirty / read / clean); the pill + dialog + commit are driven through
// the real UI. See change: add-session-uncommitted-indicator-and-commit.

interface GitStatusShape {
  dirtyCount: number; staged: number; unstaged: number;
  untracked: number; ahead: number; behind: number;
}

// The dashboard's REST envelope is `{ success, data?, error? }` (ApiResponse),
// carried inside a wrapper with the HTTP status so callers can distinguish an
// auth/guard rejection from a legit `success:false`.
async function apiJson<T>(
  page: Page,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; success?: boolean; data?: T; error?: string }> {
  return page.evaluate(
    async ([p, i]) => {
      const res = await fetch(p as string, (i as RequestInit) ?? undefined);
      let body: Record<string, unknown> = {};
      try { body = await res.json(); } catch { /* non-JSON */ }
      return { status: res.status, ...body };
    },
    [path, init] as const,
  );
}

/** GET /api/git/status?cwd= — fresh working-tree counts (null on failure). */
export async function readGitStatus(page: Page, cwd: string): Promise<GitStatusShape | null> {
  const json = await apiJson<GitStatusShape>(page, `/api/git/status?cwd=${encodeURIComponent(cwd)}`);
  return json.success && json.data ? json.data : null;
}

/** GET /api/git/changed-files?cwd= — the picker's file list. */
export async function readChangedFiles(page: Page, cwd: string): Promise<Array<{ path: string; state: string }>> {
  const json = await apiJson<Array<{ path: string; state: string }>>(
    page, `/api/git/changed-files?cwd=${encodeURIComponent(cwd)}`);
  return json.success && json.data ? json.data : [];
}

/**
 * Dirty a tracked markdown file by appending `marker`. Reads the current
 * content + mtime (`/api/file/md-read`), then writes back with the append
 * (`/api/file/write`) — the endpoint's optimistic-concurrency contract.
 * Only markdown targets in scope are writable, so the sample-git fixture
 * exposes `README.md` + `notes.md`.
 */
export async function dirtyMarkdown(page: Page, cwd: string, relPath: string, marker: string): Promise<void> {
  const read = await apiJson<{ content: string; mtime: number }>(
    page, `/api/file/md-read?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(relPath)}`);
  if (!read.success || !read.data) {
    throw new Error(`md-read failed for ${relPath} (HTTP ${read.status}): ${read.error ?? "unknown"}`);
  }
  const body = JSON.stringify({ cwd, path: relPath, content: `${read.data.content}\n${marker}\n`, mtime: read.data.mtime });
  const write = await apiJson(page, "/api/file/write", {
    method: "POST", headers: { "Content-Type": "application/json" }, body,
  });
  if (!write.success) {
    throw new Error(`md-write failed for ${relPath} (HTTP ${write.status}): ${write.error ?? "unknown"}`);
  }
}

/**
 * Commit every currently-changed file so the tree returns to CLEAN — spec
 * isolation (specs share one container + fixture repo). No-op when clean.
 */
export async function cleanupCommit(page: Page, cwd: string): Promise<void> {
  const files = await readChangedFiles(page, cwd);
  if (files.length === 0) return;
  await apiJson(page, "/api/git/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, message: "test cleanup", files: files.map((f) => f.path) }),
  });
}

// ── folder-header git identity (fix-folder-header-worktree-branch-leak) ─────
//
// `GroupGitInfo` renders in the folder card's expanded BODY, a sibling of the
// `folder-home-row-<cwd>` name row — so it must be scoped to the CARD, and the
// folder must be expanded first or the whole subtree is simply absent.

/** The folder card owning `cwd` (scopes the non-cwd-keyed collapse chevron). */
export function folderCard(page: Page, cwd: string): Locator {
  return page
    .locator('[data-testid="sortable-workspace-folder"], [data-testid="sortable-pinned-group"]')
    .filter({ has: page.getByTestId(`folder-home-row-${cwd}`) })
    .first();
}

/**
 * Expand `cwd`'s folder card. Idempotent, and safe against hydration: an
 * un-hydrated sidebar has no `folder-body-<cwd>` either, so a bare
 * "absent ⇒ collapsed ⇒ click" would COLLAPSE an already-expanded folder and
 * then wait forever. Retries instead of trusting one reading.
 */
export async function expandFolder(page: Page, cwd: string): Promise<void> {
  const card = folderCard(page, cwd);
  await card.waitFor({ state: "visible", timeout: 30_000 });
  const expanded = async () => (await page.getByTestId(`folder-body-${cwd}`).count()) > 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await expanded()) return;
    await card.getByTestId("folder-toggle-btn").first().click();
    const ok = await expect
      .poll(expanded, { timeout: 5_000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  throw new Error(`folder ${cwd} never expanded`);
}

/**
 * Branch text as the user reads it in `cwd`'s folder header, or `""` when the
 * header renders no branch at all (dimmed icon / not yet resolved).
 */
export async function folderHeaderBranch(page: Page, cwd: string): Promise<string> {
  const btn = folderCard(page, cwd).getByTestId("git-branch-btn");
  if ((await btn.count()) === 0) return "";
  // The branch label is the button's IMMEDIATE sibling (`<span>` plain, or an
  // `<a>` when a branch URL is present). Reading the whole container instead
  // would fold in the dirty pill and the Commit action.
  return btn
    .first()
    .evaluate((el) => (el.nextElementSibling?.textContent ?? "").trim())
    .catch(() => "");
}
