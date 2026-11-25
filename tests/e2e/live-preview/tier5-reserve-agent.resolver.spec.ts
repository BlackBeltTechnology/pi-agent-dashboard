import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
import { startMockSite, stopMockSite } from "../../../packages/mockup-loop/src/mock-site-serve.ts";
import { AgentBridge } from "./agent-bridge.js";
import { expect, test } from "./fixture.js";
import { freeHostPort, makeLpMockProject } from "./mock-site.js";
import { operatorCookieHeader } from "./tier5-helpers.js";

/**
 * L3 — D9 base reservation, AGENT side (chromium-resolver, dashboard reached as `dash5.test` ⇒ tier 5). The agent is a fake bridge
 * session running the REAL extension reserve link (`agent-bridge.ts`); the tool is the REAL `startMockSite` (what `serve_mock_site`
 * calls) against a temp mock project. Rows: test-plan #F16 (reservation visible to the agent, adopted by the first viewer),
 * #F17 (a closed / stale client is not a tier-5 viewer), #X26 (a server restart loses reservations and adopted pids).
 * See change: serve-live-previews-on-capability-origin (tasks 9.5, 14.4).
 */
test.use({ dashHost: "dash5.test" });

const BASE = /^\/preview\/[A-Za-z0-9_-]{22}\/$/;
const reserveLines = (lines: string[], port: number) => lines.filter((l) => new RegExp(`\\breserve port=${port}\\b`).test(l));

/** Wait until a tier-5 browser is connected: an unrelated dummy port is reserved by the agent (nothing adopts it). */
async function waitForTier5Viewer(agent: AgentBridge, dummyPort: number, want = true): Promise<void> {
  await expect
    .poll(async () => (await agent.request(dummyPort)).frame?.tier5Viewers, { timeout: 20_000, message: `tier5Viewers becomes ${want}` })
    .toBe(want);
}

test("T.F16 / #F16 serve_mock_site reserves /preview/<pid>/ with a tier-5 browser; the first viewer adopts it; loopback-only starts at root", async ({ page, operator, isolatedServer, dashOrigin }) => {
  test.setTimeout(240_000);
  const agent = await AgentBridge.connect(isolatedServer);
  const root = makeLpMockProject();
  const dummy = await freeHostPort();
  const port = await freeHostPort();
  try {
    // ── tier-5 browser connected ──────────────────────────────────────────────
    await operator.gotoDashboard(page, dashOrigin);
    await waitForTier5Viewer(agent, dummy);
    const mark = isolatedServer.logMark();
    const tool = await startMockSite({ dir: root, port, events: agent.events });
    if (!tool.ok) throw new Error(`serve_mock_site failed: ${tool.error}`);
    expect(tool.base, "the tool result states the base").toMatch(BASE);
    expect(tool.local, "…and the site really starts under it").toBe(`http://localhost:${port}${tool.base}`);
    expect(tool.note, "no fallback note: the reservation succeeded").toBeUndefined();
    expect(reserveLines(isolatedServer.livePreviewLog(mark), port), "exactly one reservation for the port").toHaveLength(1);

    // First viewer open adopts it: the frame is on the reserved pid, no second reservation / restart.
    const seen: { url: string; status: number }[] = [];
    page.on("response", (res) => {
      if (res.url().includes("/preview/")) seen.push({ url: new URL(res.url()).pathname, status: res.status() });
    });
    const viewer = await operator.openLivePreview(page, { dashOrigin, target: `http://127.0.0.1:${port}`, session: agent });
    expect(await viewer.src(), "the viewer adopts the reserved pid").toBe(tool.base);
    await expect(page.getByTestId("live-base-path")).toHaveText(tool.base as string);
    await expect(page.getByTestId("live-hint-base-path")).not.toContainText(/base path changed/i);
    await expect.poll(() => seen.find((s) => s.url === tool.base)?.status, { message: "the site answers under the reserved base" }).toBe(200);
    expect(reserveLines(isolatedServer.livePreviewLog(mark), port), "adoption reserved nothing more").toHaveLength(1);
    expect(isolatedServer.livePreviewLog(mark).join("\n")).toMatch(/mint tier=5 /);
    await stopMockSite(port);

    // ── loopback tab only ────────────────────────────────────────────────────
    await page.goto("about:blank"); // the tier-5 tab goes away
    const loop = await page.context().newPage();
    await operator.gotoDashboard(loop, isolatedServer.origin("localhost"));
    await waitForTier5Viewer(agent, dummy, false);
    const mark2 = isolatedServer.logMark();
    const port2 = await freeHostPort();
    const root2 = await startMockSite({ dir: root, port: port2, events: agent.events });
    if (!root2.ok) throw new Error(`serve_mock_site failed: ${root2.error}`);
    expect(root2.base, "no tier-5 browser ⇒ the site starts at the root").toBeNull();
    expect(root2.local).toBe(`http://localhost:${port2}`);
    expect(agent.results.at(-1), "the server answered {path:null, tier5Viewers:false}").toMatchObject({ path: null, tier5Viewers: false });
    expect(reserveLines(isolatedServer.livePreviewLog(mark2), port2), "no reservation counter moved").toHaveLength(0);
    await stopMockSite(port2);
  } finally {
    await stopMockSite(port);
    await agent.close();
  }
});

