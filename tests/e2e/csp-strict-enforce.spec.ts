import type { APIRequestContext, Response } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import {
  cspHeaders,
  enforcingNonce,
  importMapNonceInDom,
  importMapNonceOfHtml,
  installCspProbe,
  nonceSources,
  readCspProbe,
  scriptSrcOnly,
} from "./helpers/csp-strict.js";
import { byTestId } from "./helpers/index.js";
import { OperatorSession } from "./helpers/operator-session.js";
import { CANARY_ID, ensureCanaryState } from "./helpers/runtime-canary.js";

/**
 * L3 — the STRICT policy ENFORCED (change: harden-cors-and-csp-reporting; test-plan #WF2, #WF3, #WF6, #WF7;
 * spec baseline-content-security-policy). Needs a harness booted with `PI_DASHBOARD_CSP=enforce`:
 *
 *   PI_E2E_SEED=1 PI_DASHBOARD_CSP=enforce docker/test-up.sh -d --build
 *
 * The default harness is report-only, where nothing is blocked, so every test skips there instead of passing
 * vacuously. Exemplars: tests/e2e/runtime-plugin-csp-enforce.spec.ts, tests/e2e/api-not-found.spec.ts.
 */

const SKIP_MSG = "harness does not enforce the strict policy; boot it with PI_DASHBOARD_CSP=enforce";

/** Skip unless `/` carries an enforcing policy with a script nonce (the strict policy). */
async function requireEnforcingStrict(request: APIRequestContext): Promise<void> {
  const res = await request.get("/");
  test.skip(!(await enforcingNonce(res)), SKIP_MSG);
}

test.describe("strict CSP enforced", () => {
  test("WF2: shell and a runtime claim render under the strict policy; a blob import stays blocked", async ({ page, request }) => {
    await requireEnforcingStrict(request);
    await ensureCanaryState(request, "trusted");
    await installCspProbe(page);

    const res = await page.goto("/");
    expect(res).not.toBeNull();
    const enforcing = (await cspHeaders(res!)).enforcing.join(" ");
    const scriptSrc = /script-src([^;]*)/.exec(enforcing)?.[1] ?? "";
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "blob:", "data:"]) expect(scriptSrc, `script-src must not carry ${bad}`).not.toContain(bad);
    await expect(byTestId(page, "headerAppBar")).toBeVisible({ timeout: 30_000 });
    expect(await importMapNonceInDom(page), "import map nonce equals the header nonce").toBe(await enforcingNonce(res!));

    await page.goto(`/settings/plugins/${CANARY_ID}`);
    await expect(page.getByTestId("canary-settings")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("canary-settings")).toHaveCSS("border-top-style", "dashed");
    expect(await readCspProbe(page), "no violation while the shell and the claim render").toEqual([]);

    const blocked = await page.evaluate(async () => {
      try {
        await import(/* @vite-ignore */ URL.createObjectURL(new Blob(["export default 1"], { type: "text/javascript" })));
        return false;
      } catch {
        return true;
      }
    });
    expect(blocked, "blob: module import rejects").toBe(true);
    await expect.poll(async () => scriptSrcOnly(await readCspProbe(page)).length).toBe(1);
  });

  test("WF3: an inline script without the nonce is blocked; with the import map's nonce it runs", async ({ page, request }) => {
    await requireEnforcingStrict(request);
    await installCspProbe(page);
    await page.goto("/");
    await expect(byTestId(page, "headerAppBar")).toBeVisible({ timeout: 30_000 });
    const before = scriptSrcOnly(await readCspProbe(page)).length;

    await page.evaluate(() => {
      const s = document.createElement("script");
      s.textContent = "window.__a=1";
      document.head.appendChild(s);
    });
    await expect.poll(async () => scriptSrcOnly(await readCspProbe(page)).filter((e) => e.directive === "script-src-elem").length).toBe(before + 1);
    expect(await page.evaluate(() => (window as unknown as { __a?: number }).__a)).toBeUndefined();

    await page.evaluate(() => {
      const s = document.createElement("script");
      s.nonce = (document.querySelector("script[type=importmap]") as HTMLScriptElement).nonce;
      s.textContent = "window.__b=1";
      document.head.appendChild(s);
    });
    expect(await page.evaluate(() => (window as unknown as { __b?: number }).__b)).toBe(1);
    await page.waitForTimeout(500);
    expect(scriptSrcOnly(await readCspProbe(page)).length, "the nonce'd script adds no violation").toBe(before + 1);
  });

  test.describe("WF6: service worker allowed", () => {
    test.use({ serviceWorkers: "allow" });

    test("WF6: the header nonce matches the import-map nonce on every navigation, SW active", async ({ page, request }) => {
      test.setTimeout(120_000);
      await requireEnforcingStrict(request);
      await installCspProbe(page);

      const seen: string[] = [];
      const verify = async (res: Response | null, label: string, fresh: boolean) => {
        await expect(byTestId(page, "headerAppBar"), label).toBeVisible({ timeout: 30_000 });
        const dom = await importMapNonceInDom(page);
        expect(dom, `${label}: import map carries a nonce`).not.toBe("");
        if (res) expect(await enforcingNonce(res), `${label}: header nonce === document import-map nonce`).toBe(dom);
        if (fresh) seen.push(dom);
        expect(scriptSrcOnly(await readCspProbe(page)), `${label}: script-src violations`).toEqual([]);
      };

      await verify(await page.goto("/"), "first load", true);
      await expect
        .poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), { timeout: 30_000, message: "the PWA service worker registers" })
        .toBe(true);
      await page.evaluate(() => navigator.serviceWorker.ready);

      for (let i = 1; i <= 3; i++) await verify(await page.reload(), `reload ${i}`, true);

      // Two real document entries so back/forward are cross-document loads (a pushState hop returns no response).
      await verify(await page.goto("/settings/security"), "second document", true);
      await verify(await page.goBack(), "back", false);
      await verify(await page.goForward(), "forward", false);

      expect(new Set(seen).size, "every non-cached navigation minted a fresh nonce").toBe(seen.length);
    });
  });

  test("WF7: SPA fallback and deep links carry their own nonce; /api JSON 404 carries none", async ({ page, request, context }) => {
    test.setTimeout(120_000);
    await requireEnforcingStrict(request);
    const op = new OperatorSession();
    await op.arm(request, context);
    await installCspProbe(page);

    const links = ["/settings/security", "/index.html", "/zzz-not-a-route"];
    const nonces: string[] = [];
    for (const link of links) {
      const res = await request.get(link, { headers: op.headers() });
      expect(res.status(), link).toBe(200);
      const header = await enforcingNonce(res);
      expect(header, `${link}: enforcing header carries a nonce`).toBeTruthy();
      expect(importMapNonceOfHtml(await res.text()), `${link}: import map carries the header nonce`).toBe(header);
      nonces.push(header as string);
    }
    expect(new Set(nonces).size, "each response has a distinct nonce").toBe(links.length);

    for (const link of links) {
      await page.goto(link);
      await expect(byTestId(page, "headerAppBar"), link).toBeVisible({ timeout: 30_000 });
      expect(scriptSrcOnly(await readCspProbe(page)), `${link}: violations`).toEqual([]);
    }

    const miss = await request.get("/api/zzz-not-found", { headers: op.headers() });
    expect(miss.status()).toBe(404);
    expect(miss.headers()["content-type"]).toContain("application/json");
    const h = await cspHeaders(miss);
    expect(nonceSources([...h.enforcing, ...h.reportOnly]), "non-HTML responses carry no nonce").toEqual([]);
  });
});
