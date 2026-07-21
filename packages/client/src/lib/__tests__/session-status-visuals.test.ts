import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  countNeedsYou,
  countStatusRollup,
  deriveDotColor,
  deriveDotColorWithFlags,
  deriveIconStatusColor,
  deriveProposalCardState,
  deriveRailBgColor,
  deriveStatusShape,
  floatAskUserFirst,
  getCardPulseClass,
  getCardStripeFxClass,
  isChatRoutedAskUser,
  needsYouSessionIds,
  pulseClassForStatus,
  sourceIcons,
  sourceLabels,
  statusColors,
  statusShapeIcon,
} from "../session/session-status-visuals.js";

// Tokenized status colors. See change: improve-dashboard-attention-routing.
const NEEDS_YOU = "bg-[var(--status-needs-you)]";
const WORKING = "bg-[var(--status-working)] animate-pulse";
const IDLE = "bg-[var(--status-idle)]";
const ERROR = "bg-[var(--status-error)]";
const NOTICE = "bg-[var(--status-notice)]";
const ENDED = "bg-[var(--bg-surface)]";

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/tmp",
    source: "dashboard",
    status: "idle",
    startedAt: 0,
    ...overrides,
  } as DashboardSession;
}

describe("countStatusRollup", () => {
  it("counts working (streaming/resuming) and idle (active/idle), excludes needs-you and ended", () => {
    const rollup = countStatusRollup([
      makeSession({ id: "a", status: "streaming" }),
      makeSession({ id: "b", status: "idle", resuming: true }),
      makeSession({ id: "c", status: "active" }),
      makeSession({ id: "d", status: "idle" }),
      makeSession({ id: "e", status: "idle", currentTool: "ask_user" }),
      makeSession({ id: "f", status: "ended" }),
    ]);
    expect(rollup).toEqual({ working: 2, idle: 2 });
  });

  it("returns zeros for an empty folder", () => {
    expect(countStatusRollup([])).toEqual({ working: 0, idle: 0 });
  });
});

describe("session-status-visuals constants", () => {
  it("statusColors uses semantic tokens", () => {
    expect(statusColors.active).toBe(IDLE);
    expect(statusColors.streaming).toBe(WORKING);
    expect(statusColors.idle).toBe(IDLE);
    expect(statusColors.ended).toBe(ENDED);
  });

  it("statusColors emits no raw palette literals", () => {
    for (const v of Object.values(statusColors)) {
      expect(v).not.toMatch(/green-500|yellow-500|amber-500|red-500|purple-400/);
    }
  });

  it("sourceIcons covers tui/dashboard/tmux/zed/terminal", () => {
    expect(sourceIcons.tui).toBeDefined();
    expect(sourceIcons.dashboard).toBeDefined();
    expect(sourceIcons.tmux).toBeDefined();
    expect(sourceIcons.zed).toBeDefined();
    expect(sourceIcons.terminal).toBeDefined();
  });

  it("sourceLabels matches the legacy SessionCard mapping", () => {
    expect(sourceLabels.tui).toBe("TUI");
    expect(sourceLabels.dashboard).toBe("Headless");
    expect(sourceLabels.tmux).toBe("tmux");
    expect(sourceLabels.zed).toBe("Zed");
    expect(sourceLabels.terminal).toBe("Terminal");
  });
});

describe("isChatRoutedAskUser", () => {
  it("ask_user + not widget-bar → true", () => {
    expect(isChatRoutedAskUser(makeSession({ currentTool: "ask_user" }), false)).toBe(true);
  });
  it("ask_user + widget-bar → false (suppressed)", () => {
    expect(isChatRoutedAskUser(makeSession({ currentTool: "ask_user" }), true)).toBe(false);
  });
  it("ended + ask_user → false (finished session never needs you)", () => {
    expect(isChatRoutedAskUser(makeSession({ status: "ended", currentTool: "ask_user" }), false)).toBe(false);
  });
  it("non-ask_user tool → false", () => {
    expect(isChatRoutedAskUser(makeSession({ currentTool: "Read" }), false)).toBe(false);
  });
});

