/**
 * L3 — composer context strip + composer card layout, change:
 * redesign-composer-session-strip. Rendered-UI behaviour jsdom cannot assert:
 *
 *   #F8  empty Status group hides via `[data-group]:has(> [data-group-content]:empty)`
 *   #F9  groups wrap inside themselves, never overflow the strip
 *   #F10 the send button follows the draft's bottom edge, stays ≥ 44×44
 *   #F11 the `@[44rem]` settings-row fold vs the longest model id
 *   #F12 the composer lifecycle bar is in letters mode; the card bar keeps labels
 *
 * A SYNTHETIC bridge drives the session (exemplar: `host-pressure-badge.spec.ts`):
 * it registers under the pre-trusted `FIXTURE_GIT` and pushes a worktree +
 * open-PR `git_info_update` the harness could never produce (no GitHub). The
 * dashboard port comes from `.pi-test-harness.json#dashboardPort` via the
 * fixtures' baseURL — never hardcoded.
 */

import { expect, type Locator, type Page, test } from "./fixtures.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { FIXTURE_GIT, pinDirectory } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

const CHANGE = "e2e-artifact-demo";
/** Longest ids in the shape the harness catalogue serves. */
const MODELS = [
  { provider: "anthropic", id: "claude-haiku-4-5" },
  { provider: "anthropic", id: "claude-sonnet-4-5-20250929" },
  { provider: "openrouter", id: "google/gemini-2.5-flash-preview-05-20-thinking" },
];
const LONGEST = MODELS.reduce((a, b) => (`${b.provider}/${b.id}`.length > `${a.provider}/${a.id}`.length ? b : a));

async function piGatewayPort(page: Page): Promise<number | null> {
  const body = (await (await page.request.get("/api/health")).json()) as { piGatewayPort?: number | null };
  return body.piGatewayPort ?? null;
}

interface Bridge {
  sessionId: string;
  send: (payload: Record<string, unknown>) => void;
  close: () => void;
}

async function connectBridge(page: Page, tag: string): Promise<Bridge> {
  const port = await piGatewayPort(page);
  test.skip(!port, "harness health does not expose the bound gateway port");
  const bearer = await pairDeviceBearer(BASE_URL);
  const url = await gatewayUrlWithTicket(BASE_URL, port as number, bearer);
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const s = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("open timeout")), 5000);
    s.addEventListener("open", () => { clearTimeout(timer); resolve(s); }, { once: true });
    s.addEventListener("error", () => { clearTimeout(timer); reject(new Error("socket error")); }, { once: true });
  });
  const sessionId = `e2e-strip-${tag}-${Date.now()}`;
  const send = (payload: Record<string, unknown>) => {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    } catch {
      // socket died with the test
    }
  };
  send({
    type: "session_register",
    sessionId,
    cwd: FIXTURE_GIT,
    source: "tui",
    pid: 424300 + Math.floor(Math.random() * 99),
    model: `${LONGEST.provider}/${LONGEST.id}`,
  });
  send({ type: "models_list", sessionId, models: MODELS.map((m) => ({ ...m, name: m.id })) });
  return {
    sessionId,
    send,
    close: () => {
      send({ type: "session_unregister", sessionId });
      ws.close();
    },
  };
}

/** Worktree + open, passing PR, pushed as the new bridge would. */
function pushWorktreeWithPr(b: Bridge): void {
  b.send({
    type: "git_info_update",
    sessionId: b.sessionId,
    gitBranch: "os/e2e-composer-strip-wrap-check",
    isGitRepo: true,
    gitWorktree: { mainPath: FIXTURE_GIT, name: "e2e-composer-strip-wrap-check", base: "develop" },
    gitStatus: { dirtyCount: 3, staged: 1, unstaged: 2, untracked: 0, ahead: 2, behind: 0 },
    gitPrNumber: 747,
    gitPrUrl: "https://github.com/o/r/pull/747",
    gitPrState: "open",
    gitPrDraft: false,
    gitPrChecks: "passing",
    gitPrCheckedAt: Date.now(),
  });
}

/** Select the synthetic session and wait for its composer. */
async function openComposer(page: Page, sessionId: string): Promise<void> {
  const card = page.locator(`[data-session-id="${sessionId}"]`).first();
  const shown = await card.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);
  if (!shown) {
    await pinDirectory(page, FIXTURE_GIT);
    await expect(card).toBeVisible({ timeout: 30_000 });
  }
  await card.click();
  await expect(page.getByTestId("composer-card")).toBeVisible({ timeout: 20_000 });
}

const box = async (l: Locator) => {
  const b = await l.boundingBox();
  expect(b).not.toBeNull();
  return b!;
};

