import type { ClaimEntry } from "@blackbelt-technology/dashboard-plugin-runtime";
import { describe, expect, it } from "vitest";
import { claimsForPath, instanceKey, isUnderCwd, type LiveLite, MAX_LIVE_HANDLERS, normalizeRelPath, planMount } from "../file-handler-logic.js";

const C = () => null;
const entry = (pluginId: string, id: string, extra: Partial<ClaimEntry> = {}): ClaimEntry =>
  ({ pluginId, priority: 1000, slot: "editor-pane-file-handler", id, extensions: [".docx"], mode: "edit", label: id, Component: C, ...extra }) as ClaimEntry;

describe("claimsForPath (E7, E8)", () => {
  it("matches case-insensitively and orders by priority, plugin id, claim id", () => {
    const entries = [entry("zeta", "a", { priority: 100 }), entry("beta", "z"), entry("beta", "a"), entry("alpha", "x", { extensions: [".pptx"] })];
    expect(claimsForPath(entries, "REPORT.DOCX").map((c) => c.ref)).toEqual(["zeta/a", "beta/a", "beta/z"]);
    expect(claimsForPath(entries, "a.Docx")).toHaveLength(3);
    expect(claimsForPath(entries, "notes.md")).toEqual([]);
    expect(claimsForPath(entries, "Makefile")).toEqual([]);
  });
  it("skips claims without id / component / label", () => {
    expect(claimsForPath([entry("p", "a", { Component: undefined }), entry("p", "b", { label: undefined })], "x.docx")).toEqual([]);
  });
  it("defaults maxBytes to the core ceiling and carries keepAlive", () => {
    const [c] = claimsForPath([entry("p", "a", { keepAlive: { max: 2 } })], "x.docx");
    expect(c.keepAlive).toBe(true);
    expect(c.keepAliveMax).toBe(2);
    expect(c.maxBytes).toBe(128 * 1024 * 1024);
  });
});

describe("paths", () => {
  it("normalizeRelPath POSIX-normalises", () => {
    expect(normalizeRelPath("./a.docx")).toBe("a.docx");
    expect(normalizeRelPath("a//b/./c.docx")).toBe("a/b/c.docx");
    expect(normalizeRelPath("a/x/../b.docx")).toBe("a/b.docx");
    expect(normalizeRelPath("../x.docx")).toBe("../x.docx");
    expect(normalizeRelPath("/r/./a/../b")).toBe("/r/b");
  });
  it("instanceKey agrees for ./a.docx and a.docx and differs per claim/session", () => {
    expect(instanceKey("s", "/p", "./a.docx", "x/y")).toBe(instanceKey("s", "/p", "a.docx", "x/y"));
    expect(instanceKey("s", "/p", "a.docx", "x/y")).not.toBe(instanceKey("s", "/p", "a.docx", "x/z"));
    expect(instanceKey("s", "/p", "a.docx", "x/y")).not.toBe(instanceKey("t", "/p", "a.docx", "x/y"));
  });
  it("isUnderCwd (E9)", () => {
    expect(isUnderCwd("/proj", "a/b.docx")).toBe(true);
    expect(isUnderCwd("/proj", "./a.docx")).toBe(true);
    expect(isUnderCwd("/proj", "../other/a.docx")).toBe(false);
    expect(isUnderCwd("/proj", "a/../../x.docx")).toBe(false);
    expect(isUnderCwd("/proj", "/proj/a.docx")).toBe(true);
    expect(isUnderCwd("/proj", "/elsewhere/a.docx")).toBe(false);
    expect(isUnderCwd("/proj", "/proj2/a.docx")).toBe(false);
  });
});

describe("planMount (F4, F5)", () => {
  it("caps live handlers at 3", () => expect(MAX_LIVE_HANDLERS).toBe(3));
  const live = (...ds: Array<[string, LiveLite["dirty"], number?]>): LiveLite[] =>
    ds.map(([key, dirty, t], i) => ({ key, claimRef: "p/c", dirty, lastActivated: t ?? i }));
  const inc = { key: "new", claimRef: "p/c" };
  it("fits under the cap, and when the key is already live", () => {
    expect(planMount(live(["a", false], ["b", true]), inc)).toEqual({ kind: "fits" });
    expect(planMount(live(["a", false], ["b", true], ["new", true]), inc)).toEqual({ kind: "fits" });
  });
  it("at the cap evicts the least-recently-activated CLEAN instance", () => {
    expect(planMount(live(["a", true, 1], ["b", false, 5], ["c", false, 3]), inc)).toEqual({ kind: "evict", key: "c" });
  });
  it("never evicts dirty or unknown; blocked lists them", () => {
    expect(planMount(live(["a", true], ["b", "unknown"], ["c", true]), inc)).toEqual({ kind: "blocked", keys: ["a", "b", "c"] });
  });
  it("a claim's keepAlive.max lowers its own share before the page cap", () => {
    const l: LiveLite[] = [
      { key: "a", claimRef: "p/c", dirty: false, lastActivated: 9 },
      { key: "o", claimRef: "q/d", dirty: false, lastActivated: 1 },
    ];
    expect(planMount(l, { ...inc, keepAliveMax: 1 })).toEqual({ kind: "evict", key: "a" });
    expect(planMount(l, { ...inc, keepAliveMax: 2 })).toEqual({ kind: "fits" });
  });
});
