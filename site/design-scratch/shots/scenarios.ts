/**
 * Feature-driven screenshot scenarios.
 *
 * The unit here is a FEATURE from docs/user-features.md — not a URL. Each shot
 * names the doc section and the specific bullet it illustrates, so the feature
 * list and the screenshot set can be diffed for coverage.
 *
 * Contract for `run()`:
 *   - return a Locator  → that element is the clip region (and its presence is
 *     the proof the feature is actually on screen)
 *   - return null       → capture the whole viewport
 *   - throw / time out  → the shot is recorded MISSING and NO png is written
 *
 * That last line is the whole point. The pipeline this replaces caught its
 * errors and screenshotted whatever happened to be on screen, which is how six
 * copies of the home page ended up committed under six different feature names.
 */

import type { Locator, Page } from "@playwright/test";

/** Per-step budget. A shot that cannot reach its feature should fail FAST —
 * MISSING is a normal, expected outcome, not an exception path. */
export const T = 8_000;

export type ViewportId = "desktop" | "mobile";

export interface Shot {
  /** Output filename stem. */
  id: string;
  /** Exact `##` heading from docs/user-features.md. */
  section: string;
  /** The bullet this shot is evidence for. */
  bullet: string;
  viewports: ViewportId[];
  /** Reach the feature. Return the clip target, or null for the full viewport. */
  run: (page: Page, ctx: Ctx) => Promise<Locator | null>;
}

export interface Ctx {
  /** Absolute path of the seeded git fixture inside the container. */
  fixtureGit: string;
  /** Absolute path of the seeded openspec board fixture. */
  fixtureBoard: string;
  /** Build a /folder/<b64url>/<sub> route. */
  folderRoute: (cwd: string, sub: string) => string;
  /** Dirty a tracked file in the git fixture so VCS affordances appear. */
  dirty: (page: Page, relPath: string) => Promise<void>;
}

/**
 * Settle: shell mounted, /ws burst drained, ended-session disclosure expanded.
 *
 * The corpus is ENDED sessions, which every folder collapses behind a
 * "› N ended" toggle. Without expanding it the session list screenshots as an
 * empty folder card — which is why the first corpus run still looked hollow
 * despite 8 real sessions being present.
 */
async function shell(page: Page, ctx?: Ctx): Promise<void> {
  await page.getByTestId("header-app-bar").waitFor({ state: "visible", timeout: T });
  await page.waitForTimeout(400);
  if (ctx) {
    await page.getByTestId(`folder-ended-toggle-${ctx.fixtureGit}`)
      .click({ timeout: 3_000 }).catch(() => { /* already expanded */ });
    await page.waitForTimeout(500);
  }
}

/**
 * Detect the silent no-such-route fallback.
 *
 * An unknown `/folder/<cwd>/<sub>` route does NOT 404 — the shell renders its
 * empty-state pane ("Pick a session on the left to continue") while the URL
 * keeps the bogus path. Navigate-and-shoot therefore produces a perfectly
 * valid screenshot of the WRONG screen.
 *
 * NOTE — an earlier version of this guard keyed on
 * `[data-testid^="folder-home-row-"]` being visible, on the theory that a dead
 * route falls back to the folder home. That was wrong twice over: the real
 * fallback is the empty-state pane, and `folder-home-row-*` is rendered by the
 * PERSISTENT LEFT SIDEBAR, so it is visible on literally every page. The guard
 * fired on healthy surfaces (editor, automations, goals, kb, pi-resources) and
 * manufactured 7 false MISSINGs.
 */
async function refuseDeadRoute(page: Page, url: string): Promise<void> {
  const empty = page.getByText(/Pick a session on the left/i).first();
  if (await empty.isVisible().catch(() => false)) {
    throw new Error(
      `route resolved to the shell empty state (${url}) — no such route, ` +
      `or the contributing plugin is absent`);
  }
}