describe("deriveDotColor (status-only)", () => {
  it("idle → idle token", () => {
    expect(deriveDotColor(makeSession({ status: "idle" }))).toBe(IDLE);
  });
  it("active → idle token", () => {
    expect(deriveDotColor(makeSession({ status: "active" }))).toBe(IDLE);
  });
  it("streaming → working token", () => {
    expect(deriveDotColor(makeSession({ status: "streaming" }))).toBe(WORKING);
  });
  it("ended → surface token", () => {
    expect(deriveDotColor(makeSession({ status: "ended" }))).toBe(ENDED);
  });
  it("resuming wins over status → working token", () => {
    expect(deriveDotColor(makeSession({ status: "ended", resuming: true }))).toBe(WORKING);
  });
  it("ended + ask_user currentTool → still ended (status-only ignores chat signal)", () => {
    expect(deriveDotColor(makeSession({ status: "ended", currentTool: "ask_user" }))).toBe(ENDED);
  });
});

describe("deriveDotColorWithFlags (SessionCard variant)", () => {
  it("hasError flag → error token", () => {
    expect(deriveDotColorWithFlags(makeSession({ status: "idle" }), { hasError: true })).toBe(ERROR);
  });
  it("chat-routed ask_user → needs-you token, not idle/green", () => {
    const c = deriveDotColorWithFlags(makeSession({ status: "idle", currentTool: "ask_user" }), {});
    expect(c).toBe(NEEDS_YOU);
    expect(c).not.toBe(IDLE);
  });
  it("widget-bar ask_user → falls through to status (idle), not needs-you", () => {
    const c = deriveDotColorWithFlags(
      makeSession({ status: "idle", currentTool: "ask_user" }),
      { hasWidgetBarPrompt: true },
    );
    expect(c).toBe(IDLE);
  });
  it("error outranks ask_user", () => {
    expect(
      deriveDotColorWithFlags(
        makeSession({ status: "idle", currentTool: "ask_user" }),
        { hasError: true },
      ),
    ).toBe(ERROR);
  });
  it("ask_user outranks resuming", () => {
    expect(
      deriveDotColorWithFlags(
        makeSession({ status: "idle", currentTool: "ask_user", resuming: true }),
        {},
      ),
    ).toBe(NEEDS_YOU);
  });
  it("error outranks resuming (precedence reordered: error highest)", () => {
    expect(
      deriveDotColorWithFlags(makeSession({ status: "idle", resuming: true }), { hasError: true }),
    ).toBe(ERROR);
  });
  it("isRetrying → working token", () => {
    expect(deriveDotColorWithFlags(makeSession({ status: "idle" }), { isRetrying: true })).toBe(WORKING);
  });
  it("hasNotice → notice token (non-error), distinct from error and idle", () => {
    const c = deriveDotColorWithFlags(makeSession({ status: "idle" }), { hasNotice: true });
    expect(c).toBe(NOTICE);
    expect(c).not.toBe(ERROR);
    expect(c).not.toBe(IDLE);
  });
  it("error outranks notice", () => {
    expect(
      deriveDotColorWithFlags(makeSession({ status: "idle" }), { hasError: true, hasNotice: true }),
    ).toBe(ERROR);
  });
  it("deriveStatusShape → notice shape with an info icon (not the error ✕)", () => {
    const shape = deriveStatusShape(makeSession({ status: "idle" }), { hasNotice: true });
    expect(shape).toBe("notice");
    expect(statusShapeIcon.notice).toBeTruthy();
    expect(statusShapeIcon.notice).not.toBe(statusShapeIcon.error);
  });
  it("no flags → falls back to status token", () => {
    expect(deriveDotColorWithFlags(makeSession({ status: "streaming" }), {})).toBe(WORKING);
  });
  it("ended + lingering ask_user → muted (not needs-you)", () => {
    expect(deriveDotColorWithFlags(makeSession({ status: "ended", currentTool: "ask_user" }), {})).toBe(ENDED);
  });
});

