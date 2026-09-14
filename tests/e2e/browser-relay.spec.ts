import { type APIRequestContext, expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, gotoDashboard } from "./helpers/index.js";

/**
 * L3 e2e for the browser relay (change: add-browser-relay, test-plan rows
 * F1-F5, F10).
 *
 * Requires the harness with `PI_E2E_SEED=1 PI_BROWSER_RELAY_FAKE=1` (task 7.61):
 * the docker container has no Chrome, so the plugin boots ENABLED and seeds one
 * socket-less `Fake` instance (one tab, `tabId: 1`). See `docker/test-entrypoint.sh`.
 *
 * The tile/frames are driven by the shell WebSocket, which the spec observes by
 * wrapping `WebSocket` BEFORE app load (`installWsSpy`): `__wsSent` /
 * `__wsRecv` / `__wsUrls` are read back with `page.evaluate`.
 */

interface WsSpySnapshot {
  urls: string[];
  sent: string[];
  recv: string[];
}

async function installWsSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __wsUrls: string[];
      __wsSent: string[];
      __wsRecv: string[];
      __ws?: WebSocket;
    };
    w.__wsUrls = [];
    w.__wsSent = [];
    w.__wsRecv = [];
    const Orig = window.WebSocket;
    function Patched(url: string | URL, protocols?: string | string[]) {
      const ws = new Orig(url as string, protocols as string);
      w.__ws = ws;
      w.__wsUrls.push(String(url));
      const send = ws.send.bind(ws);
      ws.send = (data: unknown) => {
        try {
          w.__wsSent.push(String(data));
        } catch {
          /* non-stringable frame — ignore */
        }
        return send(data as never);
      };
      ws.addEventListener("message", (evt) => {
        try {
          w.__wsRecv.push(String((evt as MessageEvent).data));
        } catch {
          /* ignore */
        }
      });
      return ws;
    }
    Patched.prototype = Orig.prototype;
    Object.assign(Patched, Orig);
    window.WebSocket = Patched as unknown as typeof WebSocket;
  });
}

const spy = (page: Page): Promise<WsSpySnapshot> =>
  page.evaluate(() => {
    const w = window as unknown as { __wsUrls: string[]; __wsSent: string[]; __wsRecv: string[] };
    return { urls: w.__wsUrls, sent: w.__wsSent, recv: w.__wsRecv };
  });

async function gotoSettings(page: Page): Promise<void> {
  // Warm the shell first: on a fresh container the client's plugin/config
  // bootstrap races a direct deep-link, so `/settings/plugins/<id>` can resolve
  // before the plugin list arrives and bounce to the dashboard. `gotoDashboard`
  // also arms the first-launch dismiss. Then retry the settings route until the
  // section actually mounts.
  await gotoDashboard(page);
  await expect(async () => {
    await page.goto("/settings/plugins/browser");
    // Generous single-attempt timeout, but the whole block retries: the seeded
    // harness materializes >120 folders whose per-folder git/automation
    // requests saturate Chrome's 6-connection-per-origin pool, so even a
    // navigation's XHRs can queue for many seconds. The assertion is about
    // RENDERED STATE, not latency.
    await expect(page.getByTestId("browser-settings")).toBeVisible({ timeout: 30_000 });
  }).toPass({ timeout: 150_000 });
}

/** The Fake instance's public handle (the `cdpUrl` credential never leaves). */
async function fakeInstanceId(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/browser/profiles");
  expect(res.ok(), "GET /api/browser/profiles").toBe(true);
  const body = (await res.json()) as {
    profiles?: Record<string, { instances?: Array<{ instanceId?: string }> }>;
  };
  const id = body.profiles?.Fake?.instances?.[0]?.instanceId;
  expect(id, "Fake instance present (harness needs PI_BROWSER_RELAY_FAKE=1)").toBeTruthy();
  return id as string;
}

