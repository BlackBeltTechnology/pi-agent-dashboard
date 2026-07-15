import { expect, test } from "@playwright/test";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// ─────────────────────────────────────────────────────────────────────────
// auto-canvas — client canvas surface (change: auto-canvas, Sections 6–7).
//
// Drives the REAL server-side detect / declare pipeline (built + green) via
// faux scenarios that emit a `write` deliverable (DOC detect → canvas_intent)
// or a `canvas` declare tool call (→ canvas_server_chip). Asserts the client
// canvas surface consumes those broadcasts.
//
// Faux scenarios (qa/fixtures/faux-scenarios.ts):
//   canvas-write-md          — write report.md → canvas_intent eager+settle
//   canvas-declare-server    — canvas({server,5173}) → canvas_server_chip
//   canvas-declare-url       — canvas({url, youtu.be/…}) → canvas_intent url
//
// Client testids (packages/client/src/components/CanvasDriver.tsx,
// CanvasServerChip.tsx): canvas-chip-tray · canvas-file-chip ·
// canvas-server-chip. Split surface testids: split-editor-pane ·
// split-chat-pane (SplitWorkspace.tsx).
// ─────────────────────────────────────────────────────────────────────────

test.describe("auto-canvas — desktop side-by-side (S23)", () => {
  test("a written deliverable opens the canvas side-by-side, chat stays usable", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:canvas-write-md]] go");

    // Desktop tier → auto-open in the split; chat pane co-mounted (usable).
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("split-chat-pane")).toBeVisible();
    // Composer still present → chat usable.
    await expect(page.getByPlaceholder(/message/i).first()).toBeVisible();
  });
});

test.describe("auto-canvas — mobile chip, no yank (S25)", () => {
  test("a written deliverable surfaces a tap-to-open chip; chat stays active", async ({ page }) => {
    // Spawn at the default (desktop) width — the onboarding/spawn flow needs it —
    // then resize to the mobile predicate so the canvas GATE is what's exercised.
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.setViewportSize({ width: 767, height: 800 });

    await sendPrompt(page, "[[faux:canvas-write-md]] go");

    // Mobile predicate (<768w) → NO auto-open; a chip is surfaced instead.
    await expect(page.getByTestId("canvas-file-chip")).toBeVisible({ timeout: 30_000 });
    // Chat is NOT yanked away — the editor split pane must not be present.
    await expect(page.getByTestId("split-editor-pane")).toHaveCount(0);
    // Composer still active.
    await expect(page.getByPlaceholder(/message/i).first()).toBeVisible();
  });
});

test.describe("auto-canvas — eager-open immediate (S26)", () => {
  test("the canvas opens on the first mid-turn write (no turn-end wait)", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:canvas-write-md]] go");

    // Eager broadcast fires on the FIRST qualifying write, before the turn's
    // trailing "report written" text lands — the split opens promptly.
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("auto-canvas — server confirm chip, no pre-tap fetch (S29)", () => {
  test("a {kind:server} declare surfaces a chip without probing before tap", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });

    // Fail the run if the client probes the live-server start endpoint BEFORE
    // the human tap (Decision 4 / CONTRACT 1 — no auto-fetch of agent input).
    let preTapProbe = false;
    let tapped = false;
    // Any allowlist-add (POST /api/live-server/**) OR proxied probe (/live/**)
    // before the tap is a pre-confirm fetch of agent-supplied input (SSRF).
    await page.route("**/api/live-server/**", (route) => {
      if (!tapped && route.request().method() === "POST") preTapProbe = true;
      route.continue();
    });
    await page.route("**/live/**", (route) => {
      if (!tapped) preTapProbe = true;
      route.continue();
    });

    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:canvas-declare-server]] go");

    const chip = page.getByTestId("canvas-server-chip");
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(chip).toContainText(":5173");
    expect(preTapProbe, "no live-server probe may fire before the chip tap").toBe(false);

    // Tapping routes through the LiveServerViewer loopback-probe path.
    tapped = true;
    await chip.click();
    await expect(byTestId(page, "sendButton")).toBeVisible(); // sanity: app alive
  });
});

