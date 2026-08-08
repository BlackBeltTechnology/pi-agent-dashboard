import { type APIRequestContext, expect, test } from "@playwright/test";
import { gotoDashboard } from "./helpers/index.js";

/**
 * Browser E2E for the "add a gateway URL" action (change:
 * `config-override-oauth-redirect-base`, design D12/D13/D15).
 * Test-plan rows: F5, F6, F7, F8, F9, F11, F12.
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The vitest suites cover the config algebra (`lib/gateway/gateway-action.ts`)
 * and the rendered controls in jsdom. They cannot prove the part the change
 * exists for: values written through a REAL `PUT /api/config` land in the REAL
 * config file, and the running server APPLIES them with no restart — which is
 * the whole of D15.
 *
 * HARNESS SAFETY (read before editing)
 * ------------------------------------
 * This spec writes `cors.allowedOrigins`, `trustedNetworks` and `gateways` on
 * the SHARED harness. Every mutation is undone in a `try`/`finally`-equivalent
 * `afterAll` that restores the captured original values; a throw mid-test must
 * not leak a widened CORS list or a trusted network into later specs. The spec
 * never seeds an OAuth provider, so it cannot auth-gate the harness.
 */

const GATEWAY = "https://pi-e2e-gateway.example.com";

interface ConfigSlice {
  publicBaseUrls?: string[];
  cors?: { allowedOrigins?: string[] };
  trustedNetworks?: string[];
  gateways?: unknown[];
  auth?: { redirectBaseUrl?: string };
}

async function readConfig(request: APIRequestContext): Promise<ConfigSlice> {
  const res = await request.get("/api/config");
  expect(res.ok(), "/api/config must be readable").toBe(true);
  const body = (await res.json()) as ConfigSlice | { data?: ConfigSlice };
  return ("data" in body && body.data ? body.data : body) as ConfigSlice;
}