describe("deriveIconStatusColor", () => {
  it("ended status → muted text token", () => {
    expect(deriveIconStatusColor(ENDED, "ended")).toBe("text-[var(--text-muted)]");
  });
  it("idle token dot → text-[var(--status-idle)]", () => {
    expect(deriveIconStatusColor(IDLE, "idle")).toBe("text-[var(--status-idle)]");
  });
  it("working token dot → text token + animate-pulse", () => {
    expect(deriveIconStatusColor(WORKING, "streaming")).toBe("text-[var(--status-working)] animate-pulse");
  });
  it("needs-you token dot → text-[var(--status-needs-you)]", () => {
    expect(deriveIconStatusColor(NEEDS_YOU, "idle")).toBe("text-[var(--status-needs-you)]");
  });
  it("error token dot → text-[var(--status-error)]", () => {
    expect(deriveIconStatusColor(ERROR, "idle")).toBe("text-[var(--status-error)]");
  });
  it("ended status BUT working-overridden dot → honors override (not muted)", () => {
    expect(deriveIconStatusColor(WORKING, "ended")).toBe("text-[var(--status-working)] animate-pulse");
  });
  it("does not rewrite a `bg-` substring inside a token name (non-ended surface fallback)", () => {
    // Leading bg- → text-; the inner `--bg-surface` token name is untouched.
    expect(deriveIconStatusColor("bg-[var(--bg-surface)]", "idle")).toBe("text-[var(--bg-surface)]");
  });
});

describe("deriveStatusShape", () => {
  it("hasError → error", () => {
    expect(deriveStatusShape(makeSession({ status: "idle" }), { hasError: true })).toBe("error");
  });
  it("chat-routed ask_user → needs-you", () => {
    expect(deriveStatusShape(makeSession({ status: "idle", currentTool: "ask_user" }), {})).toBe("needs-you");
  });
  it("widget-bar ask_user → idle (suppressed)", () => {
    expect(
      deriveStatusShape(makeSession({ status: "idle", currentTool: "ask_user" }), { hasWidgetBarPrompt: true }),
    ).toBe("idle");
  });
  it("streaming → working", () => {
    expect(deriveStatusShape(makeSession({ status: "streaming" }), {})).toBe("working");
  });
  it("resuming → working", () => {
    expect(deriveStatusShape(makeSession({ status: "idle", resuming: true }), {})).toBe("working");
  });
  it("idle/active → idle", () => {
    expect(deriveStatusShape(makeSession({ status: "idle" }), {})).toBe("idle");
    expect(deriveStatusShape(makeSession({ status: "active" }), {})).toBe("idle");
  });
  it("ended → ended", () => {
    expect(deriveStatusShape(makeSession({ status: "ended" }), {})).toBe("ended");
  });
  it("ended + lingering ask_user → ended (no needs-you shape)", () => {
    expect(deriveStatusShape(makeSession({ status: "ended", currentTool: "ask_user" }), {})).toBe("ended");
  });
  it("error outranks ask_user (shape precedence mirrors color)", () => {
    expect(
      deriveStatusShape(makeSession({ status: "idle", currentTool: "ask_user" }), { hasError: true }),
    ).toBe("error");
  });

  it("statusShapeIcon: needs-you/working/idle/error have a path, ended is null", () => {
    expect(statusShapeIcon["needs-you"]).toBeTruthy();
    expect(statusShapeIcon.working).toBeTruthy();
    expect(statusShapeIcon.idle).toBeTruthy();
    expect(statusShapeIcon.error).toBeTruthy();
    expect(statusShapeIcon.ended).toBeNull();
  });
  it("statusShapeIcon: needs-you (filled) and idle (ring) are different glyphs", () => {
    expect(statusShapeIcon["needs-you"]).not.toBe(statusShapeIcon.idle);
  });
});

