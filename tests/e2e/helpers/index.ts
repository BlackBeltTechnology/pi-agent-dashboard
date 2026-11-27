import { expect, type Locator, type Page } from "@playwright/test";

export { type FrameInjector, forceConcurrentInitStack, installFrameInjector, stubActiveInits } from "./init-banner.js";

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
  // Step ① "Skip for now" (change: fix-provider-catalogue-first-run).
  onboardingStep1Skip: "onboarding-step-1-skip",
  onboardingStep1Skipped: "onboarding-step-1-skipped",
  onboardingStep2Cta: "onboarding-step-2-cta", // "Use an existing folder…" → opens AddFoldersDialog
  // Step ② inline create form. See change: streamline-first-run.
  onboardingStep2Create: "onboarding-step-2-create", // primary "Create project"
  onboardingStep2Name: "onboarding-step-2-name",
  onboardingStep2Error: "onboarding-step-2-error",
  onboardingStep2Done: "onboarding-step-2-done",
  onboardingStep3Cta: "onboarding-step-3-cta", // "Start session" → spawns
  // The "Add folder" CTAs open the multi-select AddFoldersDialog. The former
  // single-path PinDirectoryDialog (`pin-directory-dialog`) still EXISTS and
  // still renders that testid, but is only reachable from Settings ▸ Packages
  // — no longer from these affordances. The map kept pointing at it, so every
  // spec that pins a folder hung until its 180 s cap.
  // The flow differs too: file-manager gestures (click selects, double-click
  // opens) and a commit button that pins the selection, else the browsed folder.
  // See changes: project-scope-disable-global-resources (helper drift fix),
  // simplify-add-folder-picker.
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
  // Session-header "Reload transcript" title-menu item (SessionTitleMenu.tsx).
  // Drives the durable replay-cache purge the reset-path specs assert against.
  // It only exists while the title menu is open — use `reloadTranscript(page)`.
  // See changes: purge-replay-cache-on-reset-paths, reorganize-session-header.
  refreshChat: "refresh-chat",
  // Session title button: opens the menu (Rename, Reveal, Edit tags, Reload).
  sessionTitleMenu: "session-title-menu",
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
  // Held-steer bubbles (bridge-owned, cancellable until hand-off): the card
  // wrapper, its bubble, the image-count badge and the bulk clear.
  // Per-entry cancel is `pending-steer-cancel-<id>`. See change: bridge-owned-cancellable-steer.
  pendingSteerCard: "pending-steer-card",
  pendingSteerAttachments: "pending-steer-attachments",
  pendingSteerClearAll: "pending-steer-clear-all",
  // VCS panels (scenario backlog).
  composerGitGroup: "composer-git-group",
  composerStatusGroup: "composer-status-group",
  // Group containers (ToolbarGroup, role="group") around the content nodes
  // above, the composer card rows and the PR status segment.
  // See change: redesign-composer-session-strip.
  composerOpenspecContainer: "composer-openspec-container",
  composerGitContainer: "composer-git-container",
  composerStatusContainer: "composer-status-container",
  composerInputRow: "composer-input-row",
  composerSettingsRow: "composer-settings-row",
  worktreePrSegment: "worktree-pr-segment",
  gitInitBtn: "git-init-btn",
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
  // Terminal (scenario 5.4). open-inline-terminal-button is an item of the
  // composer's `＋` menu (attach-menu) — reach it via `openInlineTerminalFromAddMenu`;
  // terminal-card mounts in the chat stream. See change: add-composer-dock.
  terminalCard: "terminal-card",
  openInlineTerminalButton: "open-inline-terminal-button",
  attachButton: "attach-button",
  attachMenu: "attach-menu",
  // Top-level / folder route containers (scenario 5.6 navigation).
  settingsContent: "settings-content",
  openspecBoard: "openspec-board",
  archiveBrowser: "archive-browser",
  specsBrowser: "specs-browser",
} as const;

/**
 * Open the composer `＋` menu and choose "Open inline terminal". The terminal
 * chip left the toolbar row (and the `⋯` overflow is gone), so the menu item is
 * the only entry point at every width. See change: add-composer-dock.
 */
