/**
 * Electron-E2E: runtime overlay update cycle against a local npm registry
 * (test-plan X11, X10, X12; tasks 3.2–3.4).
 *
 * Fixture (task 3.1, `scripts/runtime-e2e-registry.mjs`): a loopback
 * Verdaccio serving the runtime closure at three versions —
 *   base   = the version the packaged app bundles (bundle-server installed from it),
 *   good   = `latest`, a real runtime release with `runtime-lock.json`,
 *   broken = dist-tag `broken`, whose server `cli.ts` exits at boot.
 * The CI job exports PW_RUNTIME_REGISTRY / PW_RUNTIME_GOOD / PW_RUNTIME_BROKEN;
 * without them (or without a bundled server) every test skips.
 *
 * The app's server resolves npm with the user's config, so a throwaway HOME
 * carries `.npmrc` → registry. Drives the same REST surface as the Runtime
 * Updates UI: `/api/runtime/{source,status,update,activate}`.
 *
 *   X11 — Check → Update → Activate → health `{origin:"overlay", version:good}`,
 *         settings.json bridge extension under `versions/<good>`, same
 *         first-party plugin set as the bundled runtime.
 *   X10 — on that overlay, kill the server PID → loading/recovery page.
 *   X12 — fresh HOME, pin `broken`, Activate → back on `bundled`,
 *         `lastFailure` names `broken`, extension re-registered off the overlay.
 *
 * See change: electron-runtime-release-pipeline.
 */

import fs from "node:fs";
import path from "node:path";
import type { ElectronApplication } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { isPortInUse, launchElectron, makeThrowawayHome, resolvePackagedBinary } from "./electron-lifecycle.js";

const PORT = Number(process.env.PW_ELECTRON_RUNTIME_PORT ?? 18_960);
const BASE = `http://127.0.0.1:${PORT}`;
const REGISTRY = process.env.PW_RUNTIME_REGISTRY ?? "";
const GOOD = process.env.PW_RUNTIME_GOOD ?? "";
const BROKEN = process.env.PW_RUNTIME_BROKEN ?? "";
/** npm ci of ~1.2k packages through the Verdaccio uplink. */
const STAGE_TIMEOUT_MS = 15 * 60_000;

interface Health {
  pid?: number;
  version?: string;
  runtime?: { origin?: string; id?: string; lastFailure?: { id?: string; reason?: string } };
  plugins?: Array<{ id: string }>;
}

interface RuntimeStatus {
  pending?: string | null;
  staging?: { version: string } | null;
  lastStageError?: { version: string; message: string } | null;
  check?: { state?: string; target?: string };
}

async function health(): Promise<Health | null> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

async function status(refresh = false): Promise<RuntimeStatus> {
  const res = await fetch(`${BASE}/api/runtime/status${refresh ? "?refresh=true" : ""}`, { signal: AbortSignal.timeout(60_000) });
  const body = (await res.json()) as { data: RuntimeStatus };
  return body.data;
}