test.describe.serial("gateway URL action", () => {
  let original: ConfigSlice = {};

  test.beforeAll(async ({ request }) => {
    original = await readConfig(request);
  });

  test.afterAll(async ({ request }) => {
    // Restore EXACTLY what was there, whatever happened above.
    await request
      .put("/api/config", {
        data: {
          publicBaseUrls: original.publicBaseUrls ?? [],
          cors: { allowedOrigins: original.cors?.allowedOrigins ?? [] },
          trustedNetworks: original.trustedNetworks ?? [],
          gateways: original.gateways ?? [],
        },
      })
      .catch(() => {});
  });

  // F5 — one operator statement writes every key, and the row reports OK.
  test("F5: adding an https gateway writes every recorded key in one action", async ({ page, request }) => {
    await gotoDashboard(page);
    await page.goto("/settings/gateway");
    // Exactly one manager on the page: the guide is embedded here and must not
    // render a second copy of the same control.
    await expect(page.getByTestId("gateway-url-manager")).toHaveCount(1, { timeout: 30_000 });

    await page.getByTestId("gateway-url-add-open").click();
    await page.getByTestId("gateway-url-input").fill(GATEWAY);
    await page.getByTestId("gateway-url-mode-pairing").click();
    await page.getByTestId("gateway-url-save").click();

    const row = page.getByTestId("gateway-url-row").filter({ hasText: GATEWAY });
    await expect(row).toHaveAttribute("data-status", "ok", { timeout: 15_000 });

    const cfg = await readConfig(request);
    expect(cfg.publicBaseUrls).toContain(GATEWAY);
    expect(cfg.cors?.allowedOrigins).toContain(GATEWAY);
    expect(cfg.gateways?.length ?? 0).toBeGreaterThan(0);
  });

  // F8 — drift behind the gateway's back is DETECTED, and Fix restores exactly
  // the missing value (reconcile-to-record, never re-run-add).
  test("F8: a deleted cors entry shows Incomplete, and Fix restores just that", async ({ page, request }) => {
    // Delete the cors entry directly, as a hand-edit or another editor would.
    expect(
      (await request.put("/api/config", { data: { cors: { allowedOrigins: [] } } })).ok(),
    ).toBe(true);

    await page.goto("/settings/gateway");
    const row = page.getByTestId("gateway-url-row").filter({ hasText: GATEWAY });
    await expect(row).toHaveAttribute("data-status", "incomplete", { timeout: 30_000 });

    await row.getByTestId("gateway-url-fix").click();
    await expect(row).toHaveAttribute("data-status", "ok", { timeout: 15_000 });

    const cfg = await readConfig(request);
    expect(cfg.cors?.allowedOrigins).toEqual([GATEWAY]);
    // Fix wrote the delta only — the list it did not touch is unchanged.
    expect(cfg.publicBaseUrls?.filter((u) => u === GATEWAY)).toHaveLength(1);
  });

  // F9 — THE PAYOFF. A CORS origin added at runtime must be honoured with no
  // restart, else the browser aborts every module script from that origin
  // (`ERR_ABORTED`, documented at server.ts:1042-1047). This is D15's reason
  // for existing, observed through a real preflight.
  test("F9: the new origin is allowed immediately, with no restart", async ({ request }) => {
    const res = await request.fetch("/api/health", {
      method: "OPTIONS",
      headers: {
        Origin: GATEWAY,
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.headers()["access-control-allow-origin"]).toBe(GATEWAY);
  });

  // F7 — removal reverses exactly what add recorded, and says so first.
  test("F7: removing the gateway reverts every recorded field", async ({ page, request }) => {
    await page.goto("/settings/gateway");
    const row = page.getByTestId("gateway-url-row").filter({ hasText: GATEWAY });
    await row.waitFor({ state: "visible", timeout: 30_000 });

    // The confirmation names each field it will revert.
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("publicBaseUrls");
      expect(dialog.message()).toContain("corsAllowedOrigins");
      void dialog.accept();
    });
    await row.getByTestId("gateway-url-remove").click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });

    const cfg = await readConfig(request);
    expect(cfg.publicBaseUrls ?? []).not.toContain(GATEWAY);
    expect(cfg.cors?.allowedOrigins ?? []).not.toContain(GATEWAY);
  });

  // F6 — the scheme rules are STATED, not silently applied.
  test("F6: an http:// URL disables OAuth + QR with a reason and demands a trusted network", async ({ page }) => {
    await page.goto("/settings/gateway");
    await page.getByTestId("gateway-url-add-open").click();
    await page.getByTestId("gateway-url-input").fill("http://10.4.0.9:8000");

    await expect(page.getByTestId("gateway-url-mode-oauth")).toBeDisabled();
    await expect(page.getByTestId("gateway-url-mode-pairing")).toBeDisabled();
    await expect(page.getByTestId("gateway-url-mode-oauth-reason")).toBeVisible();
    await expect(page.getByTestId("gateway-url-save")).toBeDisabled();

    await page.getByTestId("gateway-url-mode-trusted-network").click();
    // The CIDR prefill is the exact host, never a subnet (D12).
    await expect(page.getByTestId("gateway-url-cidr")).toHaveValue("10.4.0.9");
    await expect(page.getByTestId("gateway-url-save")).toBeEnabled();

    await page.getByTestId("gateway-url-cancel").click();
  });

  // F11 — the dialog's contrast in both modes. The repo's severity-contrast
  // spec establishes the relative gate; this reuses the same floor for the new
  // surface rather than inventing a second standard.
  test("F11: dialog text clears the legibility floor in dark and light", async ({ page }) => {
    for (const mode of ["dark", "light"] as const) {
      await page.goto("/settings/gateway");
      await page.evaluate((m) => localStorage.setItem("dashboard:theme", m), mode);
      await page.reload();
      await page.getByTestId("gateway-url-add-open").click();

      const ratio = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="gateway-url-dialog"]') as HTMLElement;
        const parse = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        const lum = (rgb: number[]) => {
          const [r, g, b] = rgb.map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const style = getComputedStyle(el);
        let bgEl: HTMLElement | null = el;
        let bg = style.backgroundColor;
        while (bgEl && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
          bgEl = bgEl.parentElement;
          bg = bgEl ? getComputedStyle(bgEl).backgroundColor : "rgb(255,255,255)";
        }
        const a = lum(parse(style.color));
        const b = lum(parse(bg));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(ratio, `dialog contrast in ${mode} mode`).toBeGreaterThanOrEqual(3.0);
    }
  });

  // F12 — one shared component, two entry points; they cannot drift. On the
  // Gateway page the guide suppresses its copy (the page mounts the manager as
  // its own section), so the page shows the control exactly once.
  test("F12: the Gateway page shows the shared manager exactly once", async ({ page }) => {
    await page.goto("/settings/gateway");
    await expect(page.getByTestId("gateway-url-manager")).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId("gateway-setup-guide")).toBeVisible();
    await expect(page.getByTestId("gateway-setup-guide").getByTestId("gateway-url-manager")).toHaveCount(0);
  });
});
