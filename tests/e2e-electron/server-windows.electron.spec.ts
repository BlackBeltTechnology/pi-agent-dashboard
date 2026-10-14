/**
 * Electron-E2E: add-electron-server-windows (test-plan X1–X5, X13).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 pins every decision behind fakes. Only the REAL app shows that: a manual URL
 * pairs through the real remote-connect + connecting windows (real preload, real
 * IPC sender checks); `session.fetch` really lands the device cookie in the
 * server's OWN partition (never the default session) BEFORE the origin loads; the
 * server window really has no preload bridge; revocation / key takeover really
 * blank the window or refuse the open; and `servers:changed` pushes really reach
 * only trusted windows.
 *
 * ACTORS
 * ------
 * - Local dashboard: `FakeHealthServer` on :8000 (loopback — "this" dashboard).
 * - Remote dashboard: `FakeRemoteDashboard` — a REAL Ed25519 identity answering
 *   `/api/pair/*` + `/api/device-session`, bound to the first NON-internal IPv4
 *   (a manual loopback URL is refused by design).
 * - Native `dialog.showMessageBox` is stubbed in main (it cannot be clicked).
 *
 * Run: `PW_ELECTRON_DEV=1 npx playwright test --config playwright.electron.config.ts server-windows`
 * (working tree under tsx) or against the packaged app (default).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type ElectronApplication, expect, type Page, test } from "@playwright/test";
import {
  clickAppMenuItem,
  FAKE_PORT,
  type FakeHealthServer,
  type FakeRemoteDashboard,
  firstNonInternalIPv4,
  isPortInUse,
  launchElectron,
  makeThrowawayHome,
  readDialogCalls,
  readServersMenu,
  startFakeHealthServer,
  startFakeRemoteDashboard,
  stubDialog,
} from "./electron-lifecycle.js";

let local: FakeHealthServer | undefined;
let remote: FakeRemoteDashboard | undefined;
let app: ElectronApplication | undefined;
let home: string | undefined;

test.beforeAll(async () => {
  test.skip(await isPortInUse(FAKE_PORT), `port ${FAKE_PORT} in use — stop your local dashboard first`);
  test.skip(!firstNonInternalIPv4(), "no non-internal IPv4 address on this machine");
});

test.afterEach(async () => {
  if (app) { await app.close().catch(() => {}); app = undefined; }
  if (local) { await local.close().catch(() => {}); local = undefined; }
  if (remote) { await remote.close().catch(() => {}); remote = undefined; }
  if (home) { fs.rmSync(home, { recursive: true, force: true }); home = undefined; }
});

const BENIGN_HEALTH = {
  pid: 4242,
  version: "0.0.0",
  launchSource: "standalone",
  launchSourceEffective: "standalone",
  starter: "Standalone",
  bootParentPid: process.pid,
  ppid: process.pid,
  bootParentAlive: true,
  activeBridgeCount: 0,
  mode: "production",
};

/** Wait for a window (existing or new) whose URL satisfies `match`. */
async function windowWhere(a: ElectronApplication, match: (url: string) => boolean, timeout = 30_000): Promise<Page> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = a.windows().find((w) => !w.isClosed() && match(w.url()));
    if (found) return found;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`[electron-e2e] window not found; open windows: ${JSON.stringify(a.windows().map((w) => (w.isClosed() ? "(closed)" : w.url())))}`);
}

const shortFp = (fp: string) => `sha256:${fp.slice("sha256:".length, "sha256:".length + 16)}`;
const partitionNames = (fp: string) => {
  const name = `server-${crypto.createHash("sha256").update(fp).digest("hex").slice(0, 32)}`;
  return [`persist:${name}`, name];
};

