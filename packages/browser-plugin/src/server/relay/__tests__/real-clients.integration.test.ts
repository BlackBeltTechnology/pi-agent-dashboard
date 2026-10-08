/**
 * Real CDP clients against a relay backed by `FakeExtension` (#X1, #X2): both
 * Playwright `connectOverCDP` and `agent-browser connect` must attach, create a
 * target and navigate. The relay is the ONLY thing under test; the fake
 * extension scripts just enough of Chrome's answers for the handshake.
 * agent-browser is skipped (with a reason) when absent.
 * See change: add-browser-editor-pane-tab (task 3.6, D7).
 */
import { execFile, spawnSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { AuditRing } from "../../audit.js";
import { RelayInstance } from "../relay-instance.js";
import { FakeExtension, flush, socketPair } from "./fake-socket.js";

const exec = promisify(execFile);
const silent = { info: () => {}, warn: () => {}, error: () => {} };
const hasAgentBrowser = spawnSync("agent-browser", ["--version"], { stdio: "ignore" }).status === 0;

interface Rig {
  url: string;
  ext: FakeExtension;
  audit: AuditRing;
  instance: RelayInstance;
  close(): Promise<void>;
}

const FRAME = (url: string, loaderId = "LOADER1") => ({
  id: "FRAME1",
  loaderId,
  url,
  domainAndRegistry: "",
  securityOrigin: "",
  mimeType: "text/html",
  secureContextType: "Secure",
  crossOriginIsolatedContextType: "NotIsolated",
  gatedAPIFeatures: [],
});

async function rig(): Promise<Rig> {
  const audit = new AuditRing();
  const instance = new RelayInstance({
    instanceId: "inst",
    profileDirectory: "Default",
    allowedDomains: [],
    audit,
    logger: silent,
    onClosed: () => {},
    onStatusChange: () => {},
  });
  const [relayExt, extSide] = socketPair();
  instance.attachExtension(relayExt);
  const tabs = [{ id: 7, title: "start", url: "about:blank" }];
  const ext = new FakeExtension(extSide, tabs);
  let current = "about:blank";
  let navSeq = 1;
  ext.respond = (method, params) => {
    switch (method) {
      case "Page.getFrameTree":
        return { frameTree: { frame: FRAME(current), childFrames: [] } };
      case "Page.navigate": {
        current = (params as { url: string }).url;
        tabs[0].url = current;
        const loaderId = `LOADER-${++navSeq}`;
        setTimeout(() => {
          ext.emitChromeEvent(7, "Page.frameNavigated", { frame: FRAME(current, loaderId) });
          for (const name of ["init", "commit", "DOMContentLoaded", "load"]) {
            ext.emitChromeEvent(7, "Page.lifecycleEvent", { frameId: "FRAME1", loaderId, name, timestamp: 2 });
          }
          ext.emitChromeEvent(7, "Page.loadEventFired", { timestamp: 2 });
        }, 20);
        return { frameId: "FRAME1", loaderId };
      }
      case "Runtime.enable":
        setTimeout(() => {
          ext.emitChromeEvent(7, "Runtime.executionContextCreated", {
            context: { id: 1, origin: "", name: "", uniqueId: "ctx-1", auxData: { isDefault: true, type: "default", frameId: "FRAME1" } },
          });
        }, 5);
        return {};
      case "Runtime.evaluate":
        return { result: { type: "string", value: current } };
      case "Page.addScriptToEvaluateOnNewDocument":
        return { identifier: "1" };
      case "Page.createIsolatedWorld":
        return { executionContextId: 2 };
      default:
        return {};
    }
  };

  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => instance.attachCdp(ws as never));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  ext.initialize();
  await flush();
  return {
    url: `ws://127.0.0.1:${port}/cdp`,
    ext,
    audit,
    instance,
    close: async () => {
      instance.close("test");
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

let r: Rig;
beforeEach(async () => {
  r = await rig();
});
afterEach(async () => {
  await r.close();
});

describe("real CDP clients attach through the relay", () => {
  // Playwright's page init needs far more of Chrome than the fake scripts
  // (execution contexts, frame lifecycle), so `page.goto` cannot complete
  // against it. What the RELAY owes — and what this pins — is the handshake:
  // connect, the pre-attach verbs, and the attached page being visible.
  // Navigation through the relay is pinned by the agent-browser test below
  // and by the CDP-level relay-instance tests.
  it("#X2 Playwright connectOverCDP completes the handshake and sees the attached tab", async () => {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.connectOverCDP(r.url, { timeout: 15_000 });
    try {
      const pages = browser.contexts().flatMap((c) => c.pages());
      expect(pages).toHaveLength(1);
    } finally {
      await browser.close().catch(() => {});
    }
    // The handshake's Browser.setDownloadBehavior was acknowledged, not denied.
    expect(r.audit.list().some((e) => e.kind === "dropped" && e.detail === "Browser.setDownloadBehavior")).toBe(true);
    expect(r.audit.list().some((e) => e.kind === "denied")).toBe(false);
  }, 30_000);

  it.skipIf(!hasAgentBrowser)("#X1 agent-browser connect attaches and opens a URL", async () => {
    const session = `relay-it-${process.pid}`;
    const run = (...args: string[]) => exec("agent-browser", ["--session", session, ...args], { timeout: 25_000 });
    try {
      const out = await run("connect", r.url);
      expect(`${out.stdout}${out.stderr}`).not.toMatch(/No attached tab|setDownloadBehavior|error/i);
      await run("open", "https://example.com/");
      expect(r.audit.list().some((e) => e.kind === "navigate" && e.detail === "https://example.com/")).toBe(true);
    } finally {
      await run("close").catch(() => {});
    }
  }, 60_000);
});
