import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Control widget-bar placement per session id, mirroring
// `FolderNeedsYouPill.test.tsx`'s probe harness. `unclassifiedIds` simulates a
// probe that has not yet reported (hook returns undefined), which the capsule
// must treat as "excluded from every bucket".
const widgetBarIds = new Set<string>();
const unclassifiedIds = new Set<string>();
vi.mock("@blackbelt-technology/dashboard-plugin-runtime", () => ({
  useHasWidgetBarPrompt: (sessionId: string) =>
    unclassifiedIds.has(sessionId) ? undefined : widgetBarIds.has(sessionId),
}));

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { FolderStatusCapsule } from "../folder/FolderStatusCapsule.js";

const CWD = "/tmp/proj";

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: CWD,
    source: "dashboard",
    status: "idle",
    startedAt: 0,
    ...overrides,
  } as DashboardSession;
}

function renderCapsule(
  sessions: DashboardSession[],
  props: Partial<React.ComponentProps<typeof FolderStatusCapsule>> = {},
) {
  return render(
    <FolderStatusCapsule cwd={CWD} sessions={sessions} onActivate={() => {}} {...props} />,
  );
}

beforeEach(() => {
  widgetBarIds.clear();
  unclassifiedIds.clear();
});

afterEach(() => {
  cleanup();
});

