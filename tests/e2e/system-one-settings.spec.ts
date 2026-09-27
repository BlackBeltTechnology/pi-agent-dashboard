import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { REPO_ROOT } from "./lifecycle.js";

/**
 * L3 browser behaviour for the "Decision models (System 1)" settings section
 * (change: add-system-one-registry, tasks 7.2–7.9, test-plan F1–F8).
 *
 * Real routes: `/api/system-one/config` (GET/PUT, revision + 409), `/keys`.
 * Each test first writes a known config through the real PUT.
 *
 * Routed fixtures (the rendered UI is real; only the data source is fixed):
 *   - `/consumers`  — the harness has no product consumers registered, and
 *                     F4/F7 need declared `requires` / `fail-open` consumers;
 *   - `/eval`       — a Test run needs a System-1 engine inside the container;
 *                     the server half (cap, metrics, egress, confirm) is L1
 *                     (E26/E27, packages/system-one-plugin routes.test.ts);
 *   - `/keys`       — only for the env-sourced key case (no env key in the harness).
 *
 * `color-contrast` is disabled in axe, same as mcp-client-settings-a11y.spec.ts
 * (severity-contrast.spec.ts documents why absolute 4.5:1 is not enforceable
 * for this theme set).
 */

const PLUGIN_PATH = "/settings/plugins/system-one";
const SECTION = '[data-testid="system-one-settings"]';

const BASE_CONFIG = {
  allowOffMachine: false,
  backends: {
    jev: { kind: "http", url: "https://api.typesafe.ai/v1/systemone", model: "jev-1.13.0" },
    von: { kind: "managed", engine: "von" },
    laya: { kind: "managed", engine: "laya", capabilities: { maxOptions: 5 } },
    fast: { kind: "llm", role: "@fast" },
  },
  presets: { hosted: { chain: ["jev", "fast"] }, "local-only": { chain: ["von", "laya"] } },
  activePreset: "local-only",
};

const SELFTEST = {
  id: "system-one:selftest",
  label: "System-1 self-test",
  failurePolicy: "fail-closed",
  fixtures: "/bundled/selftest.json",
  lastSeen: null,
  test: { enabled: true, cases: 24 },
};

async function putConfig(page: Page, config: unknown = BASE_CONFIG): Promise<void> {
  const cur = await (await page.request.get("/api/system-one/config")).json();
  const res = await page.request.put("/api/system-one/config", { data: { config, baseRevision: cur.revision } });
  expect(res.status(), await res.text()).toBe(200);
}

async function routeConsumers(page: Page, extra: unknown[] = []): Promise<void> {
  await page.route("**/api/system-one/consumers", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ consumers: [SELFTEST, ...extra] }) }),
  );
}

async function gotoSection(page: Page): Promise<void> {
  await page.goto(PLUGIN_PATH);
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(SECTION)).toBeVisible({ timeout: 30_000 });
}

