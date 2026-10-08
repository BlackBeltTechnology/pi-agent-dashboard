/** `browser/open` handler (#E9 #E10 #E15 #X12). See change: add-browser-editor-pane-tab (D5). */
import { describe, expect, it, vi } from "vitest";
import { AuditRing } from "../audit.js";
import { PLAYWRIGHT_EXTENSION_ID } from "../connect.js";
import { OPEN_RATE_LIMIT_MS, OpenHandler } from "../open-handler.js";
import type { RelayLike } from "../relay/relay-manager.js";

const CONNECT = `chrome-extension://${PLAYWRIGHT_EXTENSION_ID}/connect.html?token=T`;
const mkInst = (tabs: Array<{ tabId: number; url: string }>): RelayLike =>
  ({
    instanceId: "inst-1",
    profileDirectory: "Default",
    tabList: () => tabs.map((t) => ({ ...t, title: "", state: "live" })),
  }) as unknown as RelayLike;

function setup(opts: { enabled?: boolean; tabs?: Array<{ tabId: number; url: string }> } = {}) {
  let t = 1_000_000;
  const audit = new AuditRing();
  const openEditorTab = vi.fn();
  const inst = mkInst(opts.tabs ?? [{ tabId: 42, url: "https://a.test/" }]);
  const manager = { enabled: opts.enabled ?? true, find: (id: string) => (id === "inst-1" ? inst : undefined) };
  const h = new OpenHandler({ manager, audit, openEditorTab, now: () => t });
  return { h, audit, openEditorTab, advance: (ms: number) => (t += ms), setTabs: (tabs: Array<{ tabId: number; url: string }>) => { (inst as { tabList: () => unknown }).tabList = () => tabs.map((x) => ({ ...x, title: "", state: "live" })); } };
}
const open = (h: OpenHandler, payload: unknown, sessionId = "S") => h.handle(payload, { sessionId });
const kinds = (a: AuditRing) => a.list().map((e) => `${e.kind}:${e.detail}`);

describe("browser/open", () => {
  it("accepts: broadcasts via the host with the META session, audits `open`", () => {
    const { h, openEditorTab, audit } = setup();
    expect(open(h, { instanceId: "inst-1", tabId: 42 }).path).toBe("browser:inst-1:42");
    expect(openEditorTab).toHaveBeenCalledWith("S", "browser:inst-1:42");
    expect(kinds(audit)).toEqual(["open:show accepted tab:42"]);
  });

  it("#X12 a payload sessionId is ignored — the lane's session wins", () => {
    const { h, openEditorTab } = setup();
    open(h, { instanceId: "inst-1", tabId: 42, sessionId: "T" }, "S");
    expect(openEditorTab).toHaveBeenCalledWith("S", expect.any(String));
  });

  it("#X12 disabled / unknown instance / unknown tab: error names the cause, nothing broadcast, every call audited", () => {
    const off = setup({ enabled: false });
    expect(() => open(off.h, { instanceId: "inst-1", tabId: 42 })).toThrow("disabled");
    const s = setup();
    expect(() => open(s.h, { instanceId: "nope", tabId: 1 })).toThrow("unknown-instance");
    expect(() => open(s.h, { instanceId: "inst-1", tabId: 7 })).toThrow("unknown-tab");
    expect(() => open(s.h, { instanceId: "inst-1", tabId: "7" })).toThrow("unknown-tab");
    expect(() => open(s.h, null)).toThrow("unknown-instance");
    for (const x of [off, s]) expect(x.openEditorTab).not.toHaveBeenCalled();
    expect(kinds(off.audit)).toEqual(["open:show refused reason:disabled"]);
    expect(s.audit.list()).toHaveLength(5 - 1);
    expect(s.audit.list().every((e) => e.kind === "open")).toBe(true);
  });

  it("#E15 default tab excludes the connect page; only-connect-page → no-tab; then a normal tab opens", () => {
    const s = setup({ tabs: [{ tabId: 8, url: CONNECT }] });
    expect(() => open(s.h, { instanceId: "inst-1" })).toThrow("no-tab");
    expect(s.openEditorTab).not.toHaveBeenCalled();
    s.setTabs([{ tabId: 8, url: CONNECT }, { tabId: 9, url: "https://a.test/" }]);
    expect(open(s.h, { instanceId: "inst-1" }).tabId).toBe(9);
  });

  it("an explicit connect-page tabId is refused as unknown (never opened)", () => {
    const s = setup({ tabs: [{ tabId: 8, url: CONNECT }, { tabId: 9, url: "https://a.test/" }] });
    expect(() => open(s.h, { instanceId: "inst-1", tabId: 8 })).toThrow("unknown-tab");
  });

  it("a host refusal surfaces as an error, is audited, and does not consume the rate limit", () => {
    const s = setup();
    s.openEditorTab.mockImplementationOnce(() => { throw new Error("not under own prefix"); });
    expect(() => open(s.h, { instanceId: "inst-1", tabId: 42 })).toThrow(/host-refused/);
    expect(open(s.h, { instanceId: "inst-1", tabId: 42 }).path).toBe("browser:inst-1:42");
  });
});

describe("rate limit (#E9 #E10)", () => {
  it("2nd show within 5 s → rate-limited + audited refusal, nothing more broadcast; takeover still opens", () => {
    const s = setup();
    open(s.h, { instanceId: "inst-1", tabId: 42 });
    s.advance(OPEN_RATE_LIMIT_MS - 1);
    expect(() => open(s.h, { instanceId: "inst-1", tabId: 42 })).toThrow("rate-limited");
    expect(s.openEditorTab).toHaveBeenCalledTimes(1);
    expect(kinds(s.audit)[0]).toBe("open:show refused reason:rate-limited tab:42");
    open(s.h, { instanceId: "inst-1", kind: "takeover" });
    expect(s.openEditorTab).toHaveBeenCalledTimes(2);
  });

  it("the window is per (session, instance)", () => {
    const s = setup();
    open(s.h, { instanceId: "inst-1", tabId: 42 }, "S");
    expect(open(s.h, { instanceId: "inst-1", tabId: 42 }, "U").path).toBe("browser:inst-1:42");
  });

  it("a refused show does not extend the window", () => {
    const s = setup();
    open(s.h, { instanceId: "inst-1", tabId: 42 });
    s.advance(3000);
    expect(() => open(s.h, { instanceId: "inst-1", tabId: 42 })).toThrow("rate-limited");
    s.advance(2000); // 5 s after the ACCEPTED open
    expect(open(s.h, { instanceId: "inst-1", tabId: 42 }).path).toBe("browser:inst-1:42");
  });

  it("#E10 an entry older than 5 s is pruned on the next call; instance close empties the map", () => {
    const s = setup();
    open(s.h, { instanceId: "inst-1", tabId: 42 }, "A");
    open(s.h, { instanceId: "inst-1", tabId: 42 }, "B");
    expect(s.h.limiterSize).toBe(2);
    s.advance(OPEN_RATE_LIMIT_MS);
    open(s.h, { instanceId: "inst-1", tabId: 42 }, "C"); // prunes A and B
    expect(s.h.limiterSize).toBe(1);
    s.h.onInstanceClosed("inst-1");
    expect(s.h.limiterSize).toBe(0);
  });
});
