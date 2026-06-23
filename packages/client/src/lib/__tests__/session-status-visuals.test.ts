import { describe, it, expect } from "vitest";
import {
  statusColors,
  sourceIcons,
  sourceLabels,
  deriveDotColor,
  deriveDotColorWithFlags,
  deriveIconStatusColor,
  pulseClassForStatus,
  deriveRailBgColor,
  getCardPulseClass,
  getCardStripeFxClass,
  deriveProposalCardState,
} from "../session-status-visuals.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

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

describe("session-status-visuals constants", () => {
  it("statusColors has the four expected keys", () => {
    expect(statusColors.active).toBe("bg-green-500");
    expect(statusColors.streaming).toBe("bg-yellow-500 animate-pulse");
    expect(statusColors.idle).toBe("bg-green-500");
    expect(statusColors.ended).toBe("bg-[var(--bg-surface)]");
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

describe("deriveDotColor (status-only)", () => {
  it("idle → bg-green-500", () => {
    expect(deriveDotColor(makeSession({ status: "idle" }))).toBe("bg-green-500");
  });

  it("active → bg-green-500", () => {
    expect(deriveDotColor(makeSession({ status: "active" }))).toBe("bg-green-500");
  });

  it("streaming → bg-yellow-500 animate-pulse", () => {
    expect(deriveDotColor(makeSession({ status: "streaming" }))).toBe("bg-yellow-500 animate-pulse");
  });

  it("ended → bg-[var(--bg-surface)]", () => {
    expect(deriveDotColor(makeSession({ status: "ended" }))).toBe("bg-[var(--bg-surface)]");
  });

  it("resuming wins over status (e.g. ended+resuming → yellow+pulse)", () => {
    expect(deriveDotColor(makeSession({ status: "ended", resuming: true }))).toBe("bg-yellow-500 animate-pulse");
  });

  it("ended + ask_user currentTool → still ended (status wins; chat-panel signal ignored)", () => {
    expect(deriveDotColor(makeSession({ status: "ended", currentTool: "ask_user" }))).toBe("bg-[var(--bg-surface)]");
  });
});

describe("deriveDotColorWithFlags (SessionCard variant)", () => {
  it("hasError flag → red", () => {
    expect(deriveDotColorWithFlags(makeSession({ status: "idle" }), { hasError: true })).toBe("bg-red-500");
  });

  it("isRetrying flag → amber+pulse", () => {
    expect(deriveDotColorWithFlags(makeSession({ status: "idle" }), { isRetrying: true })).toBe("bg-amber-500 animate-pulse");
  });

  it("resuming wins over hasError", () => {
    expect(deriveDotColorWithFlags(makeSession({ status: "idle", resuming: true }), { hasError: true })).toBe("bg-yellow-500 animate-pulse");
  });

  it("hasError wins over isRetrying", () => {
    expect(deriveDotColorWithFlags(makeSession({ status: "idle" }), { hasError: true, isRetrying: true })).toBe("bg-red-500");
  });

  it("no flags → falls back to deriveDotColor", () => {
    expect(deriveDotColorWithFlags(makeSession({ status: "streaming" }), {})).toBe("bg-yellow-500 animate-pulse");
  });
});

describe("deriveIconStatusColor", () => {
  it("ended status → muted text token (regardless of dotColor)", () => {
    expect(deriveIconStatusColor("bg-[var(--bg-surface)]", "ended")).toBe("text-[var(--text-muted)]");
  });

  it("idle + green dot → text-green-500", () => {
    expect(deriveIconStatusColor("bg-green-500", "idle")).toBe("text-green-500");
  });

  it("streaming + yellow+pulse dot → text-yellow-500 animate-pulse", () => {
    expect(deriveIconStatusColor("bg-yellow-500 animate-pulse", "streaming")).toBe("text-yellow-500 animate-pulse");
  });

  it("red dot → text-red-500", () => {
    expect(deriveIconStatusColor("bg-red-500", "idle")).toBe("text-red-500");
  });

  it("ended status BUT resuming-overridden dotColor (yellow+pulse) → text-yellow-500 animate-pulse (icon honors override, not muted)", () => {
    expect(deriveIconStatusColor("bg-yellow-500 animate-pulse", "ended")).toBe("text-yellow-500 animate-pulse");
  });

  it("amber+pulse dot → text-amber-500 animate-pulse", () => {
    expect(deriveIconStatusColor("bg-amber-500 animate-pulse", "idle")).toBe("text-amber-500 animate-pulse");
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

  it("active → empty string", () => {
    expect(pulseClassForStatus(makeSession({ status: "active" }))).toBe("");
  });

  it("ended → empty string", () => {
    expect(pulseClassForStatus(makeSession({ status: "ended" }))).toBe("");
  });

  it("ended + ask_user currentTool → empty string (icon-only pulse, status wins)", () => {
    expect(pulseClassForStatus(makeSession({ status: "ended", currentTool: "ask_user" }))).toBe("");
  });
});

describe("deriveRailBgColor", () => {
  // Unselected: /25 alpha
  it("idle → bg-green-500/40", () => {
    expect(deriveRailBgColor(makeSession({ status: "idle" }), {}, false)).toBe("bg-green-500/40");
  });
  it("active → bg-green-500/40", () => {
    expect(deriveRailBgColor(makeSession({ status: "active" }), {}, false)).toBe("bg-green-500/40");
  });
  it("streaming → bg-amber-500/40", () => {
    expect(deriveRailBgColor(makeSession({ status: "streaming" }), {}, false)).toBe("bg-amber-500/40");
  });
  it("ended → muted surface token", () => {
    expect(deriveRailBgColor(makeSession({ status: "ended" }), {}, false)).toBe("bg-[var(--bg-surface)]");
  });
  it("resuming overrides status → bg-amber-500/40", () => {
    expect(deriveRailBgColor(makeSession({ status: "idle", resuming: true }), {}, false)).toBe("bg-amber-500/40");
  });
  it("hasError → bg-red-500/40", () => {
    expect(deriveRailBgColor(makeSession({ status: "idle" }), { hasError: true }, false)).toBe("bg-red-500/40");
  });
  it("isRetrying → bg-amber-500/40", () => {
    expect(deriveRailBgColor(makeSession({ status: "idle" }), { isRetrying: true }, false)).toBe("bg-amber-500/40");
  });

  // Selected: brighter -400 shade with /50 alpha
  it("selected idle → bg-green-400/65", () => {
    expect(deriveRailBgColor(makeSession({ status: "idle" }), {}, true)).toBe("bg-green-400/65");
  });
  it("selected streaming → bg-amber-400/65", () => {
    expect(deriveRailBgColor(makeSession({ status: "streaming" }), {}, true)).toBe("bg-amber-400/65");
  });
  it("selected hasError → bg-red-400/65", () => {
    expect(deriveRailBgColor(makeSession({ status: "idle" }), { hasError: true }, true)).toBe("bg-red-400/65");
  });
  it("selected ended → still muted (no shade swap)", () => {
    expect(deriveRailBgColor(makeSession({ status: "ended" }), {}, true)).toBe("bg-[var(--bg-surface)]");
  });

  // Precedence: resuming > hasError > isRetrying > status (mirrors deriveDotColorWithFlags)
  it("resuming + hasError + isRetrying → resuming wins (amber)", () => {
    expect(
      deriveRailBgColor(
        makeSession({ status: "idle", resuming: true }),
        { hasError: true, isRetrying: true },
        false,
      ),
    ).toBe("bg-amber-500/40");
  });
  it("hasError + isRetrying → hasError wins (red)", () => {
    expect(
      deriveRailBgColor(
        makeSession({ status: "idle" }),
        { hasError: true, isRetrying: true },
        false,
      ),
    ).toBe("bg-red-500/40");
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
    expect(getCardStripeFxClass(getCardPulseClass(s))).toBe("card-stripes-running");
  });
  it("resuming → working/running stripes", () => {
    const s = makeSession({ status: "idle", resuming: true });
    expect(getCardStripeFxClass(getCardPulseClass(s))).toBe("card-stripes-running");
  });
  it("unread → unread stripes", () => {
    const s = makeSession({ status: "idle", unread: true });
    expect(getCardPulseClass(s)).toBe("card-unread-pulse");
    expect(getCardStripeFxClass(getCardPulseClass(s))).toBe("card-stripes-unread");
  });
  it("idle → no stripes", () => {
    const s = makeSession({ status: "idle" });
    expect(getCardPulseClass(s)).toBe("");
    expect(getCardStripeFxClass(getCardPulseClass(s))).toBe("");
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
  it("all-ended → no stripes", () => {
    expect(
      deriveProposalCardState([
        makeSession({ status: "ended" }),
        makeSession({ status: "ended" }),
      ]),
    ).toBe("");
  });
  it("resuming child counts as running", () => {
    expect(
      deriveProposalCardState([makeSession({ status: "idle", resuming: true })]),
    ).toBe("card-stripes-running");
  });
});