test.describe("system-one settings section (L3)", () => {
  test.beforeEach(async ({ page }) => {
    // Arms the first-launch dismissals (chat-view onboarding) before any route.
    await gotoDashboard(page);
    await putConfig(page);
  });

  // F1 — Save Bar integration (task 7.2)
  test("F1: reorder + preset switch save through one PUT", async ({ page }) => {
    await routeConsumers(page);
    const puts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PUT" && r.url().includes("/api/system-one/config")) puts.push(r.url());
    });
    await gotoSection(page);
    await expect(page.getByTestId("settings-save-bar")).toHaveCount(0);

    await page.getByRole("button", { name: "Move laya up" }).click();
    await page.getByTestId("preset-hosted").check();
    await expect(page.getByTestId("settings-save-bar")).toBeVisible();
    await expect(page.getByTestId("save-bar-page-plugins/system-one")).toBeVisible();

    await page.getByTestId("save-btn").click();
    await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 15_000 });
    expect(puts).toHaveLength(1);

    const cfg = await (await page.request.get("/api/system-one/config")).json();
    expect(cfg.config.activePreset).toBe("hosted");
    expect(cfg.config.presets["local-only"].chain).toEqual(["laya", "von"]);
  });

  // F2 — stale draft (task 7.3)
  test("F2: an external write after load makes Save report a conflict", async ({ page }) => {
    await routeConsumers(page);
    await gotoSection(page);
    // External writer (e.g. the supervisor persisting a port) changes the revision.
    const external = { ...BASE_CONFIG, backends: { ...BASE_CONFIG.backends, von: { kind: "managed", engine: "von", port: 18431 } } };
    await putConfig(page, external);

    await page.getByTestId("preset-hosted").check();
    await page.getByTestId("save-btn").click();
    await expect(page.getByTestId("system-one-conflict")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("system-one-reload")).toBeVisible();
    await expect(page.getByTestId("settings-save-bar")).toBeVisible();

    const cfg = await (await page.request.get("/api/system-one/config")).json();
    expect(cfg.config.backends.von.port).toBe(18431);
    expect(cfg.config.activePreset).toBe("local-only");
  });

  // F3 — off-machine gating (task 7.4)
  test("F3: the switch gates off-machine backends and the hosted warning", async ({ page }) => {
    await routeConsumers(page);
    await gotoSection(page);
    const jevOption = page.locator("#s1-default-add option[value='jev']");
    await expect(jevOption).toBeDisabled();
    await page.getByTestId("preset-hosted").check();
    await expect(page.getByTestId("system-one-no-usable")).toBeVisible();

    await page.getByTestId("system-one-allow-off-machine").click();
    await expect(page.getByTestId("system-one-allow-off-machine")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("system-one-no-usable")).toHaveCount(0);
    await page.getByTestId("preset-local-only").check();
    await expect(page.locator("#s1-default-add option[value='jev']")).toBeEnabled();
  });

  // F4 — compatibility filter (task 7.5)
  test("F4: incompatible backends are hidden until revealed; override seeds without them", async ({ page }) => {
    await routeConsumers(page, [
      { id: "pi-warden:tool-risk", failurePolicy: "fail-closed", requires: { maxOptions: 60 }, lastSeen: null, test: { enabled: false, cases: 0, reason: "no-fixtures" } },
    ]);
    await gotoSection(page);
    const row = page.getByTestId("consumer-pi-warden:tool-risk");
    await row.locator("summary").click();
    await row.getByTestId("override-pi-warden:tool-risk").check();

    // seeded from local-only [von, laya] minus laya (maxOptions 5 < 60)
    await expect(row.locator("ol li")).toHaveCount(1);
    await expect(row.locator("ol li").first()).toContainText("von");
    await expect(row.locator("option[value='laya']")).toHaveCount(0);

    await row.getByTestId("s1-ov-pi-warden-tool-risk-show-incompat").check();
    await expect(row.locator("option[value='laya']")).toContainText("incompatible: options 5 < 60");
    await expect(row.getByTestId("s1-ov-pi-warden-tool-risk-incompat-warning")).toBeVisible();
  });

  // F5 — key entry (task 7.6)
  test("F5: key entry is write-only", async ({ page }) => {
    await routeConsumers(page);
    await gotoSection(page);
    const box = page.getByTestId("key-TYPESAFE_API_KEY");
    const input = box.locator("input[type=password]");
    await expect(input).toHaveAttribute("type", "password");
    await input.fill("ts_E2E_SECRET_1234");
    await box.getByRole("button").click();
    await expect(input).toHaveValue("");
    await expect(box.getByTestId("key-state")).toHaveText("set");
    expect(await page.content()).not.toContain("ts_E2E_SECRET_1234");

    await page.route("**/api/system-one/keys", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ keys: { TYPESAFE_API_KEY: { set: true, source: "env" } } }) }),
    );
    await page.reload();
    await expect(page.locator(SECTION)).toBeVisible({ timeout: 30_000 });
    const envBox = page.getByTestId("key-TYPESAFE_API_KEY");
    await expect(envBox).toContainText("from environment variable");
    await expect(envBox.locator("input")).toHaveCount(0);
  });

  // F6 — Test + enforce confirm (task 7.7)
  test("F6: Test results render; enforce needs a confirmation naming backend + model", async ({ page }) => {
    await putConfig(page, { ...BASE_CONFIG, backends: { ...BASE_CONFIG.backends, kev: { kind: "http", url: "http://127.0.0.1:18480/v1/systemone", model: "kev" } } });
    await routeConsumers(page);
    await page.route("**/api/system-one/eval", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          backendId: "kev",
          consumerId: "system-one:selftest",
          model: "kev-0.4",
          cases: 24,
          failures: 0,
          cancelled: false,
          questions: { q: { type: "noul", cases: 10, correct: 9, accuracy: 0.9, auc: 0.95, threshold: 0.62 } },
          latencyMs: { p50: 38, p90: 71 },
          inputChars: 4200,
          estimatedCostUsd: null,
          thresholds: { q: 0.62 },
        }),
      }),
    );
    const calibrations: any[] = [];
    await page.route("**/api/system-one/calibration", async (route) => {
      calibrations.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ revision: "r2" }) });
    });
    await gotoSection(page);
    const row = page.getByTestId("consumer-system-one:selftest");
    await row.locator("summary").click();
    await row.getByTestId("test-backend-system-one:selftest").selectOption("kev");
    await row.getByTestId("run-test-system-one:selftest").click();
    const table = row.getByTestId("results-system-one:selftest");
    for (const h of ["Accuracy", "AUC", "p50", "p90"]) await expect(table).toContainText(h);

    await row.getByLabel(/Enforce: the feature acts on answers/).check();
    await row.getByTestId("save-calibration-system-one:selftest").click();
    // Settings is itself a role=dialog overlay; address the confirm by its accessible name.
    const dialog = page.getByRole("dialog", { name: /^Enforce kev for system-one:selftest\?$/ });
    await expect(dialog).toContainText("kev");
    await expect(dialog).toContainText("kev-0.4");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(calibrations).toHaveLength(0);

    await row.getByTestId("save-calibration-system-one:selftest").click();
    await dialog.getByRole("button", { name: "Enforce" }).click();
    await expect.poll(() => calibrations.length).toBe(1);
    expect(calibrations[0]).toMatchObject({ backendId: "kev", mode: "enforce", model: "kev-0.4", confirm: true, thresholds: { q: 0.62 } });
  });

  // F7 — fail-open + llm warning (task 7.8)
  test("F7: a fail-open consumer with a chat model in its chain is warned", async ({ page }) => {
    await putConfig(page, {
      ...BASE_CONFIG,
      presets: { ...BASE_CONFIG.presets, "local-only": { chain: ["von"], consumers: { "context-manager:is_lesson": { chain: ["von", "fast"] } } } },
    });
    await routeConsumers(page, [
      { id: "context-manager:is_lesson", failurePolicy: "fail-open", lastSeen: null, test: { enabled: false, cases: 0, reason: "no-fixtures" } },
    ]);
    await gotoSection(page);
    const row = page.getByTestId("consumer-context-manager:is_lesson");
    await row.locator("summary").click();
    await expect(row.getByTestId("llm-warning-context-manager:is_lesson")).toContainText("fail-open and its chain includes a chat model");
  });

  // F8 — accessibility (task 7.9)
  for (const theme of ["dark", "light"] as const) {
    test(`F8: no serious/critical axe violation and keyboard-reachable controls (${theme})`, async ({ page }) => {
      await routeConsumers(page);
      await gotoSection(page);
      if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await page.evaluate((sel) => {
        for (const d of Array.from(document.querySelectorAll(`${sel} details`))) (d as HTMLDetailsElement).open = true;
      }, SECTION);

      await page.addScriptTag({ path: path.join(REPO_ROOT, "node_modules", "axe-core", "axe.min.js") });
      const violations = await page.evaluate(async (selector) => {
        const axe = (window as unknown as { axe: { run: (c: string, o: unknown) => Promise<any> } }).axe;
        const r = await axe.run(selector, { rules: { "color-contrast": { enabled: false } } });
        return r.violations
          .filter((v: any) => v.impact === "serious" || v.impact === "critical")
          .map((v: any) => `${v.id}: ${v.nodes.map((n: any) => n.target.join(" ")).join(" | ")}`);
      }, SECTION);
      expect(violations).toEqual([]);

      // Every enabled control in the section is reachable by Tab.
      const ids = await page.evaluate((sel) => {
        const els = Array.from(document.querySelectorAll(`${sel} button, ${sel} input, ${sel} select, ${sel} summary`)) as HTMLElement[];
        return els
          .filter((e) => !(e as HTMLButtonElement).disabled && e.offsetParent !== null)
          .map((e, i) => {
            e.dataset.s1Tab = String(i);
            return String(i);
          });
      }, SECTION);
      await page.locator(SECTION).locator("h3").first().click();
      const seen = new Set<string>();
      for (let i = 0; i < ids.length * 3 + 20 && seen.size < ids.length; i++) {
        await page.keyboard.press("Tab");
        const id = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.s1Tab ?? null);
        if (id) seen.add(id);
      }
      // Radios in one group share a single tab stop; exclude unchecked radios.
      const radiosUnchecked = await page.evaluate(
        (sel) => Array.from(document.querySelectorAll(`${sel} input[type=radio]:not(:checked)`)).map((e) => (e as HTMLElement).dataset.s1Tab),
        SECTION,
      );
      const expected = ids.filter((id) => !radiosUnchecked.includes(id));
      expect(expected.filter((id) => !seen.has(id))).toEqual([]);
    });
  }
});

// Keep the axe source check explicit so a missing dev dependency fails loudly.
test.beforeAll(() => {
  const p = path.join(REPO_ROOT, "node_modules", "axe-core", "axe.min.js");
  if (!fs.existsSync(p)) throw new Error(`axe-core not installed at ${p} — run pnpm install`);
});