test("T.F17 / #F17 a closed or stale (never-announced) client is not a tier-5 viewer; a reconnecting tab re-announces and the next call reserves", async ({ context, page, operator, isolatedServer, dashOrigin }) => {
  test.setTimeout(240_000);
  const agent = await AgentBridge.connect(isolatedServer);
  const root = makeLpMockProject();
  const dummy = await freeHostPort();
  const port = await freeHostPort();
  let stale: WebSocket | undefined;
  try {
    // Tab A (tier-5 host) and tab B (loopback host), both new clients.
    await operator.gotoDashboard(page, dashOrigin);
    const tabB = await context.newPage();
    await operator.gotoDashboard(tabB, isolatedServer.origin("localhost"));
    await waitForTier5Viewer(agent, dummy);

    // A closes: only the loopback tab remains, which is not a tier-5 viewer (socket removal recomputes the answer).
    await page.close();
    await waitForTier5Viewer(agent, dummy, false);
    const mark = isolatedServer.logMark();
    const atRoot = await startMockSite({ dir: root, port, events: agent.events });
    if (!atRoot.ok) throw new Error(`serve_mock_site failed: ${atRoot.error}`);
    expect(atRoot.base, "tier5Viewers:false ⇒ the site is at the root").toBeNull();
    expect(agent.results.at(-1)).toMatchObject({ path: null, tier5Viewers: false });
    expect(reserveLines(isolatedServer.livePreviewLog(mark), port)).toHaveLength(0);
    await stopMockSite(port);

    // A stale/old client: a tier-5-host socket that NEVER announces `live_preview_accept` is not counted either …
    const cookie = await operatorCookieHeader(isolatedServer);
    stale = new WebSocket(`ws://127.0.0.1:${isolatedServer.port}/ws`, { headers: { host: `dash5.test:${isolatedServer.port}`, cookie } });
    await new Promise<void>((resolve, reject) => {
      stale?.once("open", () => resolve());
      stale?.once("error", reject);
    });
    await waitForTier5Viewer(agent, dummy, false);
    // … until it announces (what a reconnecting new client does on open).
    stale.send(JSON.stringify({ type: "live_preview_accept", accept: ["origin", "preview"] }));
    await waitForTier5Viewer(agent, dummy, true);
    stale.close();
    await waitForTier5Viewer(agent, dummy, false);

    // A reconnects (a fresh tab on the tier-5 host re-announces on open): the next call reserves.
    const tabA2 = await context.newPage();
    await operator.gotoDashboard(tabA2, dashOrigin);
    await waitForTier5Viewer(agent, dummy);
    const mark2 = isolatedServer.logMark();
    const reserved = await startMockSite({ dir: root, port, events: agent.events });
    if (!reserved.ok) throw new Error(`serve_mock_site failed: ${reserved.error}`);
    expect(reserved.base, "after the re-announce the next call reserves").toMatch(BASE);
    expect(reserveLines(isolatedServer.livePreviewLog(mark2), port)).toHaveLength(1);
  } finally {
    stale?.terminate();
    await stopMockSite(port);
    await agent.close();
  }
});

