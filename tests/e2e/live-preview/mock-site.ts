import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { startMockSite, stopMockSite } from "../../../packages/mockup-loop/src/mock-site-serve.ts";
import type { IsolatedServer } from "./isolated-server.js";
import { REPO_ROOT } from "./isolated-server.js";
import { LiveViewer, type Operator } from "./operator.js";

/**
 * The live-component MOCK SITE as a live-preview target (rows F31-F34, F42, F43, F49, F50, F53-F57, P22, P26).
 * Started from the spec exactly as `serve_mock_site` does (`startMockSite`: detected Vite launcher on the generated
 * config), on a free host port, against a tiny temp project (`makeLpMockProject`) — never the repo's `mockups/`.
 * `reserveBaseVia(server)` is the host side of the `mock-site:base-reservation` probe: it answers with the path the
 * dashboard's REST reserve-path API hands out (`POST /api/live-server/preview-path`), i.e. what the bridge extension does.
 * See change: serve-live-previews-on-capability-origin (D9, D11).
 */
export const LP_MOCK = "2026-12-01-lp-preview";
/** Path of the mock source inside a project root (HMR edits touch this file). */
const lpMockFile = (root: string): string => path.join(root, "mockups", LP_MOCK, "mock.tsx");

const lpMockSource = (marker = "v1", opts: { scripted?: boolean } = {}): string => `import { Fix, Issue, type Mock } from "mock-site/kit";
import { useEffect, useState } from "react";
const Box = ({ t }: { t: string }) => <div style={{ padding: 8, minHeight: 300 }} data-testid="box">{t}</div>;
function Roles() {
  const [s, setS] = useState("loading");
  useEffect(() => { void fetch("/api/roles").then((r) => setS("status " + r.status)); }, []);
  return <div data-testid="roles" style={{ minHeight: 300 }}>{s}</div>;
}
function Counter() {
  const [n, setN] = useState(0);
  return <div style={{ minHeight: 300 }}><button type="button" data-testid="inc" onClick={() => setN((x) => x + 1)}>inc</button><span data-testid="count">count: {n}</span></div>;
}
const mock: Mock = {
  title: "LP preview mock ${marker}",
  category: "Fixture",
  frames: [
    { title: "Ring frame", fixtures: () => ({}), current: <Issue n={1} tip="a ring"><Box t="current ring" /></Issue>, proposed: <Fix n={1} tip="a fix"><Box t="proposed ring ${marker}" /></Fix> },
    { title: "Roles request", fixtures: () => ({}), current: <Issue n={2} tip="roles"><Roles /></Issue>, proposed: <Fix n={2} tip="roles fix"><Roles /></Fix> },
    { title: "Third frame", fixtures: () => ({}), current: <Issue n={3} tip="third"><Box t="third current" /></Issue>, proposed: <Fix n={3} tip="third fix"><Box t="third proposed" /></Fix> },${
      opts.scripted
        ? `
    { title: "Looping counter", proposed: <Counter />, script: [{ say: "inc", target: "inc", act: "click" }] },`
        : ""
    }
  ],
};
export default mock;
`;

/** A temp project: shared \`node_modules\` + a plain React Vite config + one mock. Returns the project root. */
export function makeLpMockProject(opts: { scripted?: boolean } = {}): string {
  // Under /tmp, NOT os.tmpdir(): on macOS `$TMPDIR` (/var/folders/..) can hold tens of thousands of entries and esbuild's
  // upward config/tsconfig lookup then takes ~16 s per Vite config load (x2 per start), blowing the 30 s ready timeout.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "pi-lp-mock-")));
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
  const w = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  w("vite.config.ts", `import react from "@vitejs/plugin-react";\nexport default { plugins: [react()], cacheDir: ".vite-cache", build: { outDir: "dist" } };\n`);
  w(`mockups/${LP_MOCK}/mock.tsx`, lpMockSource("v1", opts));
  fs.mkdirSync(path.join(root, "openspec", "changes"), { recursive: true });
  return root;
}

/**
 * One project per worker and variant, reused by every test: Vite pre-bundles the site's dependencies on the first start of a project
 * and RELOADS the page when it finds more mid-load — a fresh project per test makes that race the test's problem. The optimizer
 * cache is project-local (`cacheDir` in the project's Vite config) because `node_modules` is the repo's own (symlinked) and its
 * default cache would be shared with every other Vite run on the machine.
 */
