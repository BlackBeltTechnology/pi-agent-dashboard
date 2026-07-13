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
  onboardingStep2Cta: "onboarding-step-2-cta", // "Add folder" → opens pin dialog
  onboardingStep3Cta: "onboarding-step-3-cta", // "Start session" → spawns
  pinDirectoryDialog: "pin-directory-dialog",
  // Accumulated-state path: once a folder/session exists the LandingPage
  // onboarding view is gone and the sidebar exposes these instead. The
  // ensureGitSession() helper falls back to them when the onboarding CTAs
  // are absent (specs share one container, so state persists across specs).
  dashboardAddFolderBtn: "dashboard-add-folder-btn", // sidebar "Add Folder"
  folderSpawnSessionBtn: "folder-spawn-session-btn", // sidebar "New Session"
  // Composer send button (faux round-trip specs drive a prompt through it).
  sendButton: "send-button",
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

export function byTestId(page: Page, key: keyof typeof TESTIDS): Locator {
  return page.getByTestId(TESTIDS[key]);
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
 * Open the pin-directory dialog, type an absolute path, confirm.
 * Uses whichever "add folder" affordance the current state exposes:
 * the onboarding step-2 CTA (fresh container) or the sidebar button
 * (a folder/session already exists). Requires PI_E2E_SEED=1 so the
 * onboarding gate is cleared and the directory-listing endpoint is reachable.
 */
export async function pinDirectory(page: Page, absPath: string): Promise<void> {
  const onboardingCta = byTestId(page, "onboardingStep2Cta");
  if (await visible(onboardingCta)) {
    await onboardingCta.click();
  } else {
    await byTestId(page, "dashboardAddFolderBtn").first().click();
  }
  const dialog = byTestId(page, "pinDirectoryDialog");
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("textbox").fill(absPath);
  // PathPicker confirm needs the target listed under its parent dir. Escape
  // regex metacharacters so a dir name like `a.b` matches literally.
  const leaf = (absPath.split("/").filter(Boolean).pop() ?? "").replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  await dialog.getByRole("option", { name: new RegExp(leaf) }).waitFor({ state: "visible" });
  await dialog.getByRole("button", { name: /^select$/i }).click();
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
