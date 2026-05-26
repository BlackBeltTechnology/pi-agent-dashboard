/**
 * Round-trip serialization for the cwd_missing extension→server message
 * + the cwdMissing field on DashboardSession.
 *
 * See change: add-worktree-lifecycle-actions.
 */
import { describe, it, expect } from "vitest";
import type { CwdMissingMessage, ExtensionToServerMessage } from "../protocol.js";
import type { DashboardSession } from "../types.js";

describe("CwdMissingMessage", () => {
  it("round-trips via JSON", () => {
    const msg: CwdMissingMessage = { type: "cwd_missing", sessionId: "abc-123" };
    const wire = JSON.stringify(msg);
    const back = JSON.parse(wire) as CwdMissingMessage;
    expect(back).toEqual(msg);
  });

  it("is assignable to ExtensionToServerMessage union", () => {
    const msg: ExtensionToServerMessage = {
      type: "cwd_missing",
      sessionId: "x",
    };
    expect(msg.type).toBe("cwd_missing");
  });
});

describe("DashboardSession.cwdMissing", () => {
  it("accepts true / false / undefined", () => {
    const ok: Partial<DashboardSession> = { cwdMissing: true };
    const off: Partial<DashboardSession> = { cwdMissing: false };
    const absent: Partial<DashboardSession> = {};
    expect(ok.cwdMissing).toBe(true);
    expect(off.cwdMissing).toBe(false);
    expect(absent.cwdMissing).toBeUndefined();
  });

  it("survives JSON round-trip with cwdMissing: true", () => {
    const s: Partial<DashboardSession> = {
      id: "s1",
      cwd: "/gone",
      cwdMissing: true,
    } as any;
    const back = JSON.parse(JSON.stringify(s));
    expect(back.cwdMissing).toBe(true);
  });
});
