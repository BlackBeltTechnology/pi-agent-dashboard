import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";
import {
  CANARY_DIR_IN_CONTAINER,
  CANARY_ID,
  collectConsoleErrors,
  containerSh,
  countLoads,
  ensureCanaryState,
  forwardTrustThroughContainer,
  pluginRow,
  revokePlugin,
  runtimeListing,
  trustPlugin,
  VARIANT_IDS,
  variantsStaged,
  waitForCanaryEntry,
} from "./helpers/runtime-canary.js";

/**
 * L3 — runtime plugin client loading (change: decouple-plugins-from-core; test-plan #F7–#F10, #F12, #F15, #F16, #X11).
 *
 * The harness stages the prebuilt runtime canary (`tests/fixtures/runtime-canary-plugin`, built once by
 * `scripts/build-runtime-canary.mjs`) into `~/.pi/dashboard/plugins/` and, in the default `trusted` mode, pins its
 * content hash in `auth.trustedPlugins` before boot (docker/test-up.sh, task 7.5). Each scenario reads the REAL server
 * state and, when it needs the other trust state, flips it through the real trust endpoints and restores it. Files run
 * serially on one worker, so the shared trust state is never raced.
 *
 * X11 needs the failure variants, which the harness stages only in `PI_E2E_CANARY=untrusted` mode (task 8.2).
 */

/** Hard-navigate (full document load) and wait for the settings rail. */
async function gotoSettings(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
}

/** Move between settings pages through the rail, in the SAME document. */
async function railGoto(page: Page, label: string) {
  await page.getByTestId("settings-nav-rail").getByRole("button", { name: label, exact: true }).click();
}

