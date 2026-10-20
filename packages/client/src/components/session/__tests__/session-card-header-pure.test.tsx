/**
 * Pure helpers behind the desktop card header: `activityContent` (the single
 * branch list shared by the activity indicator and the status-row gate) and
 * `metaChipsVisible` (shared by the meta-row gate and the chips).
 * See change: compact-session-card-header (test-plan E11, E12, design D8).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { metaChipsVisible } from "../../../lib/session/session-origin-view.js";
import { activityContent } from "../SessionCard.js";

afterEach(() => cleanup());

function s(over: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/repo",
    source: "tui",
    status: "idle",
    startedAt: 0,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...over,
  };
}

/** Text the node renders, or `null` when it renders nothing. */
function text(node: ReturnType<typeof activityContent>): string | null {
  if (node == null) return null;
  const { container } = render(<>{node}</>);
  const out = container.textContent?.trim() ?? "";
  cleanup();
  return out === "" ? null : out;
}

describe("activityContent — same branch list the indicator rendered before", () => {
  const cases: Array<[string, DashboardSession, number | undefined, boolean, string | null]> = [
    ["resuming", s({ resuming: true, status: "streaming" }), undefined, false, "Resuming…"],
    ["ended process_gone", s({ status: "ended", closedReason: "process_gone" }), undefined, false, "✕process gone"],
    ["ended manual", s({ status: "ended", closedReason: "manual" }), undefined, false, "closed"],
    ["ended unknown", s({ status: "ended", closedReason: "unknown" }), undefined, false, "?ended — reason unknown"],
    ["ended no reason", s({ status: "ended", closedReason: undefined }), undefined, false, null],
    ["ended moved", s({ status: "ended", closedReason: "process_gone", movedTo: { instanceId: "i2" } as never }), undefined, false, null],
    ["awaitingFileAccess beats widget-bar suppression", s({ status: "streaming", awaitingFileAccess: true }), undefined, true, "Needs you"],
    ["awaitingToolApproval beats widget-bar suppression (E36)", s({ status: "streaming", awaitingToolApproval: true }), undefined, true, "Needs you"],
    ["ask_user, no widget-bar prompt", s({ status: "streaming", currentTool: "ask_user" }), undefined, false, "Needs you"],
    ["ask_user with widget-bar prompt → standard streaming tool", s({ status: "streaming", currentTool: "ask_user" }), undefined, true, "ask_user"],
    ["retry", s({ status: "streaming", currentTool: "bash" }), 2, false, "Retry 2"],
    ["tool", s({ status: "streaming", currentTool: "bash" }), undefined, false, "bash"],
    ["streaming", s({ status: "streaming" }), undefined, false, "Thinking…"],
    ["idle", s({ status: "idle" }), undefined, false, "Idle"],
  ];
  it.each(cases)("%s", (_label, session, retry, prompt, expected) => {
    expect(text(activityContent(session, retry, prompt))).toBe(expected);
  });
});

describe("metaChipsVisible", () => {
  it("is true for moved-away, remote-origin and ACP sessions, false for a plain one", () => {
    expect(metaChipsVisible(s({ status: "ended", movedTo: { instanceId: "i2" } as never }))).toBe(true);
    expect(metaChipsVisible(s({ originDeviceId: "laptop" }))).toBe(true);
    expect(metaChipsVisible(s({ driver: "acp", acpAgentId: "x" }))).toBe(true);
    expect(metaChipsVisible(s())).toBe(false);
  });
});
