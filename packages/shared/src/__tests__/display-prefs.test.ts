import { describe, expect, it } from "vitest";
import {
  DISPLAY_PRESETS,
  type DisplayPrefs,
  NOTIFY_MIN_LEVELS,
  isNotifyRowVisible,
  mergeDisplayPrefs,
  normalizeNotifyMinLevel,
  toolCallPrefKey,
} from "../display-prefs.js";

const global: DisplayPrefs = DISPLAY_PRESETS.standard;

describe("mergeDisplayPrefs", () => {
  it("returns a defensive copy of global when override is undefined", () => {
    const merged = mergeDisplayPrefs(global, undefined);
    expect(merged).toEqual(global);
    expect(merged).not.toBe(global);
    expect(merged.toolCalls).not.toBe(global.toolCalls);
  });

  it("returns a defensive copy of global when override is empty", () => {
    const merged = mergeDisplayPrefs(global, {});
    expect(merged).toEqual(global);
  });

  it("applies sparse top-level override", () => {
    const merged = mergeDisplayPrefs(global, { reasoning: true });
    expect(merged.reasoning).toBe(true);
    expect(merged.tokenStatsBar).toBe(global.tokenStatsBar);
    expect(merged.toolResults).toBe(global.toolResults);
  });

  it("deep-merges toolCalls", () => {
    const merged = mergeDisplayPrefs(global, { toolCalls: { bash: false } });
    expect(merged.toolCalls.bash).toBe(false);
    expect(merged.toolCalls.read).toBe(global.toolCalls.read);
    expect(merged.toolCalls.edit).toBe(global.toolCalls.edit);
    expect(merged.toolCalls.agent).toBe(global.toolCalls.agent);
    expect(merged.toolCalls.generic).toBe(global.toolCalls.generic);
  });

  it("treats undefined fields as inherit-from-global, not false", () => {
    // explicit `false` overrides; missing key inherits
    const merged = mergeDisplayPrefs(
      { ...global, reasoning: true },
      { reasoning: false },
    );
    expect(merged.reasoning).toBe(false);
  });

  it("defaults reasoningAutoCollapseMs to 30000 in all presets", () => {
    expect(DISPLAY_PRESETS.simple.reasoningAutoCollapseMs).toBe(30000);
    expect(DISPLAY_PRESETS.standard.reasoningAutoCollapseMs).toBe(30000);
    expect(DISPLAY_PRESETS.everything.reasoningAutoCollapseMs).toBe(30000);
  });

  it("applies reasoningAutoCollapseMs override precedence", () => {
    const merged = mergeDisplayPrefs(global, { reasoningAutoCollapseMs: 5000 });
    expect(merged.reasoningAutoCollapseMs).toBe(5000);
  });

  it("preserves an explicit 0 override (not coerced to global default)", () => {
    const merged = mergeDisplayPrefs(global, { reasoningAutoCollapseMs: 0 });
    expect(merged.reasoningAutoCollapseMs).toBe(0);
  });

  it("defaults keepReasoningOpenUntilTurnEnds to false in all presets", () => {
    expect(DISPLAY_PRESETS.simple.keepReasoningOpenUntilTurnEnds).toBe(false);
    expect(DISPLAY_PRESETS.standard.keepReasoningOpenUntilTurnEnds).toBe(false);
    expect(DISPLAY_PRESETS.everything.keepReasoningOpenUntilTurnEnds).toBe(false);
  });

  it("applies keepReasoningOpenUntilTurnEnds override precedence", () => {
    const merged = mergeDisplayPrefs(global, { keepReasoningOpenUntilTurnEnds: true });
    expect(merged.keepReasoningOpenUntilTurnEnds).toBe(true);
  });

  it("defaults toolGroupDefaultCollapsed to false in all presets", () => {
    expect(DISPLAY_PRESETS.simple.toolGroupDefaultCollapsed).toBe(false);
    expect(DISPLAY_PRESETS.standard.toolGroupDefaultCollapsed).toBe(false);
    expect(DISPLAY_PRESETS.everything.toolGroupDefaultCollapsed).toBe(false);
  });

  it("applies toolGroupDefaultCollapsed override precedence", () => {
    expect(mergeDisplayPrefs(global, { toolGroupDefaultCollapsed: true }).toolGroupDefaultCollapsed).toBe(true);
    // missing key inherits the global value
    expect(
      mergeDisplayPrefs({ ...global, toolGroupDefaultCollapsed: true }, {}).toolGroupDefaultCollapsed,
    ).toBe(true);
  });

  it("defaults changeSummaryTable off in simple, on in standard/everything", () => {
    expect(DISPLAY_PRESETS.simple.changeSummaryTable).toBe(false);
    expect(DISPLAY_PRESETS.standard.changeSummaryTable).toBe(true);
    expect(DISPLAY_PRESETS.everything.changeSummaryTable).toBe(true);
  });

  it("applies changeSummaryTable override precedence (off beats global on)", () => {
    expect(mergeDisplayPrefs(global, { changeSummaryTable: false }).changeSummaryTable).toBe(false);
    // missing key inherits the global value
    expect(mergeDisplayPrefs(global, {}).changeSummaryTable).toBe(true);
  });

  it("defaults reserveProcessLineAtIdle off in simple/standard, on in everything", () => {
    expect(DISPLAY_PRESETS.simple.reserveProcessLineAtIdle).toBe(false);
    expect(DISPLAY_PRESETS.standard.reserveProcessLineAtIdle).toBe(false);
    expect(DISPLAY_PRESETS.everything.reserveProcessLineAtIdle).toBe(true);
  });

  it("applies reserveProcessLineAtIdle override precedence (on beats global off)", () => {
    expect(mergeDisplayPrefs(global, { reserveProcessLineAtIdle: true }).reserveProcessLineAtIdle).toBe(true);
    // missing key inherits the global value
    expect(mergeDisplayPrefs(global, {}).reserveProcessLineAtIdle).toBe(false);
    // explicit false beats global on
    expect(
      mergeDisplayPrefs({ ...global, reserveProcessLineAtIdle: true }, { reserveProcessLineAtIdle: false })
        .reserveProcessLineAtIdle,
    ).toBe(false);
  });

  // opt-in-out-of-cwd-session-diffs (E8): default OFF in every preset.
  it("defaults showOutOfCwdSessionDiffs off in all presets", () => {
    expect(DISPLAY_PRESETS.simple.showOutOfCwdSessionDiffs).toBe(false);
    expect(DISPLAY_PRESETS.standard.showOutOfCwdSessionDiffs).toBe(false);
    expect(DISPLAY_PRESETS.everything.showOutOfCwdSessionDiffs).toBe(false);
  });

  it("applies showOutOfCwdSessionDiffs override precedence (on beats global off)", () => {
    expect(mergeDisplayPrefs(global, { showOutOfCwdSessionDiffs: true }).showOutOfCwdSessionDiffs).toBe(true);
    expect(mergeDisplayPrefs(global, {}).showOutOfCwdSessionDiffs).toBe(false);
  });
});

