/** `LiveViewOnConnect` (task 6.2, #E21). See change: add-dedicated-agent-browser. */
import { describe, expect, it, vi } from "vitest";
import { AuditRing } from "../audit.js";
import { LiveViewOnConnect } from "../live-view.js";
import { OpenHandler } from "../open-handler.js";
import type { RelayLike } from "../relay/relay-manager.js";

describe("LiveViewOnConnect", () => {
  it("opens the FIRST agent tab once for the remembered session; later tabs do nothing", () => {
    const open = vi.fn();
    const lv = new LiveViewOnConnect({ open });
    lv.remember("i1", "S");
    lv.onTabCreated("i1", 5);
    lv.onTabCreated("i1", 6);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("S", "i1", 5);
  });

  it("an instance nobody remembered (or forgot) never auto-opens", () => {
    const open = vi.fn();
    const lv = new LiveViewOnConnect({ open });
    lv.onTabCreated("i1", 5);
    lv.remember("i1", "S");
    lv.forget("i1");
    lv.onTabCreated("i1", 5);
    expect(open).not.toHaveBeenCalled();
    expect(lv.size).toBe(0);
  });

  it("a refused open (e.g. tab not listed yet) is retried on the next tab, then stops after success", () => {
    const open = vi.fn().mockImplementationOnce(() => { throw new Error("unknown-tab"); });
    const lv = new LiveViewOnConnect({ open });
    lv.remember("i1", "S");
    lv.onTabCreated("i1", 5);
    lv.onTabCreated("i1", 6);
    lv.onTabCreated("i1", 7);
    expect(open.mock.calls.map((c) => c[2])).toEqual([5, 6]);
  });

  it("re-remembering (reconnect) re-arms with the new session", () => {
    const open = vi.fn();
    const lv = new LiveViewOnConnect({ open });
    lv.remember("i1", "S");
    lv.onTabCreated("i1", 1);
    lv.remember("i1", "T");
    lv.onTabCreated("i1", 2);
    expect(open.mock.calls).toEqual([["S", "i1", 1], ["T", "i1", 2]]);
  });
});

describe("#E21 auto open through OpenHandler", () => {
  it("one broadcast for auto + one for the following browser_show_in_pane within 5 s; audit `auto` + show (newest first); no rate-limited", () => {
    let t = 1_000;
    const audit = new AuditRing();
    const openEditorTab = vi.fn();
    const inst = {
      instanceId: "i1",
      profileDirectory: "@dedicated",
      tabList: () => [{ tabId: 9, url: "https://a.test/", title: "", state: "live" }],
    } as unknown as RelayLike;
    const h = new OpenHandler({ manager: { enabled: true, find: (id) => (id === "i1" ? inst : undefined) }, audit, openEditorTab, now: () => t });
    const lv = new LiveViewOnConnect({ open: (sid, iid, tab) => void h.openAuto(sid, iid, tab) });
    lv.remember("i1", "S");
    lv.onTabCreated("i1", 9);
    t += 1000;
    expect(h.handle({ instanceId: "i1", tabId: 9 }, { sessionId: "S" }).path).toBe("browser:i1:9");
    expect(openEditorTab).toHaveBeenCalledTimes(2);
    expect(audit.list().map((e) => `${e.kind}:${e.detail}`)).toEqual(["open:show accepted tab:9", "open:auto"]);
  });
});