describe("FolderStatusCapsule", () => {
  it("renders segments in fixed severity order regardless of magnitude (test-plan #E1)", () => {
    const sessions = [
      makeSession({ id: "i1", status: "idle" }),
      makeSession({ id: "w1", status: "streaming" }),
      ...Array.from({ length: 9 }, (_, i) => makeSession({ id: `e${i}` })),
      makeSession({ id: "n1", currentTool: "ask_user" }),
    ];
    renderCapsule(sessions, {
      errorSessionIds: new Set(Array.from({ length: 9 }, (_, i) => `e${i}`)),
    });

    const capsule = screen.getByTestId(`folder-status-capsule-${CWD}`);
    const rendered = Array.from(capsule.querySelectorAll("[data-capsule-segment]")).map((el) =>
      el.getAttribute("data-capsule-segment"),
    );
    // Error count (9) dwarfs needs-you (1); order must still be severity-fixed.
    expect(rendered).toEqual(["needs-you", "error", "working", "idle"]);
  });

  it("keeps order with gaps — error precedes idle, no empty slots (test-plan #E2)", () => {
    renderCapsule([makeSession({ id: "e" }), makeSession({ id: "i", status: "idle" })], {
      errorSessionIds: new Set(["e"]),
    });
    const capsule = screen.getByTestId(`folder-status-capsule-${CWD}`);
    const rendered = Array.from(capsule.querySelectorAll("[data-capsule-segment]")).map((el) =>
      el.getAttribute("data-capsule-segment"),
    );
    expect(rendered).toEqual(["error", "idle"]);
  });

  it("renders only the idle segment for an only-idle folder (test-plan #E3)", () => {
    renderCapsule(Array.from({ length: 12 }, (_, i) => makeSession({ id: `i${i}`, status: "idle" })));
    const capsule = screen.getByTestId(`folder-status-capsule-${CWD}`);
    expect(capsule.querySelectorAll("[data-capsule-segment]")).toHaveLength(1);
    expect(screen.getByTestId(`folder-capsule-seg-idle-${CWD}`).textContent).toContain("12");
  });

  it("renders no capsule for a zero-session folder (test-plan #E4)", () => {
    renderCapsule([]);
    expect(screen.queryByTestId(`folder-status-capsule-${CWD}`)).toBeNull();
  });

  it("renders no capsule when every session has ended (test-plan #E5)", () => {
    renderCapsule(Array.from({ length: 5 }, (_, i) => makeSession({ id: `x${i}`, status: "ended" })));
    expect(screen.queryByTestId(`folder-status-capsule-${CWD}`)).toBeNull();
  });

  it("renders a count of 999 exactly (test-plan #E13)", () => {
    renderCapsule(Array.from({ length: 999 }, (_, i) => makeSession({ id: `i${i}`, status: "idle" })));
    expect(screen.getByTestId(`folder-capsule-seg-idle-${CWD}`).textContent).toContain("999");
  });

  it("caps a count above 999 as `999+` (test-plan #E14)", () => {
    renderCapsule(Array.from({ length: 1000 }, (_, i) => makeSession({ id: `i${i}`, status: "idle" })));
    expect(screen.getByTestId(`folder-capsule-seg-idle-${CWD}`).textContent).toContain("999+");
  });

  it("renders the idle segment inert but accessibly named (test-plan #F5)", () => {
    renderCapsule([makeSession({ id: "i1", status: "idle" })]);
    const idle = screen.getByTestId(`folder-capsule-seg-idle-${CWD}`);
    // Not a button, not focusable — a disabled button would still be announced
    // as an unavailable control.
    expect(idle.tagName).not.toBe("BUTTON");
    expect(idle.hasAttribute("tabindex")).toBe(false);
    // Still names its state, so a screen reader does not announce a bare number.
    expect(idle.getAttribute("aria-label")).toMatch(/idle/i);
  });

  it("gives every non-idle segment a distinct label naming count and state (test-plan #F6)", () => {
    renderCapsule(
      [
        makeSession({ id: "n1", currentTool: "ask_user" }),
        makeSession({ id: "e1" }),
        makeSession({ id: "w1", status: "streaming" }),
        makeSession({ id: "i1", status: "idle" }),
      ],
      { errorSessionIds: new Set(["e1"]) },
    );

    const labels = (["needs-you", "error", "working", "idle"] as const).map((k) =>
      screen.getByTestId(`folder-capsule-seg-${k}-${CWD}`).getAttribute("aria-label"),
    );
    // Distinct.
    expect(new Set(labels).size).toBe(4);
    // Each names its count AND its state.
    for (const label of labels) expect(label).toMatch(/1/);
    expect(labels[0]).toMatch(/blocked on you|need/i);
    expect(labels[1]).toMatch(/error/i);
    expect(labels[2]).toMatch(/working|running/i);
    expect(labels[3]).toMatch(/idle/i);
  });

  it("draws segment colour from the --status-* token family (test-plan #F8)", () => {
    renderCapsule(
      [makeSession({ id: "w1", status: "streaming" }), makeSession({ id: "n1", currentTool: "ask_user" })],
      {},
    );
    // Token identity with the SessionCard dot, not pixel equality — the segment
    // may tint the token as the outgoing pill did.
    const working = screen.getByTestId(`folder-capsule-seg-working-${CWD}`);
    expect(working.className).toContain("--status-working");
    const needsYou = screen.getByTestId(`folder-capsule-seg-needs-you-${CWD}`);
    expect(needsYou.className).toContain("--status-needs-you");
    // No severity-family token leaks in.
    expect(working.className).not.toContain("--severity-");
  });

  it("excludes an unclassified ask_user candidate from every segment (test-plan #E8)", () => {
    unclassifiedIds.add("a");
    renderCapsule([makeSession({ id: "a", currentTool: "ask_user" })]);
    expect(screen.queryByTestId(`folder-status-capsule-${CWD}`)).toBeNull();
  });

  it("excludes a widget-bar-placed prompt from idle (test-plan #E9)", () => {
    widgetBarIds.add("a");
    renderCapsule([makeSession({ id: "a", currentTool: "ask_user" })]);
    expect(screen.queryByTestId(`folder-capsule-seg-idle-${CWD}`)).toBeNull();
  });

  it("activates a non-idle segment with the first session of that state", () => {
    const onActivate = vi.fn();
    renderCapsule(
      [makeSession({ id: "e1" }), makeSession({ id: "e2" }), makeSession({ id: "i1", status: "idle" })],
      { errorSessionIds: new Set(["e1", "e2"]), onActivate },
    );
    fireEvent.click(screen.getByTestId(`folder-capsule-seg-error-${CWD}`));
    expect(onActivate).toHaveBeenCalledWith("e1");
  });

  it("stops propagation so the header row handler does not fire (test-plan #F3)", () => {
    const onRowClick = vi.fn();
    const onActivate = vi.fn();
    render(
      // Test double for the folder header row, which carries its own onClick.
      <div onClick={onRowClick}>
        <FolderStatusCapsule
          cwd={CWD}
          sessions={[makeSession({ id: "e1" })]}
          errorSessionIds={new Set(["e1"])}
          onActivate={onActivate}
        />
      </div>,
    );
    fireEvent.click(screen.getByTestId(`folder-capsule-seg-error-${CWD}`));
    expect(onActivate).toHaveBeenCalledWith("e1");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("does not activate on the inert idle segment (test-plan #F5)", () => {
    const onActivate = vi.fn();
    renderCapsule([makeSession({ id: "i1", status: "idle" })], { onActivate });
    fireEvent.click(screen.getByTestId(`folder-capsule-seg-idle-${CWD}`));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("is non-shrinking and non-wrapping so the name absorbs the squeeze (test-plan #F7)", () => {
    renderCapsule([makeSession({ id: "i1", status: "idle" })]);
    const capsule = screen.getByTestId(`folder-status-capsule-${CWD}`);
    expect(capsule.className).toContain("flex-none");
    expect(capsule.className).toContain("whitespace-nowrap");
  });

  it("never reports a needs-you count above its settled value (test-plan #F9)", () => {
    // All three probes start unclassified; the capsule must show no needs-you
    // segment rather than flashing 3 before they resolve.
    for (const id of ["a", "b", "c"]) unclassifiedIds.add(id);
    const sessions = ["a", "b", "c"].map((id) => makeSession({ id, currentTool: "ask_user" }));
    const { rerender } = renderCapsule(sessions);
    expect(screen.queryByTestId(`folder-capsule-seg-needs-you-${CWD}`)).toBeNull();

    // Probes resolve on a later tick: two are chat-routed, one is widget-bar.
    unclassifiedIds.clear();
    widgetBarIds.add("c");
    rerender(<FolderStatusCapsule cwd={CWD} sessions={sessions} onActivate={() => {}} />);
    expect(screen.getByTestId(`folder-capsule-seg-needs-you-${CWD}`).textContent).toContain("2");
  });
});
