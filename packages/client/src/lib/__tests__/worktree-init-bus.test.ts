/**
 * Tests for the worktree-init event bus.
 *
 * Pins the cwd-addressed delivery + subscribe/unsubscribe wire messages and
 * the reconnect resubscribe path (server drops subs on ws close).
 *
 * See change: friendlier-worktree-init.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import {
  dispatchInitEvent,
  resendActiveCwdSubscriptions,
  setInitSender,
  subscribeInitByCwd,
  __resetInitBusForTests,
} from "../worktree-init-bus.js";

afterEach(() => { __resetInitBusForTests(); });

describe("worktree-init bus — cwd channel", () => {
  it("subscribeInitByCwd sends a subscribe message and receives cwd-addressed events", () => {
    const sent: BrowserToServerMessage[] = [];
    setInitSender((m) => sent.push(m));
    const seen: string[] = [];
    subscribeInitByCwd("/w/a", (ev) => { if (ev.type === "worktree_init_progress") seen.push(ev.line); });
    expect(sent).toEqual([{ type: "worktree_init_subscribe", cwd: "/w/a" }]);
    dispatchInitEvent({ type: "worktree_init_progress", requestId: "", cwd: "/w/a", line: "hi" });
    expect(seen).toEqual(["hi"]);
  });

  it("cross-tab: two cwd listeners both receive the same event", () => {
    setInitSender(() => {});
    const a: string[] = []; const b: string[] = [];
    subscribeInitByCwd("/w/a", (ev) => { if (ev.type === "worktree_init_done") a.push(ev.cwd); });
    subscribeInitByCwd("/w/a", (ev) => { if (ev.type === "worktree_init_done") b.push(ev.cwd); });
    dispatchInitEvent({ type: "worktree_init_done", requestId: "", cwd: "/w/a", durationMs: 1 });
    expect(a).toEqual(["/w/a"]);
    expect(b).toEqual(["/w/a"]);
  });

  it("last unsubscribe sends an unsubscribe message", () => {
    const sent: BrowserToServerMessage[] = [];
    setInitSender((m) => sent.push(m));
    const off = subscribeInitByCwd("/w/a", () => {});
    off();
    expect(sent).toContainEqual({ type: "worktree_init_unsubscribe", cwd: "/w/a" });
  });

  it("resendActiveCwdSubscriptions re-sends subscribe for every active cwd (reconnect)", () => {
    setInitSender(() => {});
    subscribeInitByCwd("/w/a", () => {});
    subscribeInitByCwd("/w/b", () => {});
    const sent: BrowserToServerMessage[] = [];
    setInitSender((m) => sent.push(m)); // new socket after reconnect
    resendActiveCwdSubscriptions();
    expect(sent).toContainEqual({ type: "worktree_init_subscribe", cwd: "/w/a" });
    expect(sent).toContainEqual({ type: "worktree_init_subscribe", cwd: "/w/b" });
  });
});