export async function openInlineTerminalFromAddMenu(page: Page): Promise<void> {
  await byTestId(page, "attachButton").first().click();
  const menu = byTestId(page, "attachMenu");
  await menu.waitFor({ state: "visible", timeout: 10_000 });
  await byTestId(menu, "openInlineTerminalButton").click();
}

/**
 * Expand the composer dock's Queue lane. Queued follow-ups render in the lane's
 * body (`queue-panel` / `queue-chip-followup`), which mounts only while the lane
 * is open — the lane itself shows collapsed (`N queued follow-ups`). Works in rows
 * and compact layout (the chip carries the same `data-dock-toggle`). Idempotent.
 * See change: add-composer-dock.
 */
export async function expandQueueLane(page: Page): Promise<void> {
  const toggle = page.locator('[data-dock-toggle="queue"]').first();
  await toggle.waitFor({ state: "visible", timeout: 15_000 });
  // A mid-turn lane arrives while the transcript is still streaming and the stack settles: a click can
  // land on whatever shifted under the pointer. Retry until the lane really reports expanded.
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click({ timeout: 2_000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/**
 * Reload the transcript from the session header: open the title menu, then
 * activate "Reload transcript" (`refresh-chat`). The header ⟳ button is gone.
 * See change: reorganize-session-header.
 */
export async function reloadTranscript(page: Page): Promise<void> {
  await byTestId(page, "sessionTitleMenu").click();
  await byTestId(page, "refreshChat").click();
}

/**
 * Rename the open session through the header title menu (the ✎ button and
 * double-click are gone). See change: reorganize-session-header.
 */
export async function renameSessionViaTitleMenu(page: Page, name: string): Promise<void> {
  await byTestId(page, "sessionTitleMenu").click();
  await page.getByRole("menuitem", { name: /^Rename/ }).click();
  const input = page.getByTestId("session-header").locator("input").first();
  await input.fill(name);
  await input.press("Enter");
  await expect(byTestId(page, "sessionTitleMenu")).toHaveAttribute("title", name, { timeout: 15_000 });
}

export function byTestId(scope: Page | Locator, key: keyof typeof TESTIDS): Locator {
  // Accepts a Locator as well as a Page so a lookup can be scoped to a dialog
  // or card; both expose the same `getByTestId`.
  return scope.getByTestId(TESTIDS[key]);
}

/**
 * Dismiss the harness's recurring spawn toasts.
 *
 * A spawn raises a dismissible toast pinned over the editor/tab strip, so a
 * `locator.click()` on a control underneath never becomes "stable" and the
 * action times out with no useful cause. ~8 specs grew their own copy of this
 * workaround; it lives here now. See change: stabilize-browser-e2e (4.2).
 */
export async function dismissToasts(page: Page): Promise<void> {
  for (const btn of await page.getByRole("button", { name: "Dismiss" }).all()) {
    await btn.click().catch(() => {});
  }
}

/**
 * Click a testid, dismissing overlapping toasts and retrying until it lands.
 * Prefer this over a bare `click()` for any control that can sit under a toast.
 */
export async function robustClick(page: Page, testid: string): Promise<void> {
  const target = page.getByTestId(testid);
  await expect(async () => {
    await dismissToasts(page);
    await target.click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * Launch a new pane tab from the pane bar's `+` menu: open the menu, then click
 * the item (`new-terminal-launch`, `live-preview-launch`, `open-file-launch`).
 * The launchers moved off the header into this menu; the item ids are unchanged.
 * See change: scope-anchor-editor-pane-controls (D9, D12).
 */
export async function launchFromNewTabMenu(
  page: Page,
  item: "new-terminal-launch" | "live-preview-launch" | "open-file-launch",
): Promise<void> {
  await expect(async () => {
    await dismissToasts(page);
    if ((await page.getByTestId("new-tab-menu-toggle").getAttribute("aria-expanded")) !== "true") {
      await page.getByTestId("new-tab-menu-toggle").click({ timeout: 2_000 });
    }
    await page.getByTestId(item).click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * Pick an editor layout mode at any width. The wide header renders the 3-segment
 * radiogroup (`layout-mode-<mode>` visible directly); below the mobile breakpoint
 * it renders a menu whose trigger is `layout-mode-switch` and whose
 * `menuitemradio` items carry the same `layout-mode-<mode>` ids. Opens the menu
 * when the item is not visible, clicks the item, then (menu form) waits for the
 * menu to close so the next step never races it.
 * See changes: reorganize-session-header, add-composer-dock.
 */
export async function chooseLayoutMode(page: Page, mode: "closed" | "split" | "full"): Promise<void> {
  const item = page.getByTestId(`layout-mode-${mode}`);
  const trigger = page.getByTestId("layout-mode-switch");
  // A viewport change re-renders the header between the segmented and the menu form (and a menu
  // closes when it does), so decide from the live DOM on every attempt and retry the whole step.
  await expect(async () => {
    if (!(await item.isVisible())) {
      expect(await trigger.getAttribute("aria-haspopup"), "layout switch is the menu form").toBe("menu");
      if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click({ timeout: 2_000 });
      await expect(item).toBeVisible({ timeout: 2_000 });
    }
    await item.click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  // Menu form: the choice closes the menu; wait for it so the next step never races it.
  if ((await trigger.getAttribute("aria-haspopup")) === "menu") {
    await expect(trigger).toHaveAttribute("aria-expanded", "false", { timeout: 5_000 });
  }
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
export async function armFirstLaunchDismiss(page: Page): Promise<void> {
  if (firstLaunchHandled.has(page)) return;
  firstLaunchHandled.add(page);
  const backdrop = page.getByTestId("first-launch-display-backdrop");
  await page.addLocatorHandler(backdrop, async () => {
    await backdrop.getByRole("button", { name: /^skip$/i }).click();
  });
}

/** `url` may be absolute to reach the harness through another origin (e.g. `http://127.0.0.2:<port>/`). */
export async function gotoDashboard(page: Page, url = "/"): Promise<void> {
  await armFirstLaunchDismiss(page);
  await page.goto(url);
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
 * offers no pin control. Pointer-independent (works on touch projects too):
 * type the full path WITH a trailing separator so the picker browses INTO the
 * folder, assert the status line names exactly that folder, then commit with
 * nothing selected — the dialog commits the browsed folder.
 * See change: simplify-add-folder-picker (test-plan E15/E16).
 */
export async function pinDirectory(page: Page, absPath: string): Promise<void> {
  const onboardingCta = byTestId(page, "onboardingStep2Cta");
  if (await visible(onboardingCta)) {
    // The onboarding→dashboard hydration flip can detach the CTA mid-click;
    // bound the attempt and fall back to the dashboard-mode affordance.
    await onboardingCta
      .click({ timeout: 5_000 })
      .catch(async () => {
        await byTestId(page, "dashboardAddFolderBtn").first().click();
      });
  } else {
    await byTestId(page, "dashboardAddFolderBtn").first().click();
  }
  const dialog = byTestId(page, "addFoldersDialog");
  await dialog.waitFor({ state: "visible" });
  // `.first()` — the dialog grows a second textbox in new-folder mode.
  const textbox = dialog.getByRole("textbox").first();
  // The picker re-lists its initial directory on mount, and that late response
  // can land AFTER an immediate fill and clobber it. Let the first listing
  // render, then fill, then assert the value actually STUCK (auto-retrying).
  // Wait on the status line, not a row: an empty browse root (no `..`, no
  // children) renders zero options. See change: simplify-add-folder-picker.
  await expect(
    dialog.getByTestId("add-folders-status-path").or(dialog.getByTestId("add-folders-status-home")),
  ).toBeVisible({ timeout: 20_000 });
  const sep = absPath.includes("\\") && !absPath.includes("/") ? "\\" : "/";
  const browsed = absPath.replace(/[\\/]+$/, "");
  await textbox.fill(browsed + sep);
  await expect(textbox).toHaveValue(browsed + sep);
  // No row click: a tap on touch would OPEN the row. The status line proves
  // the browse landed on the requested folder, not its parent or a child.
  await expect(dialog.getByTestId("add-folders-status-path")).toHaveText(browsed, { timeout: 20_000 });
  const commit = byTestId(dialog, "addFoldersCommit");
  await expect(commit).toBeEnabled();
  await commit.click();
  await dialog.waitFor({ state: "hidden" });
}

/**
 * The sidebar folder-GROUP body (Create tray + session cards) for an absolute
 * cwd. Its testid is dynamic, so it cannot live in TESTIDS.
 *
 * Scoping to the group is load-bearing: the sidebar renders a Create tray for
 * EVERY folder group, and PI_E2E_SEED seeds 125 ended sessions in
 * `/fixtures/seed-win-*` (scripts/seed-sessions-window.mjs), so a global
 * `.first()` picks an arbitrary seed dir. Those cwds do not exist on disk, so
 * the spawn 500s ("Directory does not exist") and no card ever appears.
 * See change: stabilize-browser-e2e (baseline triage 4.2).
 */
function folderGroupBody(page: Page, cwd: string): Locator {
  return page.getByTestId(`folder-body-${cwd}`);
}

/**
 * Ensure the baked git fixture is in the sidebar and return its group body.
 *
 * Pins it only when absent: re-opening the add-folders dialog for an
 * already-pinned folder is not a supported flow (the dialog lists unpinned
 * paths). Waits for the sidebar to render SOME group first so a still-hydrating
 * snapshot is not misread as "not pinned".
 */
export async function ensureFixtureGitGroup(page: Page): Promise<Locator> {
  const body = folderGroupBody(page, FIXTURE_GIT);
  await page
    .locator('[data-testid^="folder-body-"]')
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => {});
  if (await visible(body)) return body;
  await pinDirectory(page, FIXTURE_GIT);
  await body.waitFor({ state: "visible", timeout: 30_000 });
  return body;
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

  const fixGitBody = await ensureFixtureGitGroup(page);

  const spawnCta = byTestId(page, "onboardingStep3Cta");
  if (await visible(spawnCta)) {
    await spawnCta.click();
  } else {
    await fixGitBody.getByTestId(TESTIDS.folderSpawnSessionBtn).click();
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

  const existing = new Set(
    (
      (await page
        .locator(cardsSel)
        .evaluateAll((els) =>
          els.map((e) => e.getAttribute("data-session-id")),
        )) as (string | null)[]
    ).filter((id): id is string => Boolean(id)),
  );

  // Spawn from the FIXTURE_GIT group and ONLY that group (see
  // folderGroupBody). This replaces the old `hasSessions || spawnBtn visible`
  // branch, which read a seed dir's Create tray as "a folder is pinned" and
  // clicked it — a 500 with no card, so the spec died at the poll below.
  const fixGitBody = await ensureFixtureGitGroup(page);
  await fixGitBody.getByTestId(TESTIDS.folderSpawnSessionBtn).click();

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

/**
 * Assert every interactive control inside `selector` meets the repo's 44×44px
 * mobile hit-area floor. A checkbox's hit area is its wrapping `<label>` when
 * one exists — the client wraps every bare checkbox for exactly this reason —
 * and a zero-size control (collapsed/hidden group) is skipped.
 * See change: extract-mcp-client-plugin (tasks 7.7, 8.4).
 */
export async function assertHitAreas(page: Page, selector: string, min = 44): Promise<void> {
  const undersized = await page.evaluate(
    ({ sel, floor }) => {
      const root = document.querySelector(sel);
      if (!root) return [`${sel}: not found`];

      function hitTarget(control: Element): Element {
        if ((control as HTMLInputElement).type !== "checkbox") return control;
        return control.closest("label") ?? control;
      }
      function nameOf(el: Element): string {
        const testid = el.getAttribute("data-testid");
        if (testid) return testid;
        const aria = el.getAttribute("aria-label");
        if (aria) return aria;
        return el.tagName.toLowerCase();
      }

      const out: string[] = [];
      const controls = root.querySelectorAll("button, [role='switch'], input, select, textarea");
      for (const control of Array.from(controls)) {
        const target = hitTarget(control);
        const rect = target.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.width >= floor && rect.height >= floor) continue;
        out.push(`${nameOf(target)}: ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
      return out;
    },
    { sel: selector, floor: min },
  );
  expect(undersized, `controls below the ${min}×${min} hit-area floor in ${selector}`).toEqual([]);
}

// ── Providers settings fixtures (change: redesign-providers-settings-page) ──

/**
 * Structural stand-in for a `GET /api/provider-auth/status` row — the fields
 * the redesigned section and its Add-provider dialog read. Only the fields a
 * scenario needs need to be set; the rest default to an unconfigured OAuth
 * row (the harness-fresh state for every registry provider).
 */
export interface ProviderStatusFixture {
  id: string;
  name: string;
  flowType: "auth_code" | "device_code" | "api_key";
  authenticated: boolean;
  configured?: boolean;
  maskedKey?: string;
  envVar?: string;
  ambient?: boolean;
  expires?: number;
}

export function providerStatusRow(patch: Partial<ProviderStatusFixture> & { id: string }): ProviderStatusFixture {
  return {
    name: patch.id,
    flowType: "auth_code",
    authenticated: false,
    ...patch,
  };
}

/** A custom-endpoint entry as `GET /api/providers` carries it (redacted read). */
export interface CustomEndpointFixture {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  apiKeyResolved?: boolean;
}

export interface RoutedProviderData {
  /** Replace the array subsequent `GET /api/provider-auth/status` calls serve. */
  serveStatuses(rows: ProviderStatusFixture[]): void;
  /** Replace the `{ providers, health }` map subsequent `GET /api/providers` calls serve. */
  serveProviders(map: Record<string, CustomEndpointFixture>, health?: Record<string, unknown>): void;
}

/**
 * Fixture the redesigned providers section's three reads. The rows are what
 * the REAL server would emit for the scenario's state (auth rows from the
 * handler registry, api-key rows from a bridge-pushed catalogue); the section,
 * the Add-provider dialog and the Settings shell all run for real on top.
 * Armed routes serve the CURRENT payload on every call, so a scenario can
 * flip server state mid-test with `serveStatuses` / `serveProviders` — the
 * same trick the real server exhibits when a credential lands in auth.json.
 */
export function routeProviderData(
  page: Page,
  opts: {
    statuses?: ProviderStatusFixture[];
    providers?: Record<string, CustomEndpointFixture>;
    health?: Record<string, unknown>;
    /** `GET /api/provider-auth/catalogue-ready` → `{ ready }`. Default true. */
    catalogueReady?: boolean;
  },
): RoutedProviderData {
  let statuses = opts.statuses ?? [];
  let providers = opts.providers ?? {};
  let health = opts.health ?? {};
  void page.route("**/api/provider-auth/status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(statuses) }),
  );
  void page.route("**/api/providers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, providers, health }),
    }),
  );
  void page.route("**/api/provider-auth/catalogue-ready", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ready: opts.catalogueReady ?? true }) }),
  );
  return {
    serveStatuses(rows) {
      statuses = rows;
    },
    serveProviders(map, nextHealth) {
      providers = map;
      if (nextHealth) health = nextHealth;
    },
  };
}

/** Open Settings ▸ Providers and wait until the redesigned section is mounted. */
export async function openProvidersSettings(page: Page): Promise<void> {
  await gotoDashboard(page);
  await page.goto("/settings/providers");
  await page.getByTestId("settings-nav-rail").waitFor({ state: "visible", timeout: 20_000 });
  await page
    .getByTestId("add-provider-button")
    .waitFor({ state: "visible", timeout: 20_000 });
}

/**
 * Open the Add-provider picker and return its dialog panel.
 *
 * The picker renders through `DialogPortal`, so the `provider-add-dialog`
 * wrapper is an EMPTY node — content must be scoped to the portal panel
 * (`role=dialog`) instead, filtered by the picker's unique search placeholder
 * to distinguish it from the Settings overlay's own dialog.
 */
export async function openAddPicker(page: Page): Promise<Locator> {
  await page.getByTestId("add-provider-button").click();
  const root = page
    .getByRole("dialog")
    .filter({ has: page.getByPlaceholder("Search providers…") });
  await root.waitFor({ state: "visible", timeout: 15_000 });
  return root;
}


export { connectionChip, openAppearance, openConnectionMenu, setSearch } from "./header.js";
