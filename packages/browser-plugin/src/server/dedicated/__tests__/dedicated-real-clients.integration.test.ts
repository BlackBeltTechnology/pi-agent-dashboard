/**
 * Real CDP clients against a `DedicatedInstance` over a `FakeChromePipe` (test-plan
 * #I1): Playwright `connectOverCDP` and `agent-browser connect` must complete their
 * handshake through the dedicated deny set, create a tab and navigate. The proxy is
 * hosted in-test with the `ws` package (the production WS route lands with the
 * routes wave); agent-browser is skipped when the binary is absent.
 * See change: add-dedicated-agent-browser (D5).
 */
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { makeRig, type Rig } from "./dedicated-rig.js";

const exec = promisify(execFile);
const hasAgentBrowser = spawnSync("agent-browser", ["--version"], { stdio: "ignore" }).status === 0;

interface Hosted extends Rig {
  url: string;
  stop(): Promise<void>;
}

async function host(): Promise<Hosted> {
  const rig = await makeRig({ attach: false });
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => rig.instance.attachCdp(ws as never));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    ...rig,
    url: `ws://127.0.0.1:${port}/ws/browser-cdp/guid`,
    stop: async () => {
      rig.instance.close("test");
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

let h: Hosted;
beforeEach(async () => {
  h = await host();
});
afterEach(async () => {
  await h.stop();
});

const noDeniedHandshake = () => expect(h.audit.list().filter((e) => e.kind === "denied")).toEqual([]);

describe("#I1 real CDP clients attach through the dedicated deny set", () => {
  it("Playwright connectOverCDP completes the handshake, sees only visible pages, creates a page and navigates", async () => {
    // a hidden sign-in tab is open while the agent connects
    const { targetId: hiddenId } = await h.instance.openHiddenTab("https://accounts.google.com/");
    const { chromium } = await import("playwright-core");
    const browser = await chromium.connectOverCDP(h.url, { timeout: 15_000 });
    try {
      const pagesAfterConnect = browser.contexts().flatMap((c) => c.pages());
      expect(pagesAfterConnect.map((p) => p.url())).toEqual(["about:blank"]);
      expect(h.pipe.targets.has(hiddenId)).toBe(true);

      const page = await browser.contexts()[0].newPage();
      expect(h.pipe.commands("Target.createTarget").some((c) => (c.params as { url?: string }).url === "about:blank")).toBe(true);
      await page.goto("https://example.com/", { timeout: 5_000 }).catch(() => {});
      const nav = h.pipe.commands("Page.navigate").at(-1);
      expect((nav?.params as { url?: string } | undefined)?.url).toBe("https://example.com/");
      expect(h.audit.list().some((e) => e.kind === "navigate" && e.detail === "https://example.com/")).toBe(true);
      // the hidden tab never became a Playwright page
      expect(browser.contexts().flatMap((c) => c.pages()).every((p) => !p.url().includes("accounts.google.com"))).toBe(true);
    } finally {
      await browser.close().catch(() => {});
    }
    noDeniedHandshake();
    // the handshake's Browser.setDownloadBehavior was acknowledged, not forwarded
    expect(h.pipe.commands("Browser.setDownloadBehavior")).toHaveLength(0);
    // …and the instance never asks Chrome to quit
    expect(h.pipe.commands("Browser.close")).toHaveLength(0);
  }, 30_000);

  it("a new connection after the previous client closed works (Chrome kept running)", async () => {
    const { chromium } = await import("playwright-core");
    const first = await chromium.connectOverCDP(h.url, { timeout: 15_000 });
    await first.close().catch(() => {});
    await h.pipe.flush(10);
    expect(h.closed).toEqual(["cdp-closed"]);
    expect(h.pipe.targets.size).toBeGreaterThan(0);
  }, 30_000);

  it.skipIf(!hasAgentBrowser)("agent-browser connect attaches and opens a URL", async () => {
    // short: agent-browser's socket path (session name + dir) caps at 103 bytes
    const session = `di${process.pid % 100000}`;
    const sockDir = fs.mkdtempSync("/tmp/ab-");
    const run = (...args: string[]) =>
      exec("agent-browser", ["--session", session, ...args], { timeout: 25_000, env: { ...process.env, AGENT_BROWSER_SOCKET_DIR: sockDir } });
    try {
      const out = await run("connect", h.url);
      expect(`${out.stdout}${out.stderr}`).not.toMatch(/No attached tab|setDownloadBehavior|denied|error/i);
      await run("open", "https://example.com/");
      expect(h.audit.list().some((e) => e.kind === "navigate" && e.detail === "https://example.com/")).toBe(true);
      noDeniedHandshake();
    } finally {
      await run("close").catch(() => {});
      fs.rmSync(sockDir, { recursive: true, force: true });
    }
  }, 60_000);
});
