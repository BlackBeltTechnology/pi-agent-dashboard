/**
 * L3 — composer context strip + composer card layout, change:
 * redesign-composer-session-strip. Rendered-UI behaviour jsdom cannot assert:
 *
 *   #F8  empty Status group hides via `[data-group]:has(> [data-group-content]:empty)`
 *   #F9  the Changes lane (the git group's successor) stays inside the dock, its actions unclipped
 *   #F10 the action button sits at the toolbar's trailing end, below the draft, stays ≥ 44×44
 *   #F11 the `@[26.25rem]` toolbar fold vs the longest model id (add-composer-dock)
 *   #F12 the composer lifecycle bar is in letters mode; the card bar keeps labels
 *   #F19 the card border is the one focus indicator (add-composer-dock)
 *
 * A SYNTHETIC bridge drives the session (exemplar: `host-pressure-badge.spec.ts`):
 * it registers under the pre-trusted `FIXTURE_GIT` and pushes a worktree +
 * open-PR `git_info_update` the harness could never produce (no GitHub). The
 * dashboard port comes from `.pi-test-harness.json#dashboardPort` via the
 * fixtures' baseURL — never hardcoded.
 */

import { expect, type Locator, type Page, test } from "./fixtures.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { colorDistance, contrastRatio, resolveColor } from "./helpers/computed-contrast.js";
import { FIXTURE_GIT, gotoDashboard, pinDirectory } from "./helpers/index.js";
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

/**
 * Pin `FIXTURE_GIT` BEFORE any synthetic session registers there. Otherwise the
 * synthetic cards make the folder group render UNPINNED, and later specs'
 * `ensureGitSession` then trusts that group and dead-ends on the onboarding
 * "Pin a folder first" CTA (specs share one container).
 */
async function ensurePinned(page: Page): Promise<void> {
  const res = await page.request.get("/api/pinned-dirs");
  const body = (await res.json()) as { data?: string[] };
  if (!(body.data ?? []).includes(FIXTURE_GIT)) await pinDirectory(page, FIXTURE_GIT);
}