/** Launch, open Connect…, enter the fake's URL, send the request, wait for the server window. */
async function pairAndOpen(opts: { knock?: { refuse?: string } } = {}): Promise<{ rc: Page; connecting: Page; serverWin: Page | undefined }> {
  local = await startFakeHealthServer(BENIGN_HEALTH);
  remote = await startFakeRemoteDashboard(opts);
  home = makeThrowawayHome(local.port);
  app = await launchElectron({ home, zombiePrompt: false });
  await app.firstWindow();
  await stubDialog(app, 2); // "Close" for any main-owned dialog

  await clickAppMenuItem(app, "Connect to Remote Dashboard…");
  const rc = await windowWhere(app, (u) => u.endsWith("remote-connect.html"));
  await rc.fill("#remote-url", remote.origin);
  await rc.click("#window-btn");

  const connecting = await windowWhere(app, (u) => u.endsWith("connecting.html"));
  // Trust on first use: the full proven fingerprint is shown; nothing is sent until "Send request".
  await expect(connecting.locator("#full-fp")).toHaveText(remote.fingerprint);
  expect(remote.requests.some((r) => r.url === "/api/pair/request")).toBe(false);
  await connecting.click("#btn-send");
  await expect(connecting.locator("#code")).toHaveText("4821 7730");
  if (opts.knock?.refuse) return { rc, connecting, serverWin: undefined };

  const serverWin = await windowWhere(app, (u) => u.startsWith(remote!.origin), 45_000);
  return { rc, connecting, serverWin };
}

test("X1: pair via manual URL, then the server window loads its own origin with the cookie", async () => {
  const { serverWin } = await pairAndOpen();
  const r = remote!;
  const mainUrl = app!.windows().find((w) => w.url().includes(`localhost:${FAKE_PORT}`))?.url();

  // The exchange (bearer) happened BEFORE the origin's first GET /
  const exchangeAt = r.requests.findIndex((q) => q.method === "POST" && q.url === "/api/device-session");
  const firstGetRoot = r.requests.findIndex((q) => q.method === "GET" && q.url === "/");
  expect(exchangeAt).toBeGreaterThanOrEqual(0);
  expect(firstGetRoot).toBeGreaterThan(exchangeAt);
  expect(r.requests[exchangeAt]!.authorization).toBe(`Bearer ${r.token}`);

  // Subsequent /api/ calls from the window carry the device cookie.
  const echoed = await serverWin!.evaluate(() => fetch("/api/ping").then((x) => x.json()));
  expect(echoed.cookie).toContain(`pi_dash_device=${r.token}`);

  // The local dashboard window is untouched.
  expect(mainUrl).toBeTruthy();
});

test("X2: the device cookie lives only in the server's own partition", async () => {
  await pairAndOpen();
  const fp = remote!.fingerprint;
  const names = await app!.evaluate(async ({ session }, parts) => {
    const out: Record<string, string[]> = { default: (await session.defaultSession.cookies.get({})).map((c) => c.name) };
    for (const p of parts) out[p] = (await session.fromPartition(p).cookies.get({})).map((c) => c.name);
    return out;
  }, partitionNames(fp));
  expect(names.default).not.toContain("pi_dash_device");
  const holders = partitionNames(fp).filter((p) => names[p]!.includes("pi_dash_device"));
  expect(holders).toHaveLength(1);
});

test("X3: the server window has no app bridge", async () => {
  const { serverWin } = await pairAndOpen();
  const types = await serverWin!.evaluate(() => [
    typeof (window as unknown as { piDashboard?: unknown }).piDashboard,
    typeof (window as unknown as { remoteConnect?: unknown }).remoteConnect,
    typeof (window as unknown as { connecting?: unknown }).connecting,
    typeof (globalThis as unknown as { require?: unknown }).require,
  ]);
  expect(types).toEqual(["undefined", "undefined", "undefined", "undefined"]);
});