const sharedRoots = new Map<string, string>();
function sharedRoot(scripted: boolean): string {
  const key = scripted ? "scripted" : "plain";
  let root = sharedRoots.get(key);
  if (!root) {
    root = makeLpMockProject({ scripted });
    sharedRoots.set(key, root);
  }
  return root;
}
process.on("exit", () => {
  for (const r of sharedRoots.values()) fs.rmSync(r, { recursive: true, force: true });
});

export const freeHostPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

/** Host answer to `mock-site:base-reservation`: reserve a tier-5 base on `server` for the probe's port. */
export function reserveBaseVia(server: IsolatedServer) {
  return {
    emit(channel: string, data: unknown): void {
      if (channel !== "mock-site:base-reservation") return;
      const probe = data as { port: number; pending?: Promise<unknown> };
      probe.pending = server.api("POST", "/api/live-server/preview-path", { port: probe.port }).then((r) => {
        if (!r.json?.success) throw new Error(`reserve refused: ${r.status} ${JSON.stringify(r.json)}`);
        return r.json.path === null ? null : { base: r.json.path as string };
      });
    },
  };
}

export interface LpMock {
  root: string;
  port: number;
  /** Loopback URL the dashboard previews (`live-url` input): `http://127.0.0.1:<port>`. */
  url: string;
  /** The base the site runs under (`/preview/<pid>/`) or null for root. */
  base: string | null;
  /** Kill the site process (same port stays free). */
  stop(): Promise<void>;
  /** Stop the site and reset its (per-worker shared) project to the pristine mock. */
  dispose(): Promise<void>;
  /** Start the SAME project again on the SAME port with the SAME base (a restarted dev server). */
  restart(): Promise<void>;
  /** Rewrite the mock source (HMR trigger). */
  edit(marker: string): void;
}

/**
 * Start the mock site. `base` explicit → that base; `events` → the real reservation probe; neither → root.
 * `port` defaults to a free port (never 5299: that belongs to a developer's own `serve_mock_site`).
 */
export async function startLpMock(opts: { root?: string; port?: number; base?: string; scripted?: boolean; events?: ReturnType<typeof reserveBaseVia> } = {}): Promise<LpMock> {
  const root = opts.root ?? sharedRoot(opts.scripted === true);
  const port = opts.port ?? (await freeHostPort());
  let base: string | null = null;
  const boot = async (b: unknown, events?: ReturnType<typeof reserveBaseVia>) => {
    const r = await startMockSite({ dir: root, port, ...(b === undefined ? {} : { base: b }), ...(events ? { events } : {}) });
    if (!r.ok) throw new Error(`mock site: ${r.error}`);
    base = r.base;
  };
  await boot(opts.base, opts.events);
  return {
    root,
    port,
    url: `http://127.0.0.1:${port}`,
    get base() {
      return base;
    },
    stop: async () => void (await stopMockSite(port)),
    dispose: async () => {
      await stopMockSite(port);
      fs.writeFileSync(lpMockFile(root), lpMockSource("v1", { scripted: opts.scripted })); // the shared project goes back to its pristine mock
    },
    restart: async () => {
      await stopMockSite(port);
      await boot(base ?? undefined);
    },
    edit: (marker) => fs.writeFileSync(lpMockFile(root), lpMockSource(marker)),
  };
}

/** Console / page errors of the dashboard page AND its frames that the mock-site rows forbid (CORS, ERR_FAILED, SecurityError). */
export function watchForbiddenConsole(page: import("@playwright/test").Page): { hits: string[] } {
  const hits: string[] = [];
  const bad = /CORS|ERR_FAILED|SecurityError|origin 'null'|Failed to read a named property/i;
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") if (bad.test(m.text())) hits.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => bad.test(`${e.name} ${e.message}`) && hits.push(`pageerror: ${e.name}: ${e.message}`));
  return { hits };
}

/** Number of pane iframes `lpMockSource` renders (3 frames x Current/Proposed). */
export const LP_PANES = 6;

/** Scroll every pane into view so the lazy `?pane=` iframes mount (the viewer pane is small). */
async function mountPanes(viewer: LiveViewer): Promise<void> {
  await viewer.frameLocator.locator(".mk-pane").first().waitFor({ state: "attached", timeout: 30_000 });
  for (const el of await viewer.frameLocator.locator(".mk-pane").all()) await el.scrollIntoViewIfNeeded();
}

/** The ring of pane `<n>/<side>` (the Current/Proposed iframe of mock frame n). */
export const paneRing = (viewer: LiveViewer, n: number, side: "current" | "proposed") =>
  viewer.frameLocator.frameLocator(`iframe[data-pane="${LP_MOCK}/${n}/${side}"]`).locator(".mk-ring").first();