/** Open a route and wait for a testid that proves the surface rendered. */
async function surface(page: Page, url: string, testid: string): Promise<Locator> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const el = page.getByTestId(testid);
  await el.waitFor({ state: "visible", timeout: T }).catch(async () => {
    await refuseDeadRoute(page, url);
    throw new Error(`testid "${testid}" never appeared at ${url}`);
  });
  await page.waitForTimeout(600);
  return el;
}

/**
 * Open a route and prove it rendered by its own visible heading text.
 *
 * Used for surfaces that carry no root testid. Weaker than a testid but still
 * a real proof that the RIGHT screen is on screen — which is the property the
 * old route-only pipeline lacked. Never add an app testid just for capture.
 */
async function surfaceByText(page: Page, url: string, re: RegExp): Promise<null> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await refuseDeadRoute(page, url);
  // The regex MUST match text unique to the surface. The sidebar folder card
  // renders the words AUTOMATIONS / GOALS / KNOWLEDGE BASE / OPENSPEC, so a
  // loose /automation/i would "prove" a surface that never opened — which is
  // how four shots passed against the sidebar in an earlier run.
  await page.getByText(re).first().waitFor({ state: "visible", timeout: T });
  await page.waitForTimeout(600);
  return null;
}

export const SHOTS: Shot[] = [
  // ── Monitor & control your agents ─────────────────────────────────────
  {
    id: "sessions",
    section: "Monitor & control your agents",
    bullet: "See every running pi session live in the browser",
    viewports: ["desktop"],
    async run(page, ctx) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await shell(page, ctx);
      await page.getByTestId("session-card-desktop").first()
        .waitFor({ state: "visible", timeout: T });
      return null;
    },
  },
  {
    // `session-card-desktop` is the ONLY session-card testid in the client —
    // the mobile layout renders a different tree, so the desktop anchor cannot
    // be reused. Anchor on the shell instead.
    id: "session-list",
    section: "Monitor & control your agents",
    bullet: "Needs-you rollup — which sessions are waiting on your answer",
    viewports: ["mobile"],
    async run(page, ctx) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await shell(page, ctx);
      return null;
    },
  },
  {
    id: "session-search",
    section: "Monitor & control your agents",
    bullet: "Rename sessions, tags, hide/show cards, search & filter",
    viewports: ["desktop"],
    async run(page, ctx) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await shell(page, ctx);
      const input = page.getByTestId("session-search-input");
      await input.waitFor({ state: "visible", timeout: T });
      await input.fill("electron");
      await page.waitForTimeout(800);
      return null;
    },
  },

  // ── Chat experience ───────────────────────────────────────────────────
  {
    id: "chat",
    section: "Chat experience",
    bullet: "Full markdown, grouped tool calls, per-turn change summary",
    viewports: ["desktop"],
    async run(page, ctx) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await shell(page, ctx);
      await page.getByTestId("session-card-desktop").first().click();
      const scroller = page.getByTestId("chat-scroll-container");
      await scroller.waitFor({ state: "visible", timeout: T });
      await page.waitForTimeout(1500);
      return null;
    },
  },
  {
    id: "composer",
    section: "Chat experience",
    bullet: "Slash-command autocomplete, @file autocomplete, drafts",
    viewports: ["desktop"],
    async run(page, ctx) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await shell(page, ctx);
      await page.getByTestId("session-card-desktop").first().click();
      await page.getByTestId("send-button").waitFor({ state: "visible", timeout: T });
      return null;
    },
  },
  {
    id: "inline-terminal",
    section: "Chat experience",
    bullet: "`!`/`!!` shell commands, inline terminal",
    viewports: ["desktop"],
    async run(page, ctx) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await shell(page, ctx);
      await page.getByTestId("session-card-desktop").first().click();
      await page.getByTestId("open-inline-terminal-button").click({ timeout: T });
      // `.first()` — a terminal opened by an earlier shot persists server-side,
      // so a bare getByTestId hits strict-mode with 2 cards on the second pass.
      const card = page.getByTestId("terminal-card").first();
      await card.waitFor({ state: "visible", timeout: T });
      await page.waitForTimeout(800);
      return null;
    },
  },

  // ── Workspace ─────────────────────────────────────────────────────────
  {
    id: "workspace-folders",
    section: "Workspace",
    bullet: "Group sessions by project folder; pin folders, build workspaces",
    viewports: ["desktop"],
    async run(page, ctx) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await shell(page, ctx);
      const folder = page.getByTestId(`folder-header-cluster-${ctx.fixtureGit}`);
      await folder.waitFor({ state: "visible", timeout: T });
      return null;
    },
  },
  {
    id: "mobile-drawer",
    section: "Workspace",
    bullet: "Mobile-friendly: swipe drawer, touch targets, install as a PWA",
    viewports: ["mobile"],
    async run(page, ctx) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await shell(page, ctx);
      return null;
    },
  },

  // ── Built-in editor, files, terminal ──────────────────────────────────
  {
    id: "editor",
    section: "Built-in editor, files, terminal",
    bullet: "Monaco code editor inside the dashboard, side-by-side with chat",
    viewports: ["desktop"],
    async run(page, ctx) {
      // NOTE: there is no `data-testid="editor"` in the app — that id exists
      // only in components/__tests__/SplitWorkspace.test.tsx as a stub. The
      // editor pane's real anchor is the file-tree toggle.
      await page.goto(ctx.folderRoute(ctx.fixtureGit, "editor"),
        { waitUntil: "domcontentloaded" });
      await page.getByTestId("tree-toggle").first()
        .waitFor({ state: "visible", timeout: T });
      // The editor opens on "No files open — pick one from the tree", i.e. an
      // empty pane. Open a real source file so the shot shows the tree
      // selection, the tab bar and syntax highlighting.
      await page.getByText("src", { exact: true }).first()
        .click({ timeout: T }).catch(() => { /* already expanded */ });
      await page.waitForTimeout(500);
      await page.getByText("session-store.ts", { exact: true }).first()
        .click({ timeout: T }).catch(() => { /* fall back to the empty pane */ });
      await page.waitForTimeout(1800);
      return null;
    },
  },
  {
    id: "terminal",
    section: "Built-in editor, files, terminal",
    bullet: "Real terminal per folder (xterm.js), as a tab next to the editor",
    viewports: ["desktop"],
    async run(page, ctx) {
      // There is NO /terminals route — App.tsx wires onOpenTerminals to
      // /editor. A terminal is a PANE inside the editor, not a page.
      // TerminalPaneLayer carries no testid either, so anchor on the xterm
      // canvas the pane mounts.
      const url = ctx.folderRoute(ctx.fixtureGit, "editor");
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.getByTestId("tree-toggle").first()
        .waitFor({ state: "visible", timeout: T });
      // Terminals live SERVER-SIDE and survive both the page and the browser
      // context, so the dark pass and the light pass share the same shells.
      // Reuse one only if it is sitting at a clean prompt; a terminal another
      // pass left inside a pager never shows one again.
      const atPrompt = () => page.waitForFunction(
        () => /\/fixtures\/sample-git\s*#/.test(document.body.innerText),
        undefined, { timeout: 3_000 }).then(() => true).catch(() => false);

      if (await page.locator(".xterm").count() === 0 || !(await atPrompt())) {
        await page.getByTestId("new-terminal-launch").click({ timeout: T });
        // `.xterm` mounts for EVERY open terminal, including ones hidden
        // behind another tab, so `.first()` can resolve to a pane that never
        // becomes visible. Only the ACTIVE pane paints a prompt.
        await page.locator(".xterm").last().waitFor({ state: "attached", timeout: T });
        await page.waitForFunction(
          () => /\/fixtures\/sample-git\s*#/.test(document.body.innerText),
          undefined, { timeout: T });
      }

      // A bare prompt screenshots as an empty black rectangle. Click the pane
      // FIRST — xterm only takes keystrokes once its textarea has focus,
      // otherwise the typing silently goes to the document.
      await page.locator(".xterm-screen").last().click({ timeout: T })
        .catch(() => { /* not clickable; typing may still land */ });
      // --no-pager matters: plain `git log` opens less, and the pager both
      // hides the prompt and swallows the rest of the command line, wedging
      // the shell for the NEXT pass.
      await page.keyboard.type("git --no-pager log --oneline -5 && ls src");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2500);
      return null;
    },
  },

  // ── Git & worktrees ───────────────────────────────────────────────────
  {
    id: "git-branch",
    section: "Git & worktrees",
    bullet: "Branch shown per folder; switch branches from the UI",
    viewports: ["desktop"],
    async run(page, ctx) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await shell(page, ctx);
      const btn = page.getByTestId("git-branch-btn").first();
      await btn.waitFor({ state: "visible", timeout: T });
      return null;
    },
  },
  {
    id: "diff-commit",
    section: "Git & worktrees",
    bullet: "Review the diff and commit selected files from the card",
    viewports: ["desktop"],
    async run(page, ctx) {
      // seed.sh already leaves the fixture with 3 modified files; only top up
      // if the pill is somehow absent.
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await shell(page, ctx);
      if (!(await page.getByTestId("git-dirty-pill").first().isVisible().catch(() => false))) {
        await ctx.dirty(page, "README.md");
        await page.reload({ waitUntil: "domcontentloaded" });
        await shell(page, ctx);
      }
      await page.getByTestId("git-dirty-pill").first().waitFor({ state: "visible", timeout: T });
      await page.getByTestId("group-commit-btn").first().click({ timeout: T });
      const dlg = page.getByTestId("commit-dialog");
      await dlg.waitFor({ state: "visible", timeout: T });
      await page.waitForTimeout(600);
      return null;
    },
  },

  // ── Automation ────────────────────────────────────────────────────────
  {
    id: "flows",
    section: "Automation",
    bullet: "Flows: visual dashboard of multi-agent flows",
    viewports: ["desktop"],
    async run(page) {
      // Flows has NO route of its own. Per generated/plugin-registry.tsx the
      // flows plugin contributes a `settings-section` on the GENERAL tab (plus
      // a session-card subcard and tool renderers) — there is no
      // /settings/plugins/flows page; that path resolves to the shell empty
      // state. Capture the settings section instead.
      await page.goto("/settings?tab=general", { waitUntil: "domcontentloaded" });
      await page.getByTestId("settings-content").waitFor({ state: "visible", timeout: T });
      const flows = page.getByText(/Flows/i).first();
      await flows.waitFor({ state: "visible", timeout: T });
      await flows.scrollIntoViewIfNeeded().catch(() => { /* short page */ });
      await page.waitForTimeout(800);
      return null;
    },
  },
  {
    id: "automations",
    section: "Automation",
    bullet: "Automations: trigger sessions on a cron schedule or when a file appears",
    viewports: ["desktop"],
    async run(page, ctx) {
      return surfaceByText(page, ctx.folderRoute(ctx.fixtureGit, "automations"),
        /Create Automation|Recent runs/i);
    },
  },
  {
    id: "goals",
    section: "Automation",
    bullet: "Goals: set a goal with success criteria and budget",
    viewports: ["desktop"],
    async run(page, ctx) {
      return surfaceByText(page, ctx.folderRoute(ctx.fixtureGit, "goals"),
        /New Goal|Pursuing/i);
    },
  },

  // ── Knowledge base ────────────────────────────────────────────────────
  {
    id: "knowledge-base",
    section: "Knowledge base",
    bullet: "Per-folder searchable index of your markdown docs",
    viewports: ["desktop"],
    async run(page, ctx) {
      // The kb plugin contributes a shell-overlay-route at /folder/:cwd/kb.
      // Anchor on a kb-plugin testid, not on the word "knowledge" — the
      // sidebar folder card renders a KNOWLEDGE BASE row on every page.
      await page.goto(ctx.folderRoute(ctx.fixtureGit, "kb"), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      const kb = page.locator(
        '[data-testid="kb-dbpath"], [data-testid="kb-create-config"], ' +
        '[data-testid="kb-config-origin"], [data-testid="kb-bootstrap-note"]').first();
      await kb.waitFor({ state: "visible", timeout: T });
      await page.waitForTimeout(600);
      return null;
    },
  },

  // ── Models & providers ────────────────────────────────────────────────
  {
    id: "settings-providers",
    section: "Models & providers",
    bullet: "Sign in with one click, or paste API keys; add your own endpoint",
    viewports: ["desktop"],
    async run(page) {
      return surface(page, "/settings?tab=providers", "settings-content");
    },
  },
  {
    id: "settings-models",
    section: "Models & providers",
    bullet: "Assign models to roles and save role presets",
    viewports: ["desktop"],
    async run(page) {
      return surface(page, "/settings?tab=models", "settings-content");
    },
  },

  // ── Extensions & plugins ──────────────────────────────────────────────
  {
    id: "packages",
    section: "Extensions & plugins",
    bullet: "Browse, search, install, update, remove pi packages from the UI",
    viewports: ["desktop"],
    async run(page) {
      return surface(page, "/settings?tab=packages", "settings-content");
    },
  },

  // ── OpenSpec workflow ─────────────────────────────────────────────────
  {
    id: "openspec",
    section: "OpenSpec workflow",
    bullet: "Browse changes, specs and archive; kanban-style board",
    viewports: ["desktop"],
    async run(page, ctx) {
      return surface(page, ctx.folderRoute(ctx.fixtureGit, "openspec"), "openspec-board");
    },
  },
  {
    id: "specs-browser",
    section: "OpenSpec workflow",
    bullet: "Browse changes, specs and archive",
    viewports: ["desktop"],
    async run(page, ctx) {
      // Specs live UNDER the openspec route, not beside it.
      return surface(page, ctx.folderRoute(ctx.fixtureGit, "openspec/specs"), "specs-browser");
    },
  },
  {
    id: "openspec-archive",
    section: "OpenSpec workflow",
    bullet: "Browse changes, specs and archive",
    viewports: ["desktop"],
    async run(page, ctx) {
      return surface(page, ctx.folderRoute(ctx.fixtureGit, "openspec/archive"), "archive-browser");
    },
  },

  // ── Access from anywhere ──────────────────────────────────────────────
  {
    id: "tunnel-qr",
    section: "Access from anywhere",
    bullet: "Share over the internet with a zrok tunnel + QR code; pair a phone",
    viewports: ["desktop", "mobile"],
    async run(page) {
      return surface(page, "/settings?tab=access", "settings-content");
    },
  },
  {
    id: "pi-resources",
    section: "Extensions & plugins",
    bullet: "Bundled skills: /dashboard:* commands, browser automation, doctor",
    viewports: ["desktop"],
    async run(page, ctx) {
      // /pi-resources is a REDIRECT, not a page: App.tsx renders
      // <Redirect to={buildFolderSettingsUrl(cwd, "packages")}>. Navigating
      // there lands on the folder settings Packages tab, so anchor on that.
      await page.goto(ctx.folderRoute(ctx.fixtureGit, "pi-resources"),
        { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/settings\/packages$/, { timeout: T });
      // Folder settings render inside `directory-home`, NOT the global
      // `settings-content` shell used by /settings?tab=…
      return surface(page, page.url(), "directory-home");
    },
  },

  // ── Desktop app ───────────────────────────────────────────────────────
  {
    id: "desktop-app",
    section: "Desktop app",
    bullet: "Native app with setup wizard, tray, Doctor diagnostics",
    viewports: ["desktop"],
    async run() {
      // Electron shell — not reachable from the browser harness. Recorded as
      // MISSING on purpose so the coverage report shows the honest gap rather
      // than silently omitting the section.
      throw new Error("Electron-only surface: not reachable from the web harness");
    },
  },

  // ── Extras you get for free ───────────────────────────────────────────
  {
    id: "extras-settings",
    section: "Extras you get for free",
    bullet: "Document conversion, transcription, image/video generation, grammar check",
    viewports: ["desktop"],
    async run(page) {
      return surface(page, "/settings?tab=general", "settings-content");
    },
  },
];