test.describe("auto-canvas — chip expires at turn boundary (S32)", () => {
  test("the chip becomes non-actionable after the turn ends", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:canvas-declare-server]] go");
    await expect(page.getByTestId("canvas-server-chip")).toBeVisible({ timeout: 30_000 });
    // Drive a second, non-declaring turn → the server broadcasts chip expiry
    // (`canvas_server_chip{expire:true}`); the client drops the chip (S32).
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(page.getByTestId("canvas-server-chip")).toHaveCount(0, { timeout: 15_000 });
  });
});

test.describe("auto-canvas — server chip refused → not running (S30)", () => {
  test("tapping a chip for a dead port shows 'not running', no iframe", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:canvas-declare-server-dead]] go");
    const chip = page.getByTestId("canvas-server-chip");
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(chip).toContainText(":59321");

    // Tap → the loopback probe is refused (nothing listens on 59321) → the chip
    // surfaces "server not running" and NEVER opens the live-server iframe.
    await chip.click();
    await expect(page.getByTestId("canvas-server-chip-status")).toContainText(/not running/i, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("live-iframe")).toHaveCount(0);
  });
});

test.describe("auto-canvas — server chip unresponsive → not responding (S31)", () => {
  test("tapping a chip for a hung port shows 'not responding', no iframe", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });

    // A port that ACCEPTS the allowlist-add but whose proxied probe never
    // responds is simulated by DELAYING the same-origin proxy path `/live/:id/*`
    // past the client's 3000ms abort. The `/api/live-server/start` call (a
    // different path) is left untouched, so the allowlist-add succeeds and the
    // hang is purely on the probe fetch — exactly the S31 fault.
    await page.route("**/live/**", async (route) => {
      await new Promise((r) => setTimeout(r, 3500));
      await route.continue();
    });

    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:canvas-declare-server]] go");
    const chip = page.getByTestId("canvas-server-chip");
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await chip.click();

    // Client AbortController fires at 3000ms → "server not responding", no iframe.
    await expect(page.getByTestId("canvas-server-chip-status")).toContainText(/not responding/i, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("live-iframe")).toHaveCount(0);
  });
});

test.describe("auto-canvas — per-session restore (S27)", () => {
  // Session A opens a canvas; switching B→A restores A's canvas. Requires two
  // sessions and a reliable switch gesture; the restore effect (CanvasDriver
  // re-runs its gated open when the selected session's canvas key changes) is
  // unit-covered in canvas-gate.test.ts. Left as a fleshed-out fixme for the
  // harness run (two-session switching is environment-timing sensitive).
  test("A's canvas is restored after switching away and back", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const cardA = await spawnFreshGitSession(page);
    await cardA.click();
    await sendPrompt(page, "[[faux:canvas-write-md]] go");
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 30_000 });

    const cardB = await spawnFreshGitSession(page);
    await cardB.click();
    // B has no canvas → its split is closed (per-session state).
    await expect(page.getByTestId("split-editor-pane")).toHaveCount(0, { timeout: 15_000 });
    // Switch back to A and assert its canvas is restored (the CanvasDriver
    // restore effect re-runs its gated open when A's canvas key re-selects).
    await cardA.click();
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("auto-canvas — URL deep-link coexists (S28)", () => {
  test("the /session/:id/editor deep-link still opens the editor pane", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const card = await spawnFreshGitSession(page);
    await card.click();
    // Open a real fixture file via the deep-link route (unchanged by canvas).
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();
    await page.goto(`/session/${sessionId}/editor?file=README.md`);
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("auto-canvas — tablet replaces chat (S24)", () => {
  // Tablet (768–1023w, ≥600h) REPLACES chat: full-width canvas, no side-by-side,
  // no chip. `SessionSplitView` passes `replaceChat` to `SplitWorkspace` on the
  // tablet tier, which mounts only the editor pane (no `split-chat-pane`).
  test("canvas replaces chat on tablet, no side-by-side, no chip", async ({ page }) => {
    await page.setViewportSize({ width: 1023, height: 700 });
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:canvas-write-md]] go");
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("split-chat-pane")).toHaveCount(0); // replaced
    await expect(page.getByTestId("canvas-file-chip")).toHaveCount(0); // no chip on tablet
  });
});