describe("toolCallPrefKey", () => {
  it.each([
    ["read", "read"],
    ["bash", "bash"],
    ["edit", "edit"],
    ["write", "edit"],
    ["Agent", "agent"],
    ["foo_tool", "generic"],
  ])("maps %s → %s", (input, expected) => {
    expect(toolCallPrefKey(input)).toBe(expected);
  });

  it("returns null for ask_user (non-hidable)", () => {
    expect(toolCallPrefKey("ask_user")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// notifyMinLevel — the notify visibility gate.
// See change: gate-notify-rows-by-level.
// ---------------------------------------------------------------------------

/** Build the structural descriptor both ChatView gate sites pass. */
function notifyRow(level?: unknown) {
  return { content: "notify", method: "notify", level };
}

const LEVELS = ["info", "success", "warning", "error"] as const;
const FLOORS = ["all", "success", "warnings", "errors"] as const;

/** Ladder truth: which levels are visible at each floor. */
const EXPECTED_VISIBLE: Record<(typeof FLOORS)[number], readonly string[]> = {
  all: ["info", "success", "warning", "error"],
  success: ["success", "warning", "error"],
  warnings: ["warning", "error"],
  errors: ["error"],
};

describe("isNotifyRowVisible — ladder", () => {
  // 2.1 / test-plan #E1
  it("matches the 4x4 ladder truth table exactly", () => {
    for (const floor of FLOORS) {
      for (const level of LEVELS) {
        expect(
          isNotifyRowVisible(notifyRow(level), floor),
          `level=${level} floor=${floor}`,
        ).toBe(EXPECTED_VISIBLE[floor].includes(level));
      }
    }
  });

  // 2.1 / test-plan #E1 — the D1 ordering decision, pinned explicitly.
  it("ranks success ABOVE info: at 'success' only info hides", () => {
    expect(isNotifyRowVisible(notifyRow("info"), "success")).toBe(false);
    expect(isNotifyRowVisible(notifyRow("success"), "success")).toBe(true);
    expect(isNotifyRowVisible(notifyRow("warning"), "success")).toBe(true);
    expect(isNotifyRowVisible(notifyRow("error"), "success")).toBe(true);
  });

  // 2.2 / test-plan #E2
  it("never hides an error notify at any legal floor", () => {
    for (const floor of FLOORS) {
      expect(isNotifyRowVisible(notifyRow("error"), floor), `floor=${floor}`).toBe(true);
    }
  });
});

describe("isNotifyRowVisible — fail-open", () => {
  // 2.3 / test-plan #E3
  it.each([
    [undefined],
    [null],
    [42],
    ["critical"],
    [""],
    ["toString"],
    ["constructor"],
    ["__proto__"],
  ])(
    "ranks an unrecognized level (%p) as info",
    (level) => {
      expect(isNotifyRowVisible(notifyRow(level), "success")).toBe(false);
      expect(isNotifyRowVisible(notifyRow(level), "all")).toBe(true);
    },
  );

  // 2.4 / test-plan #E4 — the floor itself fails open.
  it.each([
    ["oops"],
    [""],
    [undefined],
    [null],
    [42],
    ["warning"],
    ["error"],
    ["ALL"],
    // Inherited Object.prototype names: a bare `in` check passes for these, so
    // the floor would resolve to a FUNCTION and every comparison would go
    // false — silently hiding even `error`. See CodeRabbit review, PR #453.
    ["toString"],
    ["constructor"],
    ["valueOf"],
    ["hasOwnProperty"],
    ["__proto__"],
  ])(
    "treats an unrecognized floor (%p) as 'all' so nothing is suppressed",
    (floor) => {
      for (const level of LEVELS) {
        expect(isNotifyRowVisible(notifyRow(level), floor), `level=${level}`).toBe(true);
      }
    },
  );

  // 2.4 / test-plan #E4 — the singular/plural hazard, called out in design D2.
  it("does NOT treat singular 'warning'/'error' as their plural floors", () => {
    // If the singular typo were aliased to its plural stop, info would hide.
    expect(isNotifyRowVisible(notifyRow("info"), "warning")).toBe(true);
    expect(isNotifyRowVisible(notifyRow("info"), "error")).toBe(true);
  });

  // 2.7 / test-plan #E9
  it.each([["select"], ["confirm"], ["input"], ["ask_user"]])(
    "renders a blocking %s row at the strictest floor",
    (method) => {
      expect(isNotifyRowVisible({ content: method, method, level: undefined }, "errors")).toBe(
        true,
      );
    },
  );

  // 2.8 / test-plan #E10 — the discriminator is an AND, not an OR.
  it("only classifies a row carrying BOTH markers as a notify", () => {
    const bothMatch = { content: "notify", method: "notify", level: "info" };
    const contentOnly = { content: "notify", method: "select", level: "info" };
    const methodOnly = { content: "select", method: "notify", level: "info" };
    const neither = { content: "select", method: "select", level: "info" };

    expect(isNotifyRowVisible(bothMatch, "errors")).toBe(false);
    // Half-matches are NOT notifies — a blocking row must never be hidden.
    expect(isNotifyRowVisible(contentOnly, "errors")).toBe(true);
    expect(isNotifyRowVisible(methodOnly, "errors")).toBe(true);
    expect(isNotifyRowVisible(neither, "errors")).toBe(true);
  });
});

describe("isNotifyRowVisible — payload and call-shape invariance", () => {
  // 2.9 / test-plan #E11 — legacy title-only rows gate identically.
  it("gates a legacy title-only notify by the same rule", () => {
    const legacy = { content: "notify", method: "notify", level: "info" };
    expect(isNotifyRowVisible(legacy, "warnings")).toBe(false);
    expect(isNotifyRowVisible(legacy, "all")).toBe(true);
  });

  // 2.10 / test-plan #E12 — both gate sites must agree.
  it("returns the same verdict for the isRowVisible and render-branch shapes", () => {
    // isRowVisible site reads msg.args.method; the render branch reads the
    // built request.method. Both adapt to the same descriptor.
    const msg = { content: "notify", args: { method: "notify", params: { level: "info" } } };
    const request = { method: "notify", params: { level: "info" } };

    const fromIsRowVisible = {
      content: msg.content,
      method: msg.args.method,
      level: (msg.args.params as { level?: unknown }).level,
    };
    const fromRenderBranch = {
      content: msg.content,
      method: request.method,
      level: (request.params as { level?: unknown }).level,
    };

    for (const floor of FLOORS) {
      expect(isNotifyRowVisible(fromIsRowVisible, floor)).toBe(
        isNotifyRowVisible(fromRenderBranch, floor),
      );
    }
  });
});

describe("notifyMinLevel — presets and merge", () => {
  // 2.5 / test-plan #E5
  it("is defined as 'all' in all three presets", () => {
    expect(DISPLAY_PRESETS.simple.notifyMinLevel).toBe("all");
    expect(DISPLAY_PRESETS.standard.notifyMinLevel).toBe("all");
    expect(DISPLAY_PRESETS.everything.notifyMinLevel).toBe("all");
  });

  // 2.6 / test-plan #E6
  it("lets an override win over global", () => {
    const base: DisplayPrefs = { ...DISPLAY_PRESETS.standard, notifyMinLevel: "all" };
    expect(mergeDisplayPrefs(base, { notifyMinLevel: "errors" }).notifyMinLevel).toBe("errors");
  });

  // 2.6 / test-plan #E6
  it("falls back to global when the override omits the field", () => {
    const base: DisplayPrefs = { ...DISPLAY_PRESETS.standard, notifyMinLevel: "warnings" };
    expect(mergeDisplayPrefs(base, { reasoning: true }).notifyMinLevel).toBe("warnings");
    expect(mergeDisplayPrefs(base, {}).notifyMinLevel).toBe("warnings");
    expect(mergeDisplayPrefs(base, undefined).notifyMinLevel).toBe("warnings");
  });
});

describe("notifyMinLevel — unvalidated override (test-plan #X2)", () => {
  // 2.14: a stale/buggy client can persist a garbage override verbatim; the
  // merged floor must still fail open rather than suppress an error notify.
  it("fails open on a garbage session override without corrupting global", () => {
    const globalPrefs: DisplayPrefs = { ...DISPLAY_PRESETS.standard, notifyMinLevel: "all" };
    const merged = mergeDisplayPrefs(globalPrefs, {
      notifyMinLevel: "critical" as unknown as DisplayPrefs["notifyMinLevel"],
    });

    // The override wins verbatim (merge does not validate)…
    expect(merged.notifyMinLevel).toBe("critical");
    // …but the predicate refuses to suppress anything on an unknown floor.
    for (const level of LEVELS) {
      expect(isNotifyRowVisible(notifyRow(level), merged.notifyMinLevel), `level=${level}`).toBe(
        true,
      );
    }
    // Global is untouched.
    expect(globalPrefs.notifyMinLevel).toBe("all");
  });
});

describe("isNotifyRowVisible — prototype-chain floors never hide an error", () => {
  // The axis makes exactly one hard promise: `error` always renders. A floor
  // resolved through Object.prototype broke it (rank became a function, so
  // every `>=` went false). See CodeRabbit review, PR #453.
  it.each([["toString"], ["constructor"], ["valueOf"], ["hasOwnProperty"], ["__proto__"]])(
    "still renders an error notify at floor %p",
    (floor) => {
      expect(isNotifyRowVisible(notifyRow("error"), floor)).toBe(true);
    },
  );
});

describe("normalizeNotifyMinLevel — what the SELECT controls render", () => {
  // Fails closed: unlike the jsdom select assertion (which cannot fail while
  // "all" is the first option), these compare against every stop directly.
  it.each([["all"], ["success"], ["warnings"], ["errors"]])(
    "passes the real stop %p through untouched",
    (stop) => {
      expect(normalizeNotifyMinLevel(stop)).toBe(stop);
    },
  );

  it.each([
    ["critical"],
    ["oops"],
    [""],
    ["warning"],
    ["error"],
    ["ALL"],
    [undefined],
    [null],
    [42],
    [{}],
    ["toString"],
    ["constructor"],
    ["__proto__"],
  ])("maps the unusable floor %p to 'all'", (bad) => {
    expect(normalizeNotifyMinLevel(bad)).toBe("all");
  });

  it("only ever returns a value the controls actually offer", () => {
    for (const v of ["critical", "toString", "", "errors", null, 7]) {
      expect(NOTIFY_MIN_LEVELS).toContain(normalizeNotifyMinLevel(v));
    }
  });
});