async function post(route: string, body: unknown = {}): Promise<void> {
  const res = await fetch(`${BASE}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  expect(res.status, `${route} → ${res.status} ${await res.clone().text()}`).toBeLessThan(300);
}

function pluginIds(h: Health | null): string[] {
  return (h?.plugins ?? []).map((p) => p.id).sort();
}

function settingsText(home: string): string {
  const file = path.join(home, ".pi", "agent", "settings.json");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

/** A `versions/<v>` path segment (either separator; JSON-escaped backslashes on Windows). */
function underVersion(v: string): RegExp {
  return new RegExp(`versions(?:/|\\\\\\\\)${v.replace(/\./g, "\\.")}(?:/|\\\\\\\\)`);
}

function hasBundledServer(): boolean {
  const bin = resolvePackagedBinary();
  const resources =
    process.platform === "darwin" ? path.resolve(path.dirname(bin), "..", "Resources") : path.join(path.dirname(bin), "resources");
  return fs.existsSync(path.join(resources, "server", "node_modules", "@blackbelt-technology", "pi-dashboard-server", "src", "cli.ts"));
}

function makeHome(): string {
  const home = makeThrowawayHome(PORT);
  // The server's npm (ToolRegistry-resolved) honours the user's npmrc.
  fs.writeFileSync(path.join(home, ".npmrc"), `registry=${REGISTRY}\n`);
  return home;
}

/** Select npm (optionally pinned), stage the target, wait until it is pending. */
async function stage(pin: string | null, expected: string): Promise<void> {
  await post("/api/runtime/source", pin ? { source: "npm", pin } : { source: "npm" });
  await expect.poll(async () => (await status(true)).check?.target, { timeout: 120_000 }).toBe(expected);
  await post("/api/runtime/update");
  await expect
    .poll(
      async () => {
        const s = await status();
        if (s.lastStageError?.version === expected) throw new Error(`staging ${expected} failed: ${s.lastStageError.message}`);
        return !s.staging && s.pending === expected;
      },
      { timeout: STAGE_TIMEOUT_MS, intervals: [5_000] },
    )
    .toBe(true);
}

async function coldLaunchBundled(home: string): Promise<ElectronApplication> {
  const app = await launchElectron({ home });
  await app.firstWindow();
  await expect.poll(async () => (await health())?.runtime?.origin, { timeout: 120_000 }).toBe("bundled");
  return app;
}

async function stop(app: ElectronApplication | undefined, home: string | undefined): Promise<void> {
  if (app) {
    await fetch(`${BASE}/api/shutdown`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => {});
    // A native dialog (e.g. "runtime reverted") can block a graceful close.
    const closed = await Promise.race([
      app.close().then(() => true, () => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 20_000)),
    ]);
    if (!closed) app.process().kill("SIGKILL");
  }
  if (home) {
    if (process.env.PW_KEEP_HOME) console.log(`[runtime-overlay] kept HOME ${home}`);
    else fs.rmSync(home, { recursive: true, force: true });
  }
}

test.beforeAll(async () => {
  test.skip(!REGISTRY || !GOOD || !BROKEN, "PW_RUNTIME_REGISTRY/GOOD/BROKEN unset — run scripts/runtime-e2e-registry.mjs first");
  test.skip(await isPortInUse(PORT), `port ${PORT} in use`);
  test.skip(!hasBundledServer(), "packaged app has no bundled server (forge package only)");
});

test.describe.serial("X11 + X10: npm update cycle, then crash on the overlay", () => {
  let app: ElectronApplication | undefined;
  let home: string | undefined;

  test.afterAll(async () => {
    await stop(app, home);
  });

  test("X11: Check → Update → Activate lands on the npm overlay", async () => {
    test.setTimeout(STAGE_TIMEOUT_MS + 5 * 60_000);
    home = makeHome();
    app = await coldLaunchBundled(home);
    await expect.poll(async () => pluginIds(await health()).length, { timeout: 60_000 }).toBeGreaterThan(0);
    const bundledPlugins = pluginIds(await health());

    await stage(null, GOOD);
    await post("/api/runtime/activate");

    await expect
      .poll(async () => {
        const h = await health();
        return `${h?.runtime?.origin}@${h?.version}`;
      }, { timeout: 180_000, intervals: [2_000] })
      .toBe(`overlay@${GOOD}`);
    expect(settingsText(home)).toMatch(underVersion(GOOD));
    await expect.poll(async () => pluginIds(await health()), { timeout: 60_000 }).toEqual(bundledPlugins);
  });

  test("X10: killing the overlay server shows the loading/recovery page", async () => {
    test.setTimeout(120_000);
    test.skip(!app, "X11 did not reach the overlay");
    const h = await health();
    expect(h?.runtime?.origin).toBe("overlay");
    expect(h?.pid).toBeGreaterThan(0);
    process.kill(h!.pid!, "SIGKILL");
    await expect
      .poll(() => app!.windows().some((w) => w.url().includes("loading.html")), { timeout: 60_000, intervals: [1_000] })
      .toBe(true);
  });
});

test("X12: a broken overlay falls back to the bundled runtime", async () => {
  test.setTimeout(STAGE_TIMEOUT_MS + 5 * 60_000);
  const home = makeHome();
  let app: ElectronApplication | undefined;
  try {
    app = await coldLaunchBundled(home);
    await stage(BROKEN, BROKEN);
    await post("/api/runtime/activate");

    // The broken server exits at boot; Electron marks it bad and restores bundled.
    await expect
      .poll(async () => {
        const h = await health();
        return `${h?.runtime?.origin}|${h?.runtime?.lastFailure?.id}`;
      }, { timeout: 240_000, intervals: [2_000] })
      .toBe(`bundled|${BROKEN}`);
    // Bundled extension re-registered: nothing points into the broken overlay.
    await expect.poll(() => underVersion(BROKEN).test(settingsText(home)), { timeout: 30_000 }).toBe(false);
    // The bundle registers its workspace copy: `<resources>/server/packages/extension`.
    expect(settingsText(home)).toMatch(/server(?:\/|\\\\)packages(?:\/|\\\\)extension"/);
  } finally {
    await stop(app, home);
  }
});
