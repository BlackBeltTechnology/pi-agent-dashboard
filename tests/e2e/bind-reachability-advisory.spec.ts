import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for the bind-vs-trust reachability advisory
 * (change: warn-unreachable-trusted-networks). Covers test-plan rows F1–F19
 * plus X5 and X6.
 *
 * These live at L3 rather than in a jsdom component test because every row is a
 * CONVERGENCE property of the rendered app: the advisory has to appear or
 * disappear in response to a draft edit, a WS push, or a reconnect, without a
 * save, a reload, or a panel reopen. A component test can only assert the
 * render given a prop — it cannot show that the prop reaches the component
 * through the real config fetch, the real message bus, and the real router.
 *
 * `reachability` is injected by MERGING into the live `GET /api/config`
 * response rather than replacing it: the panel reads dozens of unrelated keys,
 * and a hand-built stub would drift from the server's shape and start passing
 * for the wrong reason. The harness port comes from the Playwright baseURL,
 * derived by docker/test-up.sh into .pi-test-harness.json — never hardcoded.
 */

interface ReachabilityStub {
  resolvedBindHost: string;
  pendingBindHost: string;
  unreachable: string[];
  bindHostSource?: "flag" | "env" | "config" | "default";
}

/**
 * Merge `reachability` (and optional trusted entries) into the real config
 * response. Must be installed BEFORE the panel's fetch, i.e. before navigation.
 */
async function stubConfig(
  page: Page,
  opts: {
    reachability?: ReachabilityStub | null;
    bypassHosts?: string[];
    trustedNetworks?: string[];
    bindHost?: string;
  },
) {
  await page.route("**/api/config", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    if (body?.data) {
      if (opts.reachability !== undefined) body.data.reachability = opts.reachability;
      if (opts.bindHost !== undefined) body.data.bindHost = opts.bindHost;
      // The harness container seeds its own trusted entries and providers, and
      // the predicate reads the UNION of both trust sources — so a stub that
      // sets only `auth.bypassHosts` would be scored against the container's
      // leftovers and the advisory would fire for the wrong reason. Normalise
      // the whole guard surface, always.
      body.data.trustedNetworks = opts.trustedNetworks ?? [];
      if (opts.bypassHosts !== undefined) {
        // `providers` must be present (the Security page indexes it directly)
        // and EMPTY (the all-interfaces exposure warning is gated on it).
        body.data.auth = { secret: "", providers: {}, bypassHosts: opts.bypassHosts };
      }
    }
    await route.fulfill({ response, json: body });
  });
}

/** Stub the interface enumeration the Add Local Network dropdown consumes. */
async function stubInterfaces(
  page: Page,
  data: unknown[] | { status: number },
) {
  await page.route("**/api/network-interfaces", async (route) => {
    if (Array.isArray(data)) {
      await route.fulfill({ json: { success: true, data } });
    } else {
      await route.fulfill({ status: data.status, json: { success: false, error: "boom" } });
    }
  });
}

async function openSettings(page: Page) {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
}

async function railGoto(page: Page, label: string) {
  await page.getByTestId("settings-nav-rail").getByRole("button", { name: label, exact: true }).click();
}

async function openSecurity(page: Page) {
  await openSettings(page);
  await railGoto(page, "Security");
  await expect(page.getByTestId("settings-content")).toBeVisible();
}

const LOOPBACK: ReachabilityStub = {
  resolvedBindHost: "127.0.0.1",
  pendingBindHost: "127.0.0.1",
  unreachable: ["192.168.1.0/24"],
};

const ALL_INTERFACES: ReachabilityStub = {
  resolvedBindHost: "0.0.0.0",
  pendingBindHost: "0.0.0.0",
  unreachable: [],
};

const advisory = (page: Page) => page.getByTestId("unreachable-trusted-networks-advisory");