test.describe("runtime plugin client loading", () => {
  test.afterEach(async ({ request }) => {
    await ensureCanaryState(request, "trusted").catch(() => {});
  });

  test("F7: a trusted runtime plugin never trips the staleness banner; bundleHash == served build hash", async ({ page, request }) => {
    await ensureCanaryState(request, "trusted");
    // Anti-vacuity: the canary really is delivered at runtime.
    expect((await runtimeListing(request)).map((p) => p.id)).toContain(CANARY_ID);

    const health = async () =>
      (await (await request.get("/api/health")).json()) as { bundleHash?: string; clientBuild?: { pluginRegistryHash: string | null; status: string } };
    const withCanary = await health();
    expect(withCanary.clientBuild?.status).toBe("matched");
    expect(withCanary.bundleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(withCanary.bundleHash).toBe(withCanary.clientBuild?.pluginRegistryHash);

    const probe = page.waitForResponse((r) => r.url().includes("/api/health") && r.status() === 200, { timeout: 20_000 });
    const entry = waitForCanaryEntry(page);
    await gotoDashboard(page);
    await probe;
    await entry; // the browser actually loaded the runtime plugin
    await expect(page.getByTestId("plugin-staleness-banner")).toHaveCount(0);

    // Revoking the runtime plugin must not move the build-time hash either: it is not part of the registry hash.
    await revokePlugin(request, CANARY_ID);
    expect((await health()).bundleHash).toBe(withCanary.bundleHash);
  });

  test("F8: an untrusted canary is refused visibly (path + full hash), Trust makes its claim appear live", async ({ page, request }) => {
    await ensureCanaryState(request, "untrusted");
    const loads = countLoads(page);
    const assetRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes(`/plugin-assets/${CANARY_ID}`)) assetRequests.push(r.url());
    });
    await forwardTrustThroughContainer(page, CANARY_ID);

    await gotoSettings(page, "/settings/plugins");
    await expect(page.getByTestId("plugins-section")).toBeVisible();
    const row = page.getByTestId(`plugin-row-${CANARY_ID}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`plugin-client-refused-${CANARY_ID}`)).toContainText("untrusted");
    await expect(page.getByTestId(`plugin-trust-path-${CANARY_ID}`)).toContainText(CANARY_ID);
    await expect(page.getByTestId(`plugin-trust-hash-${CANARY_ID}`)).toContainText(/[0-9a-f]{64}/);
    await expect(page.getByTestId(`plugin-trust-${CANARY_ID}`)).toBeVisible();
    // The claim is absent and nothing was fetched from the plugin's asset path.
    await expect(page.getByTestId("canary-settings")).toHaveCount(0);
    expect(assetRequests).toEqual([]);
    const loadsBefore = loads.count;

    await page.getByTestId(`plugin-trust-${CANARY_ID}`).click();

    // After `plugins_changed` the runtime loader registers the claim: open the plugin's page in the SAME document.
    await expect(page.getByTestId(`plugin-revoke-${CANARY_ID}`)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`plugin-expand-${CANARY_ID}`).click();
    await expect(page.getByTestId("canary-settings")).toBeVisible({ timeout: 30_000 });
    expect(loads.count).toBe(loadsBefore);
  });

  test("F9: one React instance — useState and a host-context hook both work, no Invalid hook call", async ({ page, request }) => {
    await ensureCanaryState(request, "trusted");
    const errors = collectConsoleErrors(page);
    await gotoSettings(page, `/settings/plugins/${CANARY_ID}`);
    await expect(page.getByTestId("canary-settings")).toBeVisible({ timeout: 30_000 });
    // `useShellConnectionStatus()` returns the host's live status, not the "disconnected" no-provider fallback.
    await expect(page.getByTestId("canary-conn-status")).toContainText("connected", { timeout: 20_000 });
    await expect(page.getByTestId("canary-conn-status")).not.toContainText("disconnected");
    // `useState` runs on the host's renderer.
    await page.getByTestId("canary-clicks").click();
    await expect(page.getByTestId("canary-clicks")).toHaveText("1");
    expect(errors.filter((e) => /Invalid hook call/i.test(e))).toEqual([]);
  });

  test("F10: a late listing still renders; the settings section stays on its owner's page", async ({ page, request }) => {
    await ensureCanaryState(request, "trusted");
    await page.route("**/api/plugins/runtime-clients", async (route) => {
      await new Promise((r) => setTimeout(r, 2_000));
      await route.continue();
    });
    await gotoSettings(page, `/settings/plugins/${CANARY_ID}`);
    // No user action: the claim appears once the delayed listing resolves and the loader registers the entry.
    await expect(page.getByTestId("canary-settings")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("canary-lazy-panel")).toBeVisible({ timeout: 30_000 });

    await railGoto(page, "Developer");
    await expect(page.getByTestId("settings-content")).toBeVisible();
    await expect(page.getByTestId("canary-settings")).toHaveCount(0);
    await expect(page.getByTestId("canary-lazy-panel")).toHaveCount(0);
  });

  test("F12a: runtime revoke is immediate for new loads; the loaded claim stays, with a reload notice", async ({ page, request }) => {
    await ensureCanaryState(request, "trusted");
    const [listed] = (await runtimeListing(request)).filter((p) => p.id === CANARY_ID);
    expect(listed, "canary in the runtime listing").toBeTruthy();
    expect((await request.get(listed.entry)).status()).toBe(200);

    await gotoSettings(page, `/settings/plugins/${CANARY_ID}`);
    await expect(page.getByTestId("canary-settings")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("runtime-plugin-reload-notice")).toHaveCount(0);

    await revokePlugin(request, CANARY_ID);

    // New loads: the listing omits it and its asset path is gone.
    expect((await runtimeListing(request)).map((p) => p.id)).not.toContain(CANARY_ID);
    expect((await request.get(listed.entry)).status()).toBe(404);
    // The already-loaded module keeps working until a reload; the shell says a reload is needed.
    await expect(page.getByTestId("runtime-plugin-reload-notice")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("canary-settings")).toBeVisible();
  });

  test("F12b: after the bundle is rebuilt the old lazy chunk 404s, its claim is contained, the shell stays interactive", async ({ page, request }) => {
    await ensureCanaryState(request, "trusted");
    const errors = collectConsoleErrors(page);
    const chunkStatuses: number[] = [];
    page.on("response", (r) => {
      if (r.url().includes(`/plugin-assets/${CANARY_ID}/`) && r.url().endsWith("/lazy-panel.js")) chunkStatuses.push(r.status());
    });

    // Canary loaded (entry imported) but its lazy claim NOT rendered: we are on the Plugins list, not the canary's page.
    const entry = waitForCanaryEntry(page);
    await gotoSettings(page, "/settings/plugins");
    await entry;
    expect(chunkStatuses).toEqual([]);

    const lazyFile = `${CANARY_DIR_IN_CONTAINER}/dist/client/lazy-panel.js`;
    containerSh(`cp ${lazyFile} /tmp/lazy-panel.orig && printf '\\n// rebuilt\\n' >> ${lazyFile}`);
    try {
      // "Rebuilt": the content hash moved. Re-pin the NEW hash so the server admits the new build (ONE plugins_changed).
      const stale = await pluginRow(request, CANARY_ID);
      expect(stale?.status?.client?.refusedReason).toBe("pin-mismatch");
      await trustPlugin(request, CANARY_ID);
      await expect(page.getByTestId("runtime-plugin-reload-notice")).toBeVisible({ timeout: 30_000 });

      // Open the lazy claim: it imports the OLD-hash chunk URL → 404 → contained by its boundary.
      await page.getByTestId(`plugin-expand-${CANARY_ID}`).click();
      await expect.poll(() => chunkStatuses, { timeout: 30_000 }).toContain(404);
      await expect(page.getByTestId("canary-lazy-panel")).toHaveCount(0);
      await expect.poll(() => errors.some((e) => /slot-error-boundary|runtime-canary/.test(e)), { timeout: 15_000 }).toBe(true);
      // The shell is still interactive.
      await railGoto(page, "Developer");
      await expect(page.getByTestId("settings-content")).toBeVisible();
    } finally {
      containerSh(`cp /tmp/lazy-panel.orig ${lazyFile}`);
      await revokePlugin(request, CANARY_ID).catch(() => {});
      await trustPlugin(request, CANARY_ID);
    }
  });

  test("F15: plugin styles follow the host theme; the stylesheet attaches lazily; the SW passes assets through", async ({ page, request }) => {
    await ensureCanaryState(request, "trusted");
    const link = page.locator(`link[data-plugin-styles="${CANARY_ID}"]`);

    // The link attaches with the first render of ANY claim of the plugin (a folder-section claim can mount
    // with the sidebar, so "absent before the settings section" is not observable on a harness that has
    // folders; the never-before-render ordering is unit-covered in runtime-plugin-loader.test.tsx).
    const entry = waitForCanaryEntry(page);
    await gotoSettings(page, "/settings/plugins");
    await entry;

    // After a claim rendered: exactly one link (idempotent), pointing at the listed stylesheet.
    await page.getByTestId(`plugin-expand-${CANARY_ID}`).click();
    await expect(page.getByTestId("canary-settings")).toBeVisible({ timeout: 30_000 });
    await expect(link).toHaveCount(1);
    const [listedStyles] = (await runtimeListing(request)).filter((p) => p.id === CANARY_ID);
    expect(await link.getAttribute("href")).toBe(listedStyles.styles);

    // Theme A (dark, `:root`) → B (`[data-theme="light"]`): the element's resolved background follows the host's `--bg-surface`.
    const bgs: string[] = [];
    for (const theme of [null, "light"]) {
      await page.evaluate((t) => (t ? document.documentElement.setAttribute("data-theme", t) : document.documentElement.removeAttribute("data-theme")), theme);
      const { claim, expected } = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.background = "var(--bg-surface)";
        document.body.appendChild(probe);
        const expectedBg = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const el = document.querySelector('[data-testid="canary-settings"]') as HTMLElement;
        return { claim: getComputedStyle(el).backgroundColor, expected: expectedBg };
      });
      expect(claim).toBe(expected);
      bgs.push(claim);
    }
    expect(bgs[0], "the two themes resolve different surfaces (anti-vacuity)").not.toBe(bgs[1]);

    // Service worker pass-through: bytes + cache/encoding headers equal the direct server response.
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations())?.some((r) => r.active) ?? false), { timeout: 20_000 })
      .toBe(true);
    const [listed] = (await runtimeListing(request)).filter((p) => p.id === CANARY_ID);
    for (const url of [listed.entry, "/host/react.js"]) {
      const direct = await request.get(url);
      const viaPage = await page.evaluate(async (u) => {
        const r = await fetch(u);
        return { text: await r.text(), cache: r.headers.get("cache-control"), enc: r.headers.get("content-encoding") };
      }, url);
      expect(viaPage.text, `${url} bytes`).toBe(await direct.text());
      expect(viaPage.cache, `${url} cache-control`).toBe(direct.headers()["cache-control"] ?? null);
      expect(viaPage.enc, `${url} content-encoding`).toBe(direct.headers()["content-encoding"] ?? null);
    }
  });

  test("F16: an untrusted runtime client gets no client path, yet its server-driven intent UI still shows", async ({ page, request }) => {
    // The canary's server entry broadcasts its global intent only when armed (staged `untrusted` mode, task 8.2).
    test.skip(!(await variantsStaged(request)), "the intent broadcast is armed only with PI_E2E_CANARY=untrusted (task 8.2)");
    test.setTimeout(120_000);
    await ensureCanaryState(request, "untrusted");
    const assetRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes(`/plugin-assets/${CANARY_ID}`)) assetRequests.push(r.url());
    });
    // The intent is a global `settings-section` one (replayed on subscribe): it renders on the owning plugin's page.
    await gotoSettings(page, `/settings/plugins/${CANARY_ID}`);
    await expect(page.getByText("Runtime canary server is up.").first()).toBeVisible({ timeout: 30_000 });
    expect(assetRequests).toEqual([]);
    await expect(page.getByTestId("canary-settings")).toHaveCount(0);
  });

  test("X11: runtime plugin failures are contained — each failing variant renders nothing and names its id; the sibling renders", async ({ page, request }) => {
    test.skip(!(await variantsStaged(request)), "failure variants are staged only with PI_E2E_CANARY=untrusted (task 8.2)");
    test.setTimeout(180_000);
    await ensureCanaryState(request, "trusted");
    for (const id of VARIANT_IDS) await trustPlugin(request, id);
    try {
      const errors = collectConsoleErrors(page);
      const variantTestId: Record<(typeof VARIANT_IDS)[number], string> = {
        "runtime-canary-missing-export": "variant-missing-export",
        "runtime-canary-bundled-react": "variant-bundled-react",
        "runtime-canary-throws-in-render": "variant-throws-in-render",
        "runtime-canary-bundled-app-kit": "variant-bundled-app-kit",
      };
      for (const id of VARIANT_IDS) {
        const before = errors.length;
        await gotoSettings(page, `/settings/plugins/${id}`);
        // Wait for the loader pass: the sibling page renders only once the whole listing was processed.
        await page.waitForResponse((r) => r.url().includes("/api/plugins/runtime-clients"), { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(2_000); // fixed-tick-wait-ok: a NEGATIVE assertion (nothing renders) needs the loader/boundary to have run
        await expect(page.getByTestId(variantTestId[id])).toHaveCount(0);
        const mine = errors.slice(before).filter((e) => e.includes(id));
        expect(mine.length, `a console error names ${id}`).toBeGreaterThan(0);
      }
      // The sibling canary is unaffected.
      await gotoSettings(page, `/settings/plugins/${CANARY_ID}`);
      await expect(page.getByTestId("canary-settings")).toBeVisible({ timeout: 30_000 });
    } finally {
      for (const id of VARIANT_IDS) await revokePlugin(request, id).catch(() => {});
    }
  });
});