test("X13: servers:list reaches the remote-connect window; servers:changed never reaches a server window", async () => {
  const { rc, serverWin } = await pairAndOpen();
  const state = await rc.evaluate(() => (window as unknown as { remoteConnect: { listServers(): Promise<{ paired: unknown[] }> } }).remoteConnect.listServers());
  expect(state.paired.length).toBe(1);

  await app!.evaluate(({ webContents }) => {
    const g = globalThis as unknown as { __sends: Array<{ url: string; channel: string }> };
    g.__sends = [];
    for (const wc of webContents.getAllWebContents()) {
      const orig = wc.send.bind(wc);
      wc.send = ((channel: string, ...args: unknown[]) => {
        g.__sends.push({ url: wc.getURL(), channel });
        return orig(channel, ...args);
      }) as typeof wc.send;
    }
  });
  // A keyring change (Forget) broadcasts servers:changed.
  const listed = (await rc.evaluate(() => (window as unknown as { remoteConnect: { listServers(): Promise<{ paired: Array<{ fingerprint: string }> }> } }).remoteConnect.listServers())).paired;
  await rc.evaluate((fp) => (window as unknown as { remoteConnect: { forgetServer(fp: string): Promise<unknown> } }).remoteConnect.forgetServer(fp), listed[0]!.fingerprint);
  await expect.poll(async () => (await app!.evaluate(() => (globalThis as unknown as { __sends: unknown[] }).__sends)).length).toBeGreaterThan(0);
  const sends = (await app!.evaluate(() => (globalThis as unknown as { __sends: Array<{ url: string; channel: string }> }).__sends)).filter((s) => s.channel === "servers:changed");
  expect(sends.length).toBeGreaterThan(0);
  expect(sends.every((s) => !s.url.startsWith(remote!.origin))).toBe(true);
  void serverWin;
});

test("X4: a revoked device is not loaded; the entry needs pairing and one dialog is offered", async () => {
  const { serverWin } = await pairAndOpen();
  const r = remote!;
  await serverWin!.close();
  r.revokeDevice();
  const rootGetsBefore = r.requests.filter((q) => q.method === "GET" && q.url === "/").length;
  await stubDialog(app!, 2);

  await clickAppMenuItem(app!, r.host);
  await expect.poll(async () => (await readDialogCalls(app!)).length).toBe(1);
  await new Promise((res) => setTimeout(res, 1500)); // a duplicate prompt would land by now
  expect((await readDialogCalls(app!)).length).toBe(1);
  const call = (await readDialogCalls(app!))[0]!;
  expect(call.buttons).toEqual(["Pair again", "Forget", "Close"]);
  expect(r.requests.filter((q) => q.method === "GET" && q.url === "/").length).toBe(rootGetsBefore);
  await expect.poll(() => readServersMenu(app!)).toContain(`${r.host} — needs pairing`);
});

test("X5: an address taken over by another identity blanks the window and removes the cookie", async () => {
  const { serverWin } = await pairAndOpen();
  const r = remote!;
  const oldFp = r.fingerprint;
  r.swapKey();
  const newFp = r.fingerprint;
  // Re-verify now (as on system resume) rather than waiting for the 60 s interval.
  await app!.evaluate(({ powerMonitor }) => void powerMonitor.emit("resume"));
  await expect.poll(() => serverWin!.url(), { timeout: 20_000 }).toBe("about:blank");

  const left = await app!.evaluate(async ({ session }, parts) => {
    const names: string[] = [];
    for (const p of parts) names.push(...(await session.fromPartition(p).cookies.get({})).map((c) => c.name));
    return names;
  }, partitionNames(oldFp));
  expect(left).not.toContain("pi_dash_device");

  const logPath = path.join(process.env.TEMP || process.env.TMP || os.tmpdir(), "pi-dashboard-electron.log");
  await expect
    .poll(() => fs.readFileSync(logPath, "utf8").split("\n").filter((l) => l.includes("identity mismatch while open")).at(-1) ?? "")
    .toContain(shortFp(oldFp));
  const line = fs.readFileSync(logPath, "utf8").split("\n").filter((l) => l.includes("identity mismatch while open")).at(-1)!;
  expect(line).toContain(shortFp(newFp));
  expect(line).not.toContain(r.token);
});