test.describe("bind-vs-trust reachability advisory", () => {
  // test-plan #F1
  test("shows the advisory naming the bind host and the unreachable entry", async ({ page }) => {
    await stubConfig(page, { reachability: LOOPBACK, bindHost: "127.0.0.1", bypassHosts: ["192.168.1.0/24"] });
    await openSecurity(page);
    await expect(advisory(page)).toBeVisible();
    await expect(advisory(page)).toContainText("127.0.0.1");
    await expect(advisory(page)).toContainText("192.168.1.0/24");
  });

  // test-plan #F2 — the same trusted entries under 0.0.0.0 are reachable.
  test("hides the advisory for an all-interfaces bind", async ({ page }) => {
    await stubConfig(page, { reachability: ALL_INTERFACES, bindHost: "0.0.0.0", bypassHosts: ["192.168.1.0/24"] });
    await openSecurity(page);
    await expect(advisory(page)).toHaveCount(0);
  });

  // test-plan #F3 — the predicate is recomputed from the DRAFT, so the advisory
  // converges on an unsaved edit. A server-only computation would need a save.
  test("converges to visible when an unreachable entry is added but not saved", async ({ page }) => {
    await stubConfig(page, {
      reachability: { resolvedBindHost: "127.0.0.1", pendingBindHost: "127.0.0.1", unreachable: [] },
      bindHost: "127.0.0.1",
      bypassHosts: [],
    });
    await openSecurity(page);
    await expect(advisory(page)).toHaveCount(0);

    await page.getByTestId("trusted-networks-manual-input").fill("192.168.1.0/24");
    await page.getByTestId("trusted-networks-manual-add").click();

    await expect(advisory(page)).toBeVisible();
    await expect(advisory(page)).toContainText("192.168.1.0/24");
  });

  // test-plan #F4 — the inline remediation writes only the DRAFT bindHost.
  test("converges to absent when the inline listen-on-all control is used, without writing config", async ({ page }) => {
    let configWrites = 0;
    await page.route("**/api/config", async (route) => {
      if (route.request().method() === "PUT") configWrites++;
      return route.fallback();
    });
    await stubConfig(page, { reachability: LOOPBACK, bindHost: "127.0.0.1", bypassHosts: ["192.168.1.0/24"] });
    await openSecurity(page);
    await expect(advisory(page)).toBeVisible();

    await page.getByTestId("unreachable-advisory-listen-all").click();

    await expect(advisory(page)).toHaveCount(0);
    expect(configWrites).toBe(0);
  });

  // test-plan #F5 — the settings-panel page-attribution exception: the control
  // writes a Server key from the Security page and the dirty chip must still
  // say Server, which the advisory told the user before the write.
  test("attributes the inline write to the Server page in the dirty state", async ({ page }) => {
    await stubConfig(page, { reachability: LOOPBACK, bindHost: "127.0.0.1", bypassHosts: ["192.168.1.0/24"] });
    await openSecurity(page);
    await page.getByTestId("unreachable-advisory-listen-all").click();

    // The dirty dot lands on SERVER, not Security. That is the whole point of
    // the settings-panel exception: the chip is not re-attributed, and it is
    // now correct rather than confusing because the advisory said so first.
    await expect(page.getByTestId("nav-dirty-server")).toBeVisible();
    await expect(page.getByTestId("nav-dirty-security")).toHaveCount(0);
  });

  // test-plan #F6 — the picker itself stays on its own page.
  test("offers a link to Server without rendering the listen-interface picker on Security", async ({ page }) => {
    await stubConfig(page, { reachability: LOOPBACK, bindHost: "127.0.0.1", bypassHosts: ["192.168.1.0/24"] });
    await openSecurity(page);
    await expect(advisory(page)).toBeVisible();
    await expect(page.getByTestId("listen-interface-field")).toHaveCount(0);
    await expect(page.getByTestId("unreachable-advisory-server-link")).toBeVisible();
  });

  // test-plan #F7 — navigation must not discard the unsaved Security edits.
  test("navigates to the Server page keeping unsaved Security edits", async ({ page }) => {
    await stubConfig(page, {
      reachability: { resolvedBindHost: "127.0.0.1", pendingBindHost: "127.0.0.1", unreachable: [] },
      bindHost: "127.0.0.1",
      bypassHosts: [],
    });
    await openSecurity(page);
    await page.getByTestId("trusted-networks-manual-input").fill("192.168.1.0/24");
    await page.getByTestId("trusted-networks-manual-add").click();
    await expect(advisory(page)).toBeVisible();

    await page.getByTestId("unreachable-advisory-server-link").click();
    await expect(page).toHaveURL(/\/settings\/server/);
    await expect(page.getByTestId("listen-interface-field")).toBeVisible();

    // The unsaved Security edit survives the navigation — the panel is one
    // mounted component sharing a draft across pages, so the link is a page
    // change, not a remount that would silently discard the entry. Observed
    // through the rail's per-page dirty dot, which is driven by the live draft
    // diff rather than by anything this test set up.
    await expect(page.getByTestId("nav-dirty-security")).toBeVisible();
  });

  // test-plan #F8 — the two banners are INDEPENDENT, not mutually exclusive.
  // With a specific-NIC bind, a peer on that NIC IS accepted by the socket,
  // denied by the guard, and recorded — so both render, advisory first.
  test("renders both the advisory and the block-event banner, advisory above", async ({ page }) => {
    await page.route("**/api/tunnel/block-events", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: { events: [{ ip: "10.0.0.9", count: 1, trustable: true, proxied: false, at: Date.now() }] },
        },
      }),
    );
    await stubConfig(page, {
      reachability: { resolvedBindHost: "10.0.0.5", pendingBindHost: "10.0.0.5", unreachable: ["192.168.1.0/24"] },
      bindHost: "10.0.0.5",
      bypassHosts: ["192.168.1.0/24"],
    });
    await openSecurity(page);

    await expect(advisory(page)).toBeVisible();
    await expect(page.getByTestId("block-event-banner")).toBeVisible();

    const order = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="unreachable-trusted-networks-advisory"]');
      const b = document.querySelector('[data-testid="block-event-banner"]');
      if (!a || !b) return null;
      return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(order).toBe(true);
  });

  // test-plan #F9
  test("places the advisory between the section description and the entry list", async ({ page }) => {
    await stubConfig(page, { reachability: LOOPBACK, bindHost: "127.0.0.1", bypassHosts: ["192.168.1.0/24"] });
    await openSecurity(page);
    const placed = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="unreachable-trusted-networks-advisory"]');
      const list = document.querySelector('[data-testid="trusted-networks-list"]');
      if (!a || !list) return null;
      const description = a.parentElement?.querySelector("p");
      const beforeList = (a.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      const afterDescription =
        !!description && (description.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      return beforeList && afterDescription;
    });
    expect(placed).toBe(true);
  });

  // test-plan #F10 — a saved-but-unapplied bindHost is signalled through the
  // header's EXISTING Restart affordance, not a new notice component.
  test("indicates a pending restart when the saved bind host is not the bound one", async ({ page }) => {
    await stubConfig(page, {
      reachability: { resolvedBindHost: "127.0.0.1", pendingBindHost: "0.0.0.0", unreachable: [] },
      bindHost: "0.0.0.0",
    });
    await openSettings(page);
    await expect(page.getByTestId("settings-restart-button")).toHaveAttribute("data-restart-pending", "true");
    await expect(page.getByTestId("settings-restart-pending-dot")).toBeVisible();
  });

  // test-plan #F11 — and clears once the restart has applied it.
  test("clears the pending-restart indication once the bound host matches", async ({ page }) => {
    await stubConfig(page, { reachability: ALL_INTERFACES, bindHost: "0.0.0.0" });
    await openSettings(page);
    await expect(page.getByTestId("settings-restart-button")).toHaveAttribute("data-restart-pending", "false");
    await expect(page.getByTestId("settings-restart-pending-dot")).toHaveCount(0);
  });

  // test-plan #F12 / #F13 / #X6 — a server-side change converges with no reload
  // and no panel reopen, and a browser that was disconnected while it happened
  // converges on reconnect via the connect-time replay.
  //
  // Injected through a WS proxy rather than a `window` hook: the point of the
  // row is that the frame travels the REAL socket into the real message
  // handler, which a hook on the app's internals would bypass.
  test("converges on a pushed reachability change without a reload", async ({ page }) => {
    const pushRef: { fn: ((payload: unknown) => void) | null } = { fn: null };
    await page.routeWebSocket(/.*/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => ws.send(m));
      pushRef.fn = (payload) => ws.send(JSON.stringify(payload));
    });

    await stubConfig(page, { reachability: LOOPBACK, bindHost: "127.0.0.1", bypassHosts: ["192.168.1.0/24"] });
    await openSecurity(page);
    await expect(advisory(page)).toBeVisible();

    expect(pushRef.fn).not.toBeNull();
    pushRef.fn?.({
      type: "reachability_updated",
      reachability: { resolvedBindHost: "127.0.0.1", pendingBindHost: "0.0.0.0", unreachable: [] },
    });

    await expect(advisory(page)).toHaveCount(0);
  });

  // test-plan #F13 / #X6 — the connect-time replay. A socket that opens AFTER
  // the change still receives the current value, so a client that was
  // disconnected while `pendingBindHost` moved does not sit on a stale
  // advisory until the next reload.
  test("receives the current reachability on a socket that connects afterwards", async ({ page }) => {
    const replayed: unknown[] = [];
    await page.routeWebSocket(/.*/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => {
        if (typeof m === "string" && m.includes("reachability_updated")) {
          try { replayed.push(JSON.parse(m)); } catch { /* not ours */ }
        }
        ws.send(m);
      });
    });

    await openSecurity(page);
    await expect(page.getByTestId("trusted-networks-add-local")).toBeVisible();

    await expect
      .poll(() => replayed.length, { timeout: 20_000 })
      .toBeGreaterThan(0);
    const first = replayed[0] as { reachability?: { resolvedBindHost?: string } };
    expect(typeof first.reachability?.resolvedBindHost).toBe("string");
  });

  // Both remediations write `config.bindHost`, which `--host` and
  // `PI_DASHBOARD_HOST` outrank. Offering them under either would hand the user
  // a fix that silently does nothing and an advisory that never clears — so
  // they are replaced by an explanation naming the real source.
  for (const source of ["flag", "env"] as const) {
    test(`suppresses both remediations when the bind host comes from the ${source}`, async ({ page }) => {
      await stubConfig(page, {
        reachability: { ...LOOPBACK, bindHostSource: source },
        bindHost: "127.0.0.1",
        bypassHosts: ["192.168.1.0/24"],
      });
      await openSecurity(page);

      await expect(advisory(page)).toBeVisible();
      await expect(page.getByTestId("unreachable-advisory-listen-all")).toHaveCount(0);
      await expect(page.getByTestId("unreachable-advisory-server-link")).toHaveCount(0);

      const explanation = page.getByTestId("unreachable-advisory-shadowed");
      await expect(explanation).toBeVisible();
      await expect(explanation).toContainText(source === "flag" ? "--host" : "PI_DASHBOARD_HOST");
    });
  }

  // …and the config-governed case still offers them, so the assertion above
  // cannot pass merely because the buttons were removed altogether.
  test("still offers both remediations when config.bindHost governs", async ({ page }) => {
    await stubConfig(page, {
      reachability: { ...LOOPBACK, bindHostSource: "config" },
      bindHost: "127.0.0.1",
      bypassHosts: ["192.168.1.0/24"],
    });
    await openSecurity(page);

    await expect(page.getByTestId("unreachable-advisory-listen-all")).toBeVisible();
    await expect(page.getByTestId("unreachable-advisory-server-link")).toBeVisible();
    await expect(page.getByTestId("unreachable-advisory-shadowed")).toHaveCount(0);
  });

  // test-plan #F14 — a Tailscale /32 must offer the containing CGNAT range,
  // marked wide, and never `<self>/32`, which trusts nobody new.
  test("offers the containing range for a tailnet interface, marked wide, never <self>/32", async ({ page }) => {
    await stubInterfaces(page, [
      {
        name: "utun4",
        address: "100.97.246.31",
        netmask: "255.255.255.255",
        cidr: "100.97.246.31/32",
        label: "tailnet",
        pointToPoint: true,
        suggestions: [{ value: "100.64.0.0/10", label: "tailnet CGNAT range", wide: true }],
      },
    ]);
    await stubConfig(page, { reachability: ALL_INTERFACES, bindHost: "0.0.0.0" });
    await openSecurity(page);

    await page.getByTestId("trusted-networks-add-local").click();
    const offer = page.getByTestId("trusted-networks-offer-100.64.0.0/10");
    await expect(offer).toBeVisible();
    await expect(offer).toHaveAttribute("data-wide", "true");
    await expect(offer).toContainText("tailnet");
    await expect(page.getByTestId("trusted-networks-dropdown")).not.toContainText("100.97.246.31/32");
  });

  // test-plan #F15 — an unofferable /32 is SHOWN with an explanation, not
  // silently omitted; omitting it reproduces the original complaint elsewhere.
  test("shows a non-selectable row with an explanation for an underivable /32", async ({ page }) => {
    await stubInterfaces(page, [
      {
        name: "utun9",
        address: "203.0.113.7",
        netmask: "255.255.255.255",
        cidr: "203.0.113.7/32",
        label: "utun9",
        pointToPoint: true,
        suggestions: [],
      },
    ]);
    await stubConfig(page, { reachability: ALL_INTERFACES, bindHost: "0.0.0.0" });
    await openSecurity(page);

    await page.getByTestId("trusted-networks-add-local").click();
    const row = page.getByTestId("trusted-networks-unofferable-utun9");
    await expect(row).toBeVisible();
    await expect(row).toContainText("203.0.113.7");
    await expect(row.locator("button")).toHaveCount(0);
  });

  // test-plan #F16 — the endpoint's second consumer must keep every address.
  test("keeps both addresses of one subnet selectable in the listen-interface picker", async ({ page }) => {
    await stubInterfaces(page, [
      {
        name: "en0", address: "192.168.10.123", netmask: "255.255.255.0", cidr: "192.168.10.0/24",
        label: "en0", pointToPoint: false,
        suggestions: [{ value: "192.168.10.0/24", label: "interface subnet 192.168.10.0/24", wide: false }],
      },
      {
        name: "en7", address: "192.168.10.224", netmask: "255.255.255.0", cidr: "192.168.10.0/24",
        label: "en7", pointToPoint: false,
        suggestions: [{ value: "192.168.10.0/24", label: "interface subnet 192.168.10.0/24", wide: false }],
      },
    ]);
    await stubConfig(page, { reachability: ALL_INTERFACES, bindHost: "0.0.0.0" });
    await openSettings(page);
    await railGoto(page, "Server");

    await page.getByRole("radio", { name: /Specific interface/ }).check();
    const select = page.getByTestId("listen-interface-select");
    await expect(select).toBeVisible();
    const values = await select.locator("option").evaluateAll((els) =>
      els.map((e) => (e as HTMLOptionElement).value),
    );
    expect(values).toContain("192.168.10.123");
    expect(values).toContain("192.168.10.224");
  });

  // test-plan #F18 — the opposite-direction warning is unweakened.
  test("keeps the all-interfaces exposure warning for an unguarded 0.0.0.0 bind", async ({ page }) => {
    await stubConfig(page, {
      reachability: ALL_INTERFACES,
      bindHost: "0.0.0.0",
      bypassHosts: [],
    });
    await openSettings(page);
    await railGoto(page, "Server");
    await expect(page.getByTestId("listen-exposure-warning")).toBeVisible();
  });

  // test-plan #F19 — the condition can arise while the section is on screen, so
  // the advisory's appearance must be ANNOUNCED, not silently painted.
  test("announces the advisory as a status message when it appears", async ({ page }) => {
    await stubConfig(page, {
      reachability: { resolvedBindHost: "127.0.0.1", pendingBindHost: "127.0.0.1", unreachable: [] },
      bindHost: "127.0.0.1",
      bypassHosts: [],
    });
    await openSecurity(page);
    await page.getByTestId("trusted-networks-manual-input").fill("192.168.1.0/24");
    await page.getByTestId("trusted-networks-manual-add").click();

    const live = advisory(page);
    await expect(live).toBeVisible();
    await expect(live).toHaveAttribute("role", "status");
    await expect(live).toHaveAttribute("aria-live", "polite");
  });

  // test-plan #X5 — a failed enumeration degrades the dropdown, never the section.
  test("degrades the dropdown without breaking the section when the endpoint fails", async ({ page }) => {
    await stubInterfaces(page, { status: 500 });
    await stubConfig(page, { reachability: ALL_INTERFACES, bindHost: "0.0.0.0" });
    await openSecurity(page);

    await page.getByTestId("trusted-networks-add-local").click();
    await expect(page.getByTestId("trusted-networks-dropdown")).toHaveCount(0);

    // Manual entry is still usable — the escape hatch survives the failure.
    await page.getByTestId("trusted-networks-manual-input").fill("192.168.5.0/24");
    await page.getByTestId("trusted-networks-manual-add").click();
    await expect(page.getByTestId("trusted-networks-list")).toContainText("192.168.5.0/24");
  });
});
