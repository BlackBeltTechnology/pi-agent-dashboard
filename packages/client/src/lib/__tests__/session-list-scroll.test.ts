import { describe, it, expect } from "vitest";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { selectedCardScrollFingerprint } from "../session/session-list-scroll.js";

function session(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/repo",
    source: "tui",
    status: "active",
    startedAt: 0,
    ...overrides,
  } as DashboardSession;
}

describe("selectedCardScrollFingerprint", () => {
  it("returns null when selectedId is undefined", () => {
    expect(selectedCardScrollFingerprint(undefined, [session()], undefined)).toBeNull();
  });

  it("returns null when selectedId is not in sessions", () => {
    expect(selectedCardScrollFingerprint("missing", [session()], undefined)).toBeNull();
  });

  it("produces a stable string for unchanged inputs", () => {
    const sessions = [session({ id: "s1" })];
    const order = new Map([["/repo", ["s1"]]]);
    const a = selectedCardScrollFingerprint("s1", sessions, order);
    const b = selectedCardScrollFingerprint("s1", sessions, order);
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it("differs when status flips", () => {
    const order = new Map([["/repo", ["s1"]]]);
    const a = selectedCardScrollFingerprint("s1", [session({ status: "active" })], order);
    const b = selectedCardScrollFingerprint("s1", [session({ status: "ended" })], order);
    expect(a).not.toBe(b);
  });

  it("differs when hidden toggles", () => {
    const order = new Map([["/repo", ["s1"]]]);
    const a = selectedCardScrollFingerprint("s1", [session({ hidden: false })], order);
    const b = selectedCardScrollFingerprint("s1", [session({ hidden: true })], order);
    expect(a).not.toBe(b);
  });

  it("differs when cwd changes", () => {
    const orderA = new Map([["/a", ["s1"]]]);
    const orderB = new Map([["/b", ["s1"]]]);
    const a = selectedCardScrollFingerprint("s1", [session({ cwd: "/a" })], orderA);
    const b = selectedCardScrollFingerprint("s1", [session({ cwd: "/b" })], orderB);
    expect(a).not.toBe(b);
  });

  it("differs when order index changes", () => {
    const sessions = [session({ id: "s1" })];
    const orderA = new Map([["/repo", ["s1", "s2"]]]);
    const orderB = new Map([["/repo", ["s2", "s1"]]]);
    const a = selectedCardScrollFingerprint("s1", sessions, orderA);
    const b = selectedCardScrollFingerprint("s1", sessions, orderB);
    expect(a).not.toBe(b);
  });

  it("is stable when only non-position-affecting fields change", () => {
    const order = new Map([["/repo", ["s1"]]]);
    const a = selectedCardScrollFingerprint(
      "s1",
      [session({ currentTool: "bash", tokensIn: 1, tokensOut: 2, cost: 0.1, model: "x" })],
      order,
    );
    const b = selectedCardScrollFingerprint(
      "s1",
      [session({ currentTool: "edit", tokensIn: 99, tokensOut: 99, cost: 9.9, model: "y" })],
      order,
    );
    expect(a).toBe(b);
  });

  it("treats missing order map as orderIdx -1 stably", () => {
    const a = selectedCardScrollFingerprint("s1", [session()], undefined);
    const b = selectedCardScrollFingerprint("s1", [session()], new Map());
    expect(a).toBe(b);
    expect(a).toContain("|-1");
  });
});