/** Select the synthetic session and wait for its composer. */
async function openComposer(page: Page, sessionId: string): Promise<void> {
  const card = page.locator(`[data-session-id="${sessionId}"]`).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
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
    // The browser-relay plugin's badge is claimed for EVERY session and
    // renders null until a relay tab exists — the real-world empty STATUS case.
    // The harness ships it disabled; report it enabled to THIS page only.
    await page.route("**/api/health", async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { plugins?: Array<{ id: string; enabled?: boolean }> };
      for (const p of body.plugins ?? []) if (p.id === "browser") p.enabled = true;
      await route.fulfill({ response: res, json: body });
    });
    await gotoDashboard(page);
    await ensurePinned(page);
    const b = await connectBridge(page, "f8");
    try {
      await openComposer(page, b.sessionId);
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

  test("#F9: the Changes lane stays inside the dock at 1440 / 700 / 420 px and its actions are never clipped", async ({ page }) => {
    await gotoDashboard(page);
    await ensurePinned(page);
    const b = await connectBridge(page, "f9");
    try {
      await openComposer(page, b.sessionId);
      pushWorktreeWithPr(b);
      const dock = page.getByTestId("composer-dock");
      const lane = page.getByTestId("composer-git-container");
      await expect(lane.getByTestId("worktree-pr-segment")).toBeVisible({ timeout: 20_000 });
      await expect(lane.getByTestId("composer-git-identity")).toBeVisible();

      // Lane headers truncate (title, then meta) instead of wrapping; the actions are `flex-none`.
      for (const width of [1440, 700, 420]) {
        await dock.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; (el as HTMLElement).style.flex = "none"; }, width);
        const { scrollWidth, clientWidth } = await dock.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
        expect(scrollWidth, `dock overflows horizontally at ${width}px`).toBeLessThanOrEqual(clientWidth);
        const dockBox = await box(dock);
        const laneBox = await box(lane);
        expect(laneBox.x + laneBox.width, `Changes lane escapes the dock at ${width}px`).toBeLessThanOrEqual(dockBox.x + dockBox.width + 1);
        const actions = await box(lane.getByTestId("composer-git-group"));
        expect(actions.x + actions.width, `Changes actions clipped at ${width}px`).toBeLessThanOrEqual(dockBox.x + dockBox.width + 1);
        expect(actions.x, `Changes actions start inside the dock at ${width}px`).toBeGreaterThanOrEqual(dockBox.x - 1);
      }
    } finally {
      b.close();
    }
  });

  test("#F10: the action button ends the toolbar row below the draft and stays ≥ 44×44", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await gotoDashboard(page);
    await ensurePinned(page);
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
        const card = await box(page.getByTestId("composer-card"));
        // Below the textarea's last line, at the card's bottom-right (add-composer-dock D7).
        expect(btn.y, `button is below the textarea for ${JSON.stringify(draft)}`).toBeGreaterThanOrEqual(ta.y + ta.height - 1);
        expect(btn.y + btn.height, "button stays inside the card").toBeLessThanOrEqual(card.y + card.height + 1);
        expect(card.x + card.width - (btn.x + btn.width), "button hugs the card's right edge").toBeLessThanOrEqual(24);
        expect(btn.width).toBeGreaterThanOrEqual(44);
        expect(btn.height).toBeGreaterThanOrEqual(44);
        await expect(page.getByTestId("composer-settings-row").getByTestId("send-button")).toBeVisible();
      }
    } finally {
      b.close();
    }
  });

  test("#F11: the 26.25rem fold holds with the longest model id selected", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await gotoDashboard(page);
    await ensurePinned(page);
    const b = await connectBridge(page, "f11");
    try {
      await openComposer(page, b.sessionId);
      const card = page.getByTestId("composer-card");
      const row = page.getByTestId("composer-settings-row");
      const delivery = row.getByTestId("delivery-control");
      await expect(delivery).toHaveAccessibleName(/Delivery mode: Steer/);
      await expect(page.getByTestId("overflow-button")).toHaveCount(0);

      const setContentWidth = (delta: number) =>
        card.evaluate((el, d) => {
          const cs = getComputedStyle(el);
          const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
          const chrome = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"]
            .map((k) => parseFloat(cs[k as keyof CSSStyleDeclaration] as string) || 0)
            .reduce((a, v) => a + v, 0);
          (el as HTMLElement).style.width = `${26.25 * rem + d + chrome}px`;
          (el as HTMLElement).style.flex = "none";
        }, delta);

      await setContentWidth(1);
      await expect(delivery).toBeVisible();
      const wide = await row.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(wide.scrollWidth, `toolbar overflows at 26.25rem+1px with ${LONGEST.id}`).toBeLessThanOrEqual(wide.clientWidth);

      await setContentWidth(-1);
      await expect(delivery).toBeHidden();
      const narrow = await row.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(narrow.scrollWidth, `toolbar overflows at 26.25rem-1px with ${LONGEST.id}`).toBeLessThanOrEqual(narrow.clientWidth);
      await page.getByTestId("attach-button").click();
      await expect(page.getByTestId("attach-menu").getByTestId("delivery-steer")).toBeVisible();
    } finally {
      b.close();
    }
  });

  test("#F12: the composer lifecycle bar is in letters mode; the card bar keeps full labels", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // The harness fixture has no `.pi/skills/openspec-explore/`, so its real
    // readiness is STALE/missing-skills and the OpenSpec group (correctly)
    // hides. Report READY to THIS page only — the real change data, server
    // and UI stay authentic; the shared fixture is not mutated.
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => {
        if (typeof m !== "string" || !m.includes(FIXTURE_GIT)) return ws.send(m);
        try {
          const patch = (msg: { type?: string; cwd?: string; data?: { readiness?: unknown } }) => {
            if ((msg.type === "openspec_update" || msg.type === "openspec_get_result") && msg.cwd === FIXTURE_GIT && msg.data) {
              msg.data.readiness = { state: "READY" };
            }
            return msg;
          };
          const parsed = JSON.parse(m);
          ws.send(JSON.stringify(Array.isArray(parsed) ? parsed.map(patch) : patch(parsed)));
        } catch {
          ws.send(m);
        }
      });
    });
    await gotoDashboard(page);
    await ensurePinned(page);
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

  test("#F19: focusing the textarea turns the card border to the focus colour (≥ 3:1); the textarea draws no ring", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await gotoDashboard(page);
    await ensurePinned(page);
    const b = await connectBridge(page, "f19");
    try {
      await openComposer(page, b.sessionId);
      const card = page.getByTestId("composer-card");
      const textarea = card.locator("textarea").first();
      await textarea.focus();
      await expect(textarea).toBeFocused();

      const accent = await resolveColor(page, "var(--accent)");
      const border = (): Promise<number[]> =>
        card.evaluate((el) => {
          const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
          cv.fillStyle = "#000";
          cv.fillStyle = getComputedStyle(el).borderTopColor;
          cv.fillRect(0, 0, 1, 1);
          const d = cv.getImageData(0, 0, 1, 1).data;
          return [d[0], d[1], d[2]];
        });
      // The border transitions (`transition-colors`): poll to the settled colour.
      await expect.poll(async () => colorDistance(await border(), accent), { timeout: 5_000 }).toBeLessThanOrEqual(1);

      // Non-text contrast of the focused border against the surface around the card.
      const surface = await resolveColor(page, "var(--bg-primary)");
      expect(contrastRatio(await border(), surface), "focused card border vs surrounding surface").toBeGreaterThanOrEqual(3);

      // ONE focus indicator: the textarea itself draws no outline and no box-shadow ring.
      const ring = await textarea.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { outlineStyle: cs.outlineStyle, outlineWidth: Number.parseFloat(cs.outlineWidth) || 0, boxShadow: cs.boxShadow };
      });
      expect(ring.outlineStyle === "none" || ring.outlineWidth === 0, `textarea outline: ${JSON.stringify(ring)}`).toBe(true);
      expect(ring.boxShadow, "textarea box-shadow").toBe("none");
    } finally {
      b.close();
    }
  });
});
