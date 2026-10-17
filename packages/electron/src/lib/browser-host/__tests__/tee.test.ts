/**
 * Local frame tee: copy only top-level-tab `Page.screencastFrame` events.
 * See change: add-operator-browser-relay (test-plan #E54 #P1).
 */

import type { BrowserHostFrame } from "@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js";
import { describe, expect, it } from "vitest";
import { createTee } from "../tee.js";
import { FakeExtension } from "./fixtures.js";

const L = "link-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const frameParams = (data = "JPEG==") => ({ data, metadata: { deviceWidth: 800, deviceHeight: 600, timestamp: 12.5, offsetTop: 0 }, sessionId: 3 });
const mk = () => {
  const frames: BrowserHostFrame[] = [];
  return { frames, tee: createTee((f) => frames.push(f)) };
};

describe("tee (E54)", () => {
  it("copies only (tab T, no session, screencastFrame); every other event is ignored by the tee", () => {
    const { tee, frames } = mk();
    tee.set(L, "X", 7, true);
    const msgs = [
      FakeExtension.debuggerEvent(7, "Page.screencastFrame", frameParams("A")),
      FakeExtension.debuggerEvent(7, "Page.screencastFrame", frameParams("B"), "child-session"),
      FakeExtension.debuggerEvent(8, "Page.screencastFrame", frameParams("C")),
      FakeExtension.debuggerEvent(7, "Page.loadEventFired", { timestamp: 1 }),
    ];
    for (const m of msgs) tee.observe(L, m);
    expect(frames).toEqual([{ instanceId: "X", tabId: 7, jpegBase64: "A", metadata: { deviceWidth: 800, deviceHeight: 600, timestamp: 12.5 } }]);
  });

  it("observe never alters or consumes the message (caller forwards the original string)", () => {
    const { tee } = mk();
    tee.set(L, "X", 7, true);
    const msg = FakeExtension.debuggerEvent(7, "Page.screencastFrame", frameParams());
    const copy = `${msg}`;
    expect(tee.observe(L, msg)).toBeUndefined();
    expect(msg).toBe(copy);
  });

  it("tee off, drop(link) and an unrelated link stop the copy; several tabs per link coexist", () => {
    const { tee, frames } = mk();
    tee.set(L, "X", 7, true);
    tee.set(L, "X", 9, true);
    tee.observe(L, FakeExtension.debuggerEvent(9, "Page.screencastFrame", frameParams("n9")));
    tee.observe("other", FakeExtension.debuggerEvent(7, "Page.screencastFrame", frameParams("x")));
    tee.set(L, "X", 7, false);
    tee.observe(L, FakeExtension.debuggerEvent(7, "Page.screencastFrame", frameParams("off")));
    expect(frames.map((f) => f.jpegBase64)).toEqual(["n9"]);
    tee.drop(L);
    tee.observe(L, FakeExtension.debuggerEvent(9, "Page.screencastFrame", frameParams("dropped")));
    expect(frames).toHaveLength(1);
  });

  it("ignores malformed / non-JSON / non-event frames without throwing", () => {
    const { tee, frames } = mk();
    tee.set(L, "X", 7, true);
    for (const m of ["not json Page.screencastFrame", "{}", '{"method":"chrome.debugger.onEvent","params":"Page.screencastFrame"}', JSON.stringify({ method: "chrome.debugger.onEvent", params: [{ tabId: 7 }, "Page.screencastFrame", { metadata: {} }] })]) {
      expect(() => tee.observe(L, m)).not.toThrow();
    }
    expect(frames).toHaveLength(0);
  });
});

describe("tee latency (P1)", () => {
  it("200 × 20 KB frames: p95 receipt → onFrame ≤ 50 ms (one run)", () => {
    const delays: number[] = [];
    let t0 = 0;
    const tee = createTee(() => delays.push(performance.now() - t0));
    tee.set(L, "X", 7, true);
    const payload = "A".repeat(20 * 1024);
    for (let i = 0; i < 200; i++) {
      const msg = FakeExtension.debuggerEvent(7, "Page.screencastFrame", frameParams(payload));
      t0 = performance.now();
      tee.observe(L, msg);
    }
    expect(delays).toHaveLength(200);
    delays.sort((a, b) => a - b);
    expect(delays[Math.floor(0.95 * delays.length) - 1]!).toBeLessThanOrEqual(50);
  });
});
