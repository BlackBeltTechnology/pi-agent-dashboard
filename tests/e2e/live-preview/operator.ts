import { type BrowserContext, expect, type Frame, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { WebSocket } from "ws";
import type { IsolatedServer } from "./isolated-server.js";

/**
 * The OPERATOR's side of a live preview, through the real UI:
 *   authenticate the browser (local-proof cookie, no login) → register a fake pi session on the
 *   gateway (so the dashboard has a session pane to host the viewer) → select it → split layout →
 *   `+` menu → "Live preview" → enter the target URL → the `LiveServerViewer` iframe mounts.
 * Specs use `livePreview.open(...)` from `fixture.ts`; this file is the implementation.
 */

/** Dismiss the first-launch display dialog whenever it appears (same as `tests/e2e/helpers`). */
async function armFirstLaunchDismiss(page: Page): Promise<void> {
  const backdrop = page.getByTestId("first-launch-display-backdrop");
  await page.addLocatorHandler(backdrop, async () => {
    await backdrop.getByRole("button", { name: /^skip$/i }).click();
  });
}

export interface FakeSession {
  id: string;
  name: string;
  /** Disconnect the fake bridge (the session ends). Idempotent. */
  close(): Promise<void>;
}

export class Operator {
  private authed = new Set<string>();
  private sessions: FakeSession[] = [];
  private armed = new WeakSet<Page>();
  private server: IsolatedServer;
  constructor(server: IsolatedServer) {
    this.server = server;
  }

  /**
   * Give `context` the operator credential for dashboard origin `origin` (`http://localhost:<p>`,
   * `http://127.0.0.1:<p>`, `http://dash.test:<p>`, …): redeem a fresh one-time local-proof code in a
   * throwaway page. The cookie is host-scoped, so call it once per dashboard host spelling.
   * Idempotent per (context, origin).
   */
  async authenticate(context: BrowserContext, origin: string): Promise<void> {
    const key = `${(context as unknown as { _guid?: string })._guid ?? ""}|${origin}`;
    if (this.authed.has(key)) return;
    const page = await context.newPage();
    try {
      const code = await this.server.mintLocalProofCode();
      const res = await page.goto(`${origin}/auth/local-proof?code=${code}`);
      expect(res?.ok(), `local-proof redeem at ${origin}`).toBeTruthy();
    } finally {
      await page.close();
    }
    this.authed.add(key);
  }

  /** Register a fake bridge session (`session_register` over the gateway socket) that stays "active". */
  async fakeSession(name = `lp-${Math.random().toString(36).slice(2, 8)}`): Promise<FakeSession> {
    const id = `lp-${Math.random().toString(36).slice(2, 10)}`;
    const ws = new WebSocket(`ws+unix://${this.server.gatewaySocket}:/`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    ws.send(JSON.stringify({ type: "session_register", sessionId: id, name, cwd: "/tmp", source: "tui", pid: 700_000 + Math.floor(Math.random() * 90_000) }));
    const s: FakeSession = {
      id,
      name,
      close: async () => {
        if (ws.readyState === WebSocket.CLOSED) return;
        await new Promise<void>((r) => {
          ws.once("close", () => r());
          ws.close();
        });
      },
    };
    this.sessions.push(s);
    return s;
  }

  /** Close every fake session this operator registered (called by the fixture teardown). */
  async dispose(): Promise<void> {
    await Promise.all(this.sessions.map((s) => s.close().catch(() => undefined)));
    this.sessions = [];
  }

  /** Open `path` on `origin` as the authenticated operator; the first-launch dialog is auto-skipped. */
  async gotoDashboard(page: Page, origin: string, path = "/"): Promise<void> {
    await this.authenticate(page.context(), origin);
    if (!this.armed.has(page)) {
      this.armed.add(page);
      await armFirstLaunchDismiss(page);
    }
    await page.goto(`${origin}${path}`);
    await page.getByTestId("header-app-bar").waitFor({ state: "visible", timeout: 30_000 });
  }

  /**
   * Open a live preview of `target` for a fake session in `page`, through the real viewer UI.
   * `dashOrigin` is the dashboard origin the browser uses (default: the page's baseURL host).
   */
  async openLivePreview(page: Page, opts: { dashOrigin: string; target: string; session?: FakeSession }): Promise<LiveViewer> {
    const session = opts.session ?? (await this.fakeSession());
    await this.gotoDashboard(page, opts.dashOrigin);
    const card = page.locator(`[data-testid="session-card-desktop"][data-session-id="${session.id}"]`);
    // One retried block: the session list / pane header re-render while the page settles (slow on a loaded
    // machine), so any step may miss; each retry restarts from selecting the session card.
    await expect(async () => {
      await card.click({ timeout: 5_000 });
      await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 5_000 });
      await page.getByTestId("layout-mode-split").click({ timeout: 3_000 });
      if ((await page.getByTestId("new-tab-menu-toggle").getAttribute("aria-expanded", { timeout: 3_000 })) !== "true") {
        await page.getByTestId("new-tab-menu-toggle").click({ timeout: 3_000 });
      }
      await page.getByTestId("live-preview-launch").click({ timeout: 3_000 });
      await page.getByTestId("live-url").waitFor({ state: "visible", timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByTestId("live-url").fill(opts.target);
    await page.getByTestId("live-confirm").click();
    const viewer = new LiveViewer(page, opts.target, session);
    await expect(viewer.iframe).toBeAttached({ timeout: 20_000 });
    return viewer;
  }
}

/** Handle on the open viewer pane (`LiveServerViewer` → `LiveFrame` → sandboxed `live-iframe`). */
export class LiveViewer {
  readonly page: Page;
  readonly target: string;
  readonly session: FakeSession;
  constructor(page: Page, target: string, session: FakeSession) {
    this.page = page;
    this.target = target;
    this.session = session;
  }

  /** The viewer's `<iframe data-testid="live-iframe">`. */
  get iframe(): Locator {
    return this.page.getByTestId("live-iframe");
  }
  /** FrameLocator into the preview document (`viewer.frameLocator.locator("#static")`). */
  get frameLocator(): FrameLocator {
    return this.page.frameLocator('[data-testid="live-iframe"]');
  }
  /** The iframe's current `src` attribute (absolute URL for tiers 1–4, `/preview/<pid>/` for tier 5). */
  async src(): Promise<string> {
    return (await this.iframe.getAttribute("src")) ?? "";
  }
  /** `sandbox` attribute tokens. */
  async sandbox(): Promise<string[]> {
    return ((await this.iframe.getAttribute("sandbox")) ?? "").split(/\s+/).filter(Boolean);
  }
  /** Origin of the iframe `src` resolved against the page (tier 5's relative path → dashboard origin). */
  async srcOrigin(): Promise<string> {
    return new URL(await this.src(), this.page.url()).origin;
  }
  /** The preview's `Frame` (waits until the iframe has a content frame that left about:blank). */
  async frame(): Promise<Frame> {
    const handle = await this.iframe.elementHandle();
    const frame = await handle?.contentFrame();
    if (!frame) throw new Error("live-iframe has no content frame");
    await expect.poll(() => frame.url(), { message: "preview frame navigated" }).not.toBe("about:blank");
    return frame;
  }
  /** Wait until `selector` is in the preview document and return its Frame. */
  async ready(selector: string): Promise<Frame> {
    await this.frameLocator.locator(selector).first().waitFor({ state: "attached", timeout: 20_000 });
    return this.frame();
  }
  /** Leave the viewer (back to the target picker) and open the same target again → a NEW viewerId mints. */
  async reopen(): Promise<void> {
    await this.page.getByTestId("live-back").click();
    const port = new URL(this.target).port;
    await this.page.getByTestId("live-target-row").filter({ hasText: `:${port}` }).getByRole("button").first().click();
    await expect(this.iframe).toBeAttached({ timeout: 20_000 });
  }
}