describe("countNeedsYou / needsYouSessionIds", () => {
  const folder = [
    makeSession({ id: "a", currentTool: "ask_user" }),
    makeSession({ id: "b", status: "streaming" }),
    makeSession({ id: "c", currentTool: "ask_user" }),
    makeSession({ id: "d", status: "idle" }),
  ];

  it("counts only chat-routed ask_user sessions", () => {
    expect(countNeedsYou(folder)).toBe(2);
    expect(needsYouSessionIds(folder)).toEqual(["a", "c"]);
  });

  it("excludes widget-bar-placed ask_user from the count", () => {
    const isWidgetBar = (id: string) => id === "c";
    expect(countNeedsYou(folder, isWidgetBar)).toBe(1);
    expect(needsYouSessionIds(folder, isWidgetBar)).toEqual(["a"]);
  });

  it("zero when no ask_user sessions", () => {
    expect(countNeedsYou([makeSession({ status: "idle" })])).toBe(0);
  });

  it("excludes ended sessions with lingering ask_user", () => {
    const list = [
      makeSession({ id: "a", currentTool: "ask_user" }),
      makeSession({ id: "e", status: "ended", currentTool: "ask_user" }),
    ];
    expect(countNeedsYou(list)).toBe(1);
    expect(needsYouSessionIds(list)).toEqual(["a"]);
  });
});

describe("floatAskUserFirst", () => {
  it("floats ask_user sessions to the top, stable within groups", () => {
    const list = [
      makeSession({ id: "x", status: "streaming" }),
      makeSession({ id: "a", currentTool: "ask_user" }),
      makeSession({ id: "y", status: "idle" }),
      makeSession({ id: "b", currentTool: "ask_user" }),
    ];
    expect(floatAskUserFirst(list).map((s) => s.id)).toEqual(["a", "b", "x", "y"]);
  });

  it("returns the same array reference when no ask_user present (no-op)", () => {
    const list = [makeSession({ id: "x", status: "idle" })];
    expect(floatAskUserFirst(list)).toBe(list);
  });

  it("excludes widget-bar ask_user from the float (same predicate as the rest)", () => {
    const list = [
      makeSession({ id: "x", status: "streaming" }),
      makeSession({ id: "a", currentTool: "ask_user" }),
      makeSession({ id: "w", currentTool: "ask_user" }),
    ];
    // `w` is widget-bar → not floated.
    expect(floatAskUserFirst(list, (id) => id === "w").map((s) => s.id)).toEqual(["a", "x", "w"]);
  });

  it("does not float ended sessions with lingering ask_user", () => {
    const list = [
      makeSession({ id: "x", status: "idle" }),
      makeSession({ id: "e", status: "ended", currentTool: "ask_user" }),
    ];
    expect(floatAskUserFirst(list)).toBe(list);
  });
});

describe("pulseClassForStatus", () => {
  it("streaming → animate-pulse", () => {
    expect(pulseClassForStatus(makeSession({ status: "streaming" }))).toBe("animate-pulse");
  });
  it("resuming → animate-pulse (regardless of status)", () => {
    expect(pulseClassForStatus(makeSession({ status: "ended", resuming: true }))).toBe("animate-pulse");
  });
  it("idle → empty string", () => {
    expect(pulseClassForStatus(makeSession({ status: "idle" }))).toBe("");
  });
});