test.describe("browser relay — settings surface (F1-F4)", () => {
  // The seeded harness saturates the browser's per-origin connection pool (see
  // `gotoSettings`), so a settings assertion can legitimately take tens of
  // seconds. Override the global 60 s budget rather than flake.
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await installWsSpy(page);
  });

  test("F1: cannot-open-Chrome notice, no Connect, Fake row shows 1 tab", async ({ page }) => {
    await gotoSettings(page);
    // The docker host has no desktop Chrome → capability false.
    await expect(page.getByTestId("browser-cannot-open-chrome")).toBeVisible();
    await expect(page.getByTestId("browser-profile-Fake")).toBeVisible();
    await expect(page.getByTestId("browser-connected-Fake")).toContainText("1");
    // No Connect button anywhere when the capability is missing.
    await expect(page.getByTestId("browser-connect-Fake")).toHaveCount(0);
  });

  test("F2: the token is write-only (never re-rendered, never in a GET)", async ({ page, request }) => {
    await gotoSettings(page);
    const input = page.getByTestId("browser-token-input-Fake");
    await input.fill("tok123");
    await page.getByTestId("browser-token-save-Fake").click();

    await expect(input).toHaveValue("");
    await expect(page.getByTestId("browser-has-token-Fake")).toContainText("Token set", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("browser-zero-dialog-Fake")).toBeEnabled();

    const res = await request.get("/api/browser/profiles");
    expect(await res.text()).not.toContain("tok123");
    // Restore for later specs in the shared container.
    await page.evaluate(async () => {
      await fetch("/api/browser/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileDirectory: "Fake", token: "" }),
      });
    });
  });

  test("F3: the kill switch closes live instances, then restores", async ({ page, request }) => {
    // Ensure the relay starts enabled (another spec may have toggled it).
    await request.put("/api/browser/enabled", { data: { enabled: true } });
    await gotoSettings(page);
    await expect(page.getByTestId("browser-connected-Fake")).toContainText("1");

    // Flip the relay off from the UI.
    //
    // `plugins.browser.enabled` doubles as the dashboard's plugin-activation
    // key, so once the PUT lands the plugin page swaps its settings BODY for the
    // "plugin is disabled" activation notice — `browser-connected-Fake` is no
    // longer rendered, and neither is the section's own `browser-disabled-reason`
    // row. Assert the spec's actual contract instead: the flag flips, every live
    // instance is closed BEFORE the PUT resolves, and the disabled surface shows.
    await page.getByTestId("browser-enabled-toggle").click();

    await expect
      .poll(
        async () => (await (await request.get("/api/browser/status")).json()).enabled,
        { timeout: 30_000 },
      )
      .toBe(false);
    await expect
      .poll(
        async () => {
          const body = await (await request.get("/api/browser/profiles")).json();
          return body.profiles?.Fake?.instances?.length ?? 0;
        },
        { timeout: 30_000 },
      )
      .toBe(0);
    // The disabled state reached the UI. The reason row is keyed by the
    // profile it sits on, and closing the Fake removes its row entirely, so
    // assert ANY profile's reason (the remaining synthetic `Default` row
    // carries it), or the plugin-activation notice on a fresh load.
    await expect(
      page
        .getByTestId("plugin-page-disabled-notice")
        .or(page.getByTestId(/^browser-disabled-reason-/).first()),
    ).toBeVisible({ timeout: 30_000 });

    // Restore via the API (deterministic) and prove the Fake re-seeds, so the
    // container is left enabled for the following specs.
    await request.put("/api/browser/enabled", { data: { enabled: true } });
    await expect
      .poll(
        async () => {
          const body = await (await request.get("/api/browser/profiles")).json();
          return body.profiles?.Fake?.instances?.length ?? 0;
        },
        { timeout: 30_000 },
      )
      .toBe(1);
  });

  test("F4: a viewer input appends a denied audit row via auditSeq", async ({ page, request }) => {
    await gotoSettings(page);
    const instanceId = await fakeInstanceId(request);
    await expect(page.getByTestId("browser-audit-Fake")).toBeVisible();
    const rows = page.getByTestId(/^browser-audit-row-Fake-/);
    const before = await rows.count();

    // Send through the app's own socket (captured at init): `evaluate` is not in
    // the viewer-input allowlist, so the relay audits a `denied` row.
    await page.evaluate((id) => {
      const w = window as unknown as { __ws?: WebSocket };
      w.__ws?.send(
        JSON.stringify({ type: "browser_relay_input", instanceId: id, tabId: 1, kind: "evaluate" }),
      );
    }, instanceId);

    await expect
      .poll(async () => rows.count(), { timeout: 30_000 })
      .toBeGreaterThan(before);
    await expect(rows.first()).toContainText(/evaluate/i);
    await expect(rows.first()).toContainText(/denied/i);
  });
});

test.describe("browser relay — live-view tile (F5, F10)", () => {
  // Spawning a real pi session is slow; the harness model is faux.
  test.setTimeout(180_000);

  test("F5+F10: selecting a session mounts the tile, frames arrive over /ws, unmount unsubscribes", async ({
    page,
    request,
  }) => {
    await installWsSpy(page);
    await request.put("/api/browser/enabled", { data: { enabled: true } });
    const instanceId = await fakeInstanceId(request);

    // A session card is required: the badge lives on it, feeds the relay store,
    // which is what flips the content-view predicate.
    await ensureGitSession(page);
    await page.getByTestId("session-card-desktop").first().click();

    await expect(page.getByTestId("browser-live-view")).toBeVisible({ timeout: 40_000 });
    // F10: the viewer path rides the core /ws gateway — never a relay socket.
    const afterMount = await spy(page);
    expect(afterMount.urls.some((u) => u.includes("/ws/browser-ext/") || u.includes("/ws/browser-cdp/"))).toBe(
      false,
    );

    // The tile subscribes and the Fake streams frames to it.
    await expect
      .poll(
        async () =>
          (await spy(page)).sent.filter((m) => m.includes("browser_relay_subscribe")).length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    await expect(page.getByTestId(`browser-frame-${instanceId}-1`)).toBeVisible({ timeout: 40_000 });
    await expect
      .poll(async () => (await spy(page)).recv.filter((m) => m.includes("browser_relay_frame")).length, {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(5);

    // Leaving the content view unmounts the tile → the cleanup unsubscribe.
    // The shell's `onClose` is a no-op, so the Close button dismisses via the
    // plugin's own store (which is what flips the content-view predicate).
    await page.getByTestId("browser-live-view-close").click();
    await expect(page.getByTestId("browser-live-view")).toHaveCount(0, { timeout: 30_000 });
    await expect
      .poll(
        async () =>
          (await spy(page)).sent.filter((m) => m.includes("browser_relay_unsubscribe")).length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    // Leave the container enabled for any later spec.
    await request.put("/api/browser/enabled", { data: { enabled: true } });
  });
});
