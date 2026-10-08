/**
 * #X6 route + status half: even a raw (unredacted) instance never leaks the
 * token / guid / connect page through `/api/browser/profiles`, `/audit` or the
 * `browser_relay_status` snapshot. See change: add-browser-editor-pane-tab.
 */
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { AuditRing } from "../audit.js";
import { PLAYWRIGHT_EXTENSION_ID } from "../connect.js";
import type { RelayLike } from "../relay/relay-manager.js";
import { registerBrowserRoutes } from "../routes.js";
import { BrowserRelayStatus } from "../status.js";

const CONNECT = `chrome-extension://${PLAYWRIGHT_EXTENSION_ID}/connect.html?mcpRelayUrl=ws%3A%2F%2Fh%2Fws%2Fbrowser%2FGUIDXYZ&token=TOKXYZ`;
const raw: RelayLike = {
  instanceId: "i1",
  profileDirectory: "Default",
  tabList: () => [
    { tabId: 1, title: "A", url: "https://a.test/", state: "live" },
    { tabId: 2, title: "Connect", url: CONNECT, state: "live" },
    { tabId: 3, title: "Ext", url: "chrome-extension://zzz/p.html?x=1#f", state: "live" },
  ],
  statusState: () => "connected",
  subscribe: () => ({ ok: true }),
  unsubscribe: () => {},
  unsubscribeAll: () => {},
  input: async () => {},
  close: () => {},
} as unknown as RelayLike;

const noLog = { info: () => {}, warn: () => {}, error: () => {} };

describe("viewer egress redaction (#X6)", () => {
  it("status snapshot and /api/browser/profiles omit the connect page and strip extension query/fragment", async () => {
    const audit = new AuditRing();
    audit.append({ profileDirectory: "Default", instanceId: "i1", kind: "navigate", detail: CONNECT });
    const manager = { instances: () => [raw], find: () => raw };
    const status = new BrowserRelayStatus({ manager, audit, broadcast: vi.fn(), logger: noLog });
    const snap = JSON.stringify(status.message());
    expect(snap).not.toMatch(/TOKXYZ|GUIDXYZ|token=|mcpRelayUrl|connect\.html/);
    expect(status.message().instances[0].tabs.map((t) => t.tabId)).toEqual([1, 3]);
    expect(status.message().instances[0].tabs[1].url).toBe("chrome-extension://zzz/p.html");

    const app = Fastify();
    registerBrowserRoutes(app, {
      manager: { enabled: true, connect: async () => ({ ok: false, status: 503 }), disconnect: () => false, setEnabled: async () => {}, instances: () => [raw], profileConfig: () => ({}) } as never,
      audit,
      getConfig: () => ({}) as never,
      canOpenChrome: () => true,
      listProfiles: async () => ({ profiles: [{ profileDirectory: "Default", label: "D", installed: true }] }),
      updateConfig: async () => {},
      logger: noLog,
    });
    await app.ready();
    for (const url of ["/api/browser/profiles", "/api/browser/audit"]) {
      const res = await app.inject({ method: "GET", url });
      // (audit detail keeps the query-stripped path; only secrets must be gone)
      expect(res.body, url).not.toMatch(/TOKXYZ|GUIDXYZ|token=|mcpRelayUrl/);
      if (url.endsWith("profiles")) expect(res.body).not.toContain("connect.html");
    }
    await app.close();
  });
});