describe("deriveRailBgColor", () => {
  const mix = (token: string, pct: number) => `bg-[color-mix(in_srgb,var(${token})_${pct}%,transparent)]`;

  it("idle → idle tint 40%", () => {
    expect(deriveRailBgColor(makeSession({ status: "idle" }), {}, false)).toBe(mix("--status-idle", 40));
  });
  it("streaming → working tint 40%", () => {
    expect(deriveRailBgColor(makeSession({ status: "streaming" }), {}, false)).toBe(mix("--status-working", 40));
  });
  it("ended → muted surface token", () => {
    expect(deriveRailBgColor(makeSession({ status: "ended" }), {}, false)).toBe(ENDED);
  });
  it("chat-routed ask_user → needs-you tint, not green/idle", () => {
    const c = deriveRailBgColor(makeSession({ status: "idle", currentTool: "ask_user" }), {}, false);
    expect(c).toBe(mix("--status-needs-you", 40));
    expect(c).not.toBe(mix("--status-idle", 40));
  });
  it("widget-bar ask_user → falls through to idle tint", () => {
    expect(
      deriveRailBgColor(makeSession({ status: "idle", currentTool: "ask_user" }), { hasWidgetBarPrompt: true }, false),
    ).toBe(mix("--status-idle", 40));
  });
  it("hasError → error tint 40%", () => {
    expect(deriveRailBgColor(makeSession({ status: "idle" }), { hasError: true }, false)).toBe(mix("--status-error", 40));
  });
  it("error outranks ask_user", () => {
    expect(
      deriveRailBgColor(makeSession({ status: "idle", currentTool: "ask_user" }), { hasError: true }, false),
    ).toBe(mix("--status-error", 40));
  });
  it("resuming → working tint", () => {
    expect(deriveRailBgColor(makeSession({ status: "idle", resuming: true }), {}, false)).toBe(mix("--status-working", 40));
  });
  it("hasNotice → notice tint 40% (non-error), selected 65%", () => {
    expect(deriveRailBgColor(makeSession({ status: "idle" }), { hasNotice: true }, false)).toBe(mix("--status-notice", 40));
    expect(deriveRailBgColor(makeSession({ status: "idle" }), { hasNotice: true }, true)).toBe(mix("--status-notice", 65));
  });
  it("error outranks notice on the rail", () => {
    expect(
      deriveRailBgColor(makeSession({ status: "idle" }), { hasError: true, hasNotice: true }, false),
    ).toBe(mix("--status-error", 40));
  });

  // Selected: 65% mix
  it("selected idle → idle tint 65%", () => {
    expect(deriveRailBgColor(makeSession({ status: "idle" }), {}, true)).toBe(mix("--status-idle", 65));
  });
  it("selected ask_user → needs-you tint 65%", () => {
    expect(
      deriveRailBgColor(makeSession({ status: "idle", currentTool: "ask_user" }), {}, true),
    ).toBe(mix("--status-needs-you", 65));
  });
  it("selected ended → still muted (no shade swap)", () => {
    expect(deriveRailBgColor(makeSession({ status: "ended" }), {}, true)).toBe(ENDED);
  });
  it("ended + lingering ask_user → muted rail (not needs-you)", () => {
    expect(deriveRailBgColor(makeSession({ status: "ended", currentTool: "ask_user" }), {}, false)).toBe(ENDED);
  });
});

describe("getCardPulseClass / getCardStripeFxClass", () => {
  it("ask_user → input stripes (highest precedence)", () => {
    const s = makeSession({ currentTool: "ask_user", status: "streaming", unread: true });
    expect(getCardPulseClass(s)).toBe("card-input-stripes");
    expect(getCardStripeFxClass(getCardPulseClass(s))).toBe("card-stripes-input");
  });
  it("streaming → working/running stripes", () => {
    const s = makeSession({ status: "streaming", unread: true });
    expect(getCardPulseClass(s)).toBe("card-working-pulse");
  });
  it("unread → unread stripes", () => {
    const s = makeSession({ status: "idle", unread: true });
    expect(getCardPulseClass(s)).toBe("card-unread-pulse");
  });
  it("idle → no stripes", () => {
    const s = makeSession({ status: "idle" });
    expect(getCardPulseClass(s)).toBe("");
  });
  it("hasWidgetBarPrompt suppresses ask_user input stripes", () => {
    const s = makeSession({ currentTool: "ask_user", status: "idle" });
    expect(getCardPulseClass(s, true)).toBe("");
  });
});

describe("deriveProposalCardState", () => {
  it("ask_user beats running beats unread beats none", () => {
    expect(
      deriveProposalCardState([
        makeSession({ status: "idle", unread: true }),
        makeSession({ status: "streaming" }),
        makeSession({ currentTool: "ask_user", status: "idle" }),
      ]),
    ).toBe("card-stripes-input");
    expect(
      deriveProposalCardState([
        makeSession({ status: "idle", unread: true }),
        makeSession({ status: "streaming" }),
      ]),
    ).toBe("card-stripes-running");
    expect(
      deriveProposalCardState([makeSession({ status: "idle", unread: true })]),
    ).toBe("card-stripes-unread");
    expect(deriveProposalCardState([makeSession({ status: "idle" })])).toBe("");
  });
  it("empty array → no stripes", () => {
    expect(deriveProposalCardState([])).toBe("");
  });
});
