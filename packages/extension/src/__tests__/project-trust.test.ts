/**
 * `project_trust` auto-decision gate + defensive cwd read.
 *
 * Deny-by-default: trust ONLY a dashboard-spawned headless session whose event
 * cwd still equals the activation cwd; every other case defers to pi's default.
 *
 * See change: adopt-pi-074-080-features (A.3 — E5, X1, X3).
 */
import { describe, expect, it } from "vitest";
import { decideProjectTrust, readEventCwd } from "../project-trust.js";

const CWD = "/work/proj";

describe("E5: decideProjectTrust 3-bool matrix", () => {
  const cwdMatch = { same: CWD, diff: "/work/other" };
  // Enumerate dashboardSpawned × isHeadless × (eventCwd===activationCwd).
  const rows: Array<[boolean, boolean, "same" | "diff", "trust" | "defer"]> = [
    [true, true, "same", "trust"], // T·T·T — the ONLY trust row
    [true, true, "diff", "defer"],
    [true, false, "same", "defer"],
    [true, false, "diff", "defer"],
    [false, true, "same", "defer"],
    [false, true, "diff", "defer"],
    [false, false, "same", "defer"],
    [false, false, "diff", "defer"],
  ];

  it.each(rows)(
    "dashboardSpawned=%s isHeadless=%s cwd=%s → %s",
    (dashboardSpawned, isHeadless, cwd, expected) => {
      expect(
        decideProjectTrust({
          dashboardSpawned,
          isHeadless,
          eventCwd: cwdMatch[cwd],
          activationCwd: CWD,
        }),
      ).toBe(expected);
    },
  );

  it("trusts on the single T·T·T row only (exactly one of the 8)", () => {
    const trusted = rows.filter(([, , , expected]) => expected === "trust");
    expect(trusted).toHaveLength(1);
  });
});

describe("X1: unreadable event cwd defers (no crash)", () => {
  it("readEventCwd returns undefined when the cwd getter throws", () => {
    const staleCtx = {
      get cwd(): string {
        throw new Error("session replaced — cwd getter throws");
      },
    };
    expect(readEventCwd(undefined, staleCtx)).toBeUndefined();
  });

  it("an undefined eventCwd defers even for a dashboard-spawned headless session", () => {
    expect(
      decideProjectTrust({ dashboardSpawned: true, isHeadless: true, eventCwd: undefined, activationCwd: CWD }),
    ).toBe("defer");
  });

  it("prefers the event cwd, falls back to ctx cwd", () => {
    expect(readEventCwd({ cwd: "/from/event" }, { cwd: "/from/ctx" })).toBe("/from/event");
    expect(readEventCwd({}, { cwd: "/from/ctx" })).toBe("/from/ctx");
    expect(readEventCwd(null, null)).toBeUndefined();
  });
});

describe("X3: activation-cwd capture guards the pre-session_start ordering", () => {
  it("a defined activationCwd (captured at activation, not session_start) compares real cwds", () => {
    // The event fires BEFORE session_start; because activationCwd is captured
    // at bridge activation it is already a real path, so the gate compares
    // real cwds and can trust — instead of comparing against `undefined`.
    expect(
      decideProjectTrust({ dashboardSpawned: true, isHeadless: true, eventCwd: CWD, activationCwd: CWD }),
    ).toBe("trust");
  });

  it("regression: if activationCwd had been captured too late (undefined), it would defer", () => {
    // Documents the cycle-2 dead-on-arrival bug the activation capture fixes.
    expect(
      decideProjectTrust({
        dashboardSpawned: true,
        isHeadless: true,
        eventCwd: CWD,
        activationCwd: undefined as unknown as string,
      }),
    ).toBe("defer");
  });
});
