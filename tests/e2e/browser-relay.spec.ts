import { type APIRequestContext, expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, gotoDashboard, sendPrompt } from "./helpers/index.js";

/**
 * L3 e2e for the browser relay (change: add-browser-relay, test-plan rows
 * F1-F5, F10; the pane-tab rows F1, F5, F10, F14, F15, F17 of
 * add-browser-editor-pane-tab).
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

// Variant-harness gate: the Fake relay instance exists only when the container
// booted with PI_BROWSER_RELAY_FAKE=1. That faucet CANNOT be a shared-harness
// default — the seeded Fake instance adds a badge to every session card and is
// state other specs never expect (it used to occlude the chat through the
// `content-view` slot, systemic cause S2 of stabilize-browser-e2e). It runs
// on its OWN CI leg (`e2e-browser-relay` in .github/workflows/ci-e2e-browser.yml,
// which sets PI_E2E_SEED=1 + PI_BROWSER_RELAY_FAKE=1); every other shard skips
// this file. Locally opt in with:
//   PI_E2E_SEED=1 PI_BROWSER_RELAY_FAKE=1 docker/test-up.sh -d --build
// See change: add-browser-relay (task 7.61), stabilize-browser-e2e (4.2).
test.skip(
  process.env.PI_BROWSER_RELAY_FAKE !== "1",
  "variant harness: runs on the `e2e-browser-relay` CI leg (PI_BROWSER_RELAY_FAKE=1); see .github/workflows/ci-e2e-browser.yml",
);

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

test.describe("browser relay — editor pane tab (F1, F5, F10, F14, F15, F17)", () => {
  // Spawning a real pi session is slow; the harness model is faux.
  test.setTimeout(180_000);

  /** Select the first session and return its id (from the route). */
  async function selectSession(page: Page): Promise<string> {
    await ensureGitSession(page);
    await page.getByTestId("session-card-desktop").first().click();
    await expect(page).toHaveURL(/\/session\/[^/?]+/, { timeout: 30_000 });
    return decodeURIComponent(new URL(page.url()).pathname.split("/")[2] as string);
  }

  /** Open the Fake's tab from the selected card's badge menu. */
  async function openFromBadge(page: Page, instanceId: string): Promise<void> {
    const badge = page.getByTestId("session-card-desktop").first().getByTestId("browser-relay-badge");
    await expect(badge).toBeVisible({ timeout: 40_000 });
    await badge.click();
    await page.getByTestId(`browser-relay-open-${instanceId}-1`).click();
    await expect(page.getByTestId("browser-pane-tab")).toBeVisible({ timeout: 40_000 });
  }

  test("F1+F5+F10: badge menu opens the pane tab beside the chat; frames over /ws; closing unsubscribes", async ({
    page,
    request,
  }) => {
    await installWsSpy(page);
    await request.put("/api/browser/enabled", { data: { enabled: true } });
    const instanceId = await fakeInstanceId(request);
    await selectSession(page);

    // Nothing opened on its own: the relay never replaces the chat.
    await expect(page.getByTestId("browser-pane-tab")).toHaveCount(0);
    await openFromBadge(page, instanceId);

    // F1: the chat is still visible next to the pane tab.
    await expect(page.getByTestId("chat-scroll-container")).toBeVisible();

    // F10: the viewer path rides the core /ws gateway — never a relay socket.
    const afterMount = await spy(page);
    expect(afterMount.urls.some((u) => u.includes("/ws/browser-ext/") || u.includes("/ws/browser-cdp/"))).toBe(false);

    await expect
      .poll(async () => (await spy(page)).sent.filter((m) => m.includes("browser_relay_subscribe")).length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await expect(page.getByTestId("browser-pane-frame")).toBeVisible({ timeout: 40_000 });
    await expect
      .poll(async () => (await spy(page)).recv.filter((m) => m.includes("browser_relay_frame")).length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(5);

    // Closing the pane tab unmounts the body → the cleanup unsubscribe.
    await page.getByTestId("editor-tab").first().getByRole("button").click();
    await expect(page.getByTestId("browser-pane-tab")).toHaveCount(0, { timeout: 30_000 });
    await expect
      .poll(async () => (await spy(page)).sent.filter((m) => m.includes("browser_relay_unsubscribe")).length, { timeout: 30_000 })
      .toBeGreaterThan(0);

    // Leave the container enabled for any later spec.
    await request.put("/api/browser/enabled", { data: { enabled: true } });
  });

  test("F14: editor_tab_open acts only on the session's own route", async ({ page, request }) => {
    await installWsSpy(page);
    await request.put("/api/browser/enabled", { data: { enabled: true } });
    const instanceId = await fakeInstanceId(request);
    const sessionId = await selectSession(page);
    const path = `browser:${instanceId}:1`;
    const announce = (sid: string) =>
      page.evaluate(
        ([id, p]) => window.dispatchEvent(new CustomEvent("editor-tab-open", { detail: { sessionId: id, path: p } })),
        [sid, path] as const,
      );

    // Another session's announcement: this client stays where it is.
    const before = page.url();
    await announce("some-other-session");
    await page.waitForTimeout(500);
    expect(page.url()).toBe(before);
    await expect(page.getByTestId("browser-pane-tab")).toHaveCount(0);

    // Its own session: opens/focuses the tab.
    await announce(sessionId);
    await expect(page.getByTestId("browser-pane-tab")).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toContain("tab=");

    // Off the session routes (settings overlay): ignored, no navigation.
    await page.getByTestId("settings-btn").click();
    await page.getByTestId("settings-content").waitFor({ state: "visible", timeout: 15_000 });
    const settingsUrl = page.url();
    await announce(sessionId);
    await page.waitForTimeout(500);
    expect(page.url()).toBe(settingsUrl);
  });

  test("F15: a persisted plugin tab whose prefix has no enabled claim shows the unavailable placeholder; Close removes it", async ({
    page,
    request,
  }) => {
    await installWsSpy(page);
    await request.put("/api/browser/enabled", { data: { enabled: true } });
    const instanceId = await fakeInstanceId(request);
    const sessionId = await selectSession(page);
    await openFromBadge(page, instanceId); // reveals the split and persists the pane

    // The relay-fake harness FORCES the browser plugin on (PI_BROWSER_RELAY_FAKE),
    // so the plugin cannot be disabled here. "Plugin gone" is the same state as
    // "prefix with no enabled claim": persist a tab for an unclaimed prefix.
    const key = `pi-dashboard:editor-pane:${sessionId}`;
    await page.evaluate(
      (k) =>
        localStorage.setItem(
          k,
          JSON.stringify({ openFiles: [{ path: "gone:x", viewer: "plugin", addedAt: 1 }], activeIndex: 0, treeOpenRoots: [] }),
        ),
      key,
    );
    await page.goto(`/session/${encodeURIComponent(sessionId)}`);
    const placeholder = page.getByTestId("plugin-tab-unavailable");
    await expect(placeholder).toBeVisible({ timeout: 60_000 });
    await expect(placeholder).toContainText("gone");
    await placeholder.getByRole("button", { name: /close/i }).click();
    await expect(placeholder).toHaveCount(0);
    const persisted = await page.evaluate((k) => localStorage.getItem(k), key);
    expect(persisted ?? "").not.toContain("gone:x");
  });

  test("F17: an agent's browser_show_in_pane opens the tab in that session's pane; re-open after close works", async ({
    page,
    request,
  }) => {
    await installWsSpy(page);
    await request.put("/api/browser/enabled", { data: { enabled: true } });
    const instanceId = await fakeInstanceId(request);
    await selectSession(page);
    const prompt = `[[faux:browser-show-in-pane]] ${instanceId}`;
    const send = () => sendPrompt(page, prompt);
    await send();
    await expect(page.getByTestId("browser-pane-tab")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("editor-tab").first()).toHaveAttribute("data-tab-path", `browser:${instanceId}:1`);

    await page.getByTestId("editor-tab").first().getByRole("button").click();
    await expect(page.getByTestId("browser-pane-tab")).toHaveCount(0, { timeout: 30_000 });
    // The relay rate limit is 5 s per (session, instance): wait it out, then re-open.
    await page.waitForTimeout(5_500);
    await send();
    await expect(page.getByTestId("browser-pane-tab")).toBeVisible({ timeout: 60_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plugin LOAD, not relay behaviour.
// See change: fix-browser-plugin-vendor-specifier-resolution (test-plan F1).
//
// The symptom that opened that change was THIS row rendering `error`:
// `Failed to load plugin "browser": Cannot find module '@isomorphic/manualPromise'`.
// The vendored relay's playwright-internal specifiers resolved only through
// tsconfig `paths` + a vitest `resolve.alias` + JITI_TSCONFIG_PATHS, and an
// npm / managed / Electron install has none of them. Typecheck, vitest and the
// old X14 integrity test were all GREEN while production was broken, because
// each supplied its own alias — which is why the assertion here is on the
// RENDERED status the operator sees, on a harness whose plugin the real loader
// loaded with no alias layer anywhere.
test.describe("browser relay — plugin load (F1 of the vendor-specifier fix)", () => {
  // Plugin status arrives over the bus on a seeded harness that saturates the
  // browser's per-origin connection pool; see `gotoSettings` above.
  test.setTimeout(180_000);

  test("F1: the browser row converges to enabled, with no error badge", async ({ page }) => {
    await gotoDashboard(page);
    await page.getByTestId("settingsBtn").click();
    await page.getByTestId("settingsContent").waitFor({ state: "visible", timeout: 15_000 });
    await page
      .getByTestId("settings-nav-rail")
      .getByRole("button", { name: "Plugins", exact: true })
      .click();
    await page.getByTestId("plugins-section").waitFor({ state: "visible", timeout: 15_000 });

    const row = page.getByTestId("plugin-row-browser");
    await expect(row).toBeVisible({ timeout: 30_000 });

    // The regression's own face: a failed load renders a copyable error block
    // naming the unresolvable specifier. Its absence is the load-side contract.
    await expect(page.getByTestId("plugin-status-error-browser")).toHaveCount(0);
    await expect(page.getByTestId("plugin-toggle-error-browser")).toHaveCount(0);

    // StatusPill's order is error -> !enabled -> !loaded -> enabled, so the
    // `enabled` pill is only reachable when the plugin is BOTH enabled in config
    // AND loaded at runtime — the two facts the harness's fake faucet supplies.
    await expect(row.getByText("enabled", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(row.getByText("error", { exact: true })).toHaveCount(0);
    await expect(row.getByText("not loaded", { exact: true })).toHaveCount(0);
  });
});