/** Wait until all `LP_PANES` pane iframes mounted and each rendered its ring (every pane of `lpMockSource` carries one). */
export async function expectPanesReported(viewer: LiveViewer, timeout = 30_000): Promise<void> {
  await mountPanes(viewer);
  await expect(viewer.frameLocator.locator("iframe[data-pane]")).toHaveCount(LP_PANES, { timeout });
  for (const n of [1, 2, 3]) for (const side of ["current", "proposed"] as const) await expect(paneRing(viewer, n, side), `ring in pane ${n}/${side}`).toBeVisible({ timeout });
}

/**
 * Host side of a TIER-5 mock: make sure a tier-5 viewer socket is connected (the dashboard page is already open at the
 * tier-5 origin), then start the site through the real reservation probe so it runs under the reserved `/preview/<pid>/`.
 */
export async function startT5Mock(server: IsolatedServer, opts: { root?: string; port?: number; scripted?: boolean } = {}): Promise<LpMock> {
  const port = opts.port ?? (await freeHostPort());
  for (let i = 0; i < 40; i++) {
    const r = await server.api("POST", "/api/live-server/preview-path", { port });
    if (r.json?.path) {
      await server.api("DELETE", `/api/live-server/preview-path/${String(r.json.path).split("/")[2]}`);
      break;
    }
    if (i === 39) throw new Error(`no tier-5 viewer registered after 20 s: ${JSON.stringify(r.json)}`);
    await new Promise((res) => setTimeout(res, 500));
  }
  const mock = await startLpMock({ ...opts, port, events: reserveBaseVia(server) });
  if (!mock.base) throw new Error("mock started at root: the reservation probe was not answered with a base");
  return mock;
}

/**
 * Open an AGENT-declared (`addedBy:"preset"`) loopback target in the viewer, as `canvas()` / `serve_mock_site` declare it:
 * register it over REST and pick it from the target list (typing its URL in the picker would PROMOTE it to a user target,
 * whose Open ↗ deliberately opens the raw local URL). `dashOrigin` is the origin the browser reaches the dashboard on.
 */
export async function openPresetPreview(page: Page, operator: Operator, server: IsolatedServer, dashOrigin: string, port: number): Promise<LiveViewer> {
  const reg = await server.api("POST", "/api/live-server/start", { host: "127.0.0.1", port, addedBy: "preset" });
  if (reg.json?.data?.addedBy !== "preset") throw new Error(`preset registration failed: ${JSON.stringify(reg.json)}`);
  const session = await operator.fakeSession();
  await operator.gotoDashboard(page, dashOrigin);
  const card = page.locator(`[data-testid="session-card-desktop"][data-session-id="${session.id}"]`);
  await expect(async () => {
    await card.click({ timeout: 5_000 });
    await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 5_000 });
    await page.getByTestId("layout-mode-split").click({ timeout: 3_000 });
    if ((await page.getByTestId("new-tab-menu-toggle").getAttribute("aria-expanded", { timeout: 3_000 })) !== "true") {
      await page.getByTestId("new-tab-menu-toggle").click({ timeout: 3_000 });
    }
    await page.getByTestId("live-preview-launch").click({ timeout: 3_000 });
    await page.getByTestId("live-older").waitFor({ state: "visible", timeout: 3_000 });
    if (!(await page.getByTestId("live-older").evaluate((d) => (d as HTMLDetailsElement).open))) await page.getByTestId("live-older").locator("summary").click({ timeout: 3_000 });
    await page.getByTestId("live-target-row").filter({ hasText: `:${port}` }).first().waitFor({ state: "visible", timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByTestId("live-target-row").filter({ hasText: `:${port}` }).getByRole("button").first().click();
  const viewer = new LiveViewer(page, `http://127.0.0.1:${port}`, session);
  await expect(viewer.iframe).toBeAttached({ timeout: 20_000 });
  return viewer;
}

/**
 * Let a page frame the RAW mock site in an opaque (`sandbox` without `allow-same-origin`) wrapper: its module requests carry
 * `Origin: null` and Vite's own CORS refuses that. Behind the dashboard the tier-5 proxy adds `Access-Control-Allow-Origin: null`
 * (D8); with no dashboard in the loop this adds the same header on the browser side.
 */
export async function allowOpaqueOrigin(page: Page, site: LpMock): Promise<void> {
  await page.route(`${site.url}/**`, async (route) => {
    try {
      const r = await route.fetch();
      await route.fulfill({ response: r, headers: { ...r.headers(), "access-control-allow-origin": "*" } });
    } catch {
      await route.abort().catch(() => undefined); // the site went away mid-request (test teardown)
    }
  });
}