test.describe("composer session strip (L3)", () => {
  test("#F8: an all-null badge slot hides the whole Status group; content brings the label back", async ({ page }) => {
    await page.goto("/");
    const b = await connectBridge(page, "f8");
    try {
      await openComposer(page, b.sessionId);
      // The browser-relay badge is claimed for every session and renders null
      // until a relay tab exists — the real-world empty STATUS case.
      const container = page.getByTestId("composer-status-container");
      await expect(container).toHaveCount(1, { timeout: 15_000 });
      await expect(container).toHaveCSS("display", "none");
      await expect(page.getByTestId("composer-status-group-label")).toBeHidden();

      // Non-null half: once the fieldset has content, the group shows.
      await page.getByTestId("composer-status-group").evaluate((el) => {
        const s = document.createElement("span");
        s.textContent = "RUN";
        el.appendChild(s);
      });
      await expect(page.getByTestId("composer-status-group-label")).toBeVisible();
      await expect(container).not.toHaveCSS("display", "none");
    } finally {
      b.close();
    }
  });

  test("#F9: groups wrap without overflowing the strip; the label keeps the first item's top edge", async ({ page }) => {
    await page.goto("/");
    const b = await connectBridge(page, "f9");
    try {
      await openComposer(page, b.sessionId);
      pushWorktreeWithPr(b);
      const strip = page.getByTestId("composer-session-actions");
      await expect(page.getByTestId("worktree-pr-segment")).toBeVisible({ timeout: 20_000 });

      for (const width of [1440, 700, 420]) {
        await strip.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
        const { scrollWidth, clientWidth } = await strip.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
        expect(scrollWidth, `strip overflow at ${width}px`).toBeLessThanOrEqual(clientWidth);
        const stripBox = await box(strip);
        const gitBox = await box(page.getByTestId("composer-git-container"));
        expect(gitBox.x + gitBox.width, `git group escapes the strip at ${width}px`).toBeLessThanOrEqual(stripBox.x + stripBox.width + 1);
      }

      // At 420 px the Git content wraps INSIDE its container…
      const tops = await page.getByTestId("composer-git-group").evaluate((el) =>
        Array.from(el.children)
          .filter((c) => (c as HTMLElement).getBoundingClientRect().width > 0)
          .map((c) => Math.round((c as HTMLElement).getBoundingClientRect().top)),
      );
      expect(new Set(tops).size, "git content should wrap onto >1 line at 420px").toBeGreaterThan(1);
      // …and the label stays beside the first item.
      const label = await box(page.getByTestId("composer-git-group-label"));
      const first = await box(page.getByTestId("composer-git-identity"));
      expect(Math.abs(label.y - first.y)).toBeLessThanOrEqual(2);
    } finally {
      b.close();
    }
  });

  test("#F10: the action button follows the draft's bottom edge and stays ≥ 44×44", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto("/");
    const b = await connectBridge(page, "f10");
    try {
      await openComposer(page, b.sessionId);
      const textarea = page.getByTestId("composer-card").locator("textarea");
      const send = page.getByTestId("send-button");
      for (const draft of ["one line", "one\ntwo\nthree\nfour"]) {
        await textarea.fill(draft);
        await textarea.dispatchEvent("input");
        const ta = await box(textarea);
        const btn = await box(send);
        expect(Math.abs(ta.y + ta.height - (btn.y + btn.height)), `bottom edges for ${JSON.stringify(draft)}`).toBeLessThanOrEqual(2);
        expect(btn.width).toBeGreaterThanOrEqual(44);
        expect(btn.height).toBeGreaterThanOrEqual(44);
      }
    } finally {
      b.close();
    }
  });

  test("#F11: the @[44rem] fold holds with the longest model id selected", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto("/");
    const b = await connectBridge(page, "f11");
    try {
      await openComposer(page, b.sessionId);
      const card = page.getByTestId("composer-card");
      const setContentWidth = (delta: number) =>
        card.evaluate((el, d) => {
          const cs = getComputedStyle(el);
          const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
          const chrome = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"]
            .map((k) => parseFloat(cs[k as keyof CSSStyleDeclaration] as string) || 0)
            .reduce((a, v) => a + v, 0);
          (el as HTMLElement).style.width = `${44 * rem + d + chrome}px`;
          (el as HTMLElement).style.flex = "none";
        }, delta);

      await setContentWidth(1);
      await expect(page.getByTestId("overflow-button")).toBeHidden();
      await expect(page.getByTestId("composer-settings-row").getByTestId("delivery-control")).toBeVisible();
      const row = page.getByTestId("composer-settings-row");
      const { scrollWidth, clientWidth } = await row.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(scrollWidth, `settings row overflows at 44rem+1px with ${LONGEST.id}`).toBeLessThanOrEqual(clientWidth);

      await setContentWidth(-1);
      await expect(page.getByTestId("overflow-button")).toBeVisible();
    } finally {
      b.close();
    }
  });

  test("#F12: the composer lifecycle bar is in letters mode; the card bar keeps full labels", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const b = await connectBridge(page, "f12");
    try {
      await openComposer(page, b.sessionId);
      const chip = page.getByTestId("composer-attach-chip");
      await expect(chip).toBeEnabled({ timeout: 45_000 });
      await chip.click();
      await page.getByText(CHANGE, { exact: false }).first().click();

      const bar = page.getByTestId("composer-openspec-stepper");
      await expect(bar).toBeVisible({ timeout: 20_000 });
      expect((await box(bar)).width).toBeLessThanOrEqual(250);
      // Letters mode: the short label is shown, the full word is not.
      await expect(bar.getByTestId("composer-stepper-segment-proposal").locator(".openspec-seg-full")).toBeHidden();
      await expect(bar.getByTestId("composer-stepper-segment-proposal").locator(".openspec-seg-short")).toBeVisible();

      // The session card's bar (same page) keeps the full labels.
      const card = page.locator(`[data-session-id="${b.sessionId}"]`).first();
      const cardBar = card.getByTestId("openspec-stepper");
      await expect(cardBar).toBeVisible({ timeout: 20_000 });
      if ((await box(cardBar)).width >= 250) {
        await expect(cardBar.getByTestId("stepper-segment-proposal").locator(".openspec-seg-full")).toBeVisible();
      }
    } finally {
      b.close();
    }
  });
});