test("T.X26 / #X26 a server restart loses reservations and adopted pids: the old pid is 404, a re-mint issues a NEW pid, nothing is on disk", async ({ page, operator, isolatedServer, dashOrigin }) => {
  test.setTimeout(300_000);
  const agent = await AgentBridge.connect(isolatedServer);
  const root = makeLpMockProject();
  const dummy = await freeHostPort();
  const port = await freeHostPort();
  try {
    await page.clock.install();
    await operator.gotoDashboard(page, dashOrigin);
    await waitForTier5Viewer(agent, dummy);
    const tool = await startMockSite({ dir: root, port, events: agent.events });
    if (!tool.ok) throw new Error(`serve_mock_site failed: ${tool.error}`);
    const base = tool.base as string;
    expect(base).toMatch(BASE);
    const viewer = await operator.openLivePreview(page, { dashOrigin, target: `http://127.0.0.1:${port}`, session: agent });
    expect(await viewer.src(), "reservation adopted").toBe(base);
    expect((await isolatedServer.api("GET", `${base}__mock/decisions`)).status, "the adopted pid serves the site").toBe(200);

    // The viewer's port target is a persisted (preferences) allowlist entry, saved asynchronously: let it reach disk first, so the
    // restart below only loses what is in-memory by design (pids and reservations), never the target itself.
    const prefs = path.join(isolatedServer.home, ".pi", "dashboard", "preferences.json");
    await expect
      .poll(() => fs.existsSync(prefs) && JSON.stringify(JSON.parse(fs.readFileSync(prefs, "utf8"))).includes(`"port":${port}`), { message: "the port target is persisted" })
      .toBe(true);

    // Restart the server: in-memory stores only.
    await isolatedServer.restart();
    await agent.reconnect(); // the bridge reconnects
    const old = await isolatedServer.api("GET", `${base}__mock/decisions`);
    expect(old.status, "the old pid is unknown after a restart").toBe(404);
    const unknown = await isolatedServer.rawRequest({ host: new URL(dashOrigin).host, path: "/preview/AAAAAAAAAAAAAAAAAAAAAA/__mock/decisions", headers: { origin: "null" } });
    const oldBare = await isolatedServer.rawRequest({ host: new URL(dashOrigin).host, path: `${base}__mock/decisions`, headers: { origin: "null" } });
    expect({ status: oldBare.status, body: oldBare.body }, "indistinguishable from a pid that never existed").toEqual({ status: unknown.status, body: unknown.body });
    // Never persisted: the pid appears in no file of the server's HOME (config, stores, log).
    const pid = base.split("/")[2];
    let found = "";
    try {
      found = execFileSync("grep", ["-rl", "-D", "skip", "--binary-files=text", pid, isolatedServer.home], { encoding: "utf8" });
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw e; // 1 = no match
    }
    expect(found, "no reservation / pid resurrected from disk").toBe("");

    // The open viewer re-mints (its keepalive fails against the restarted server): a NEW pid, with the restart notice.
    await page.clock.fastForward("05:30");
    await expect(page.getByTestId("live-base-path")).not.toHaveText(base, { timeout: 60_000 });
    const newBase = (await page.getByTestId("live-base-path").textContent()) ?? "";
    expect(newBase).toMatch(BASE);
    expect(newBase).not.toBe(base);
    await expect(page.getByTestId("live-hint-base-path")).toContainText(/restart your server with this base/i);
    expect(await viewer.src(), "the frame follows the new pid").toBe(newBase);
  } finally {
    await stopMockSite(port);
    await agent.close();
  }
});
