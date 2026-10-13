/**
 * ACP sessions: driver chip shown, pi-only Resume/Fork hidden; pi sessions unchanged.
 * See change: add-acp-session-driver (test-plan #E46).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { _setAcpAgentsForTests } from "../../hooks/useAcpAgents.js";
import { AcpEndedCallout } from "../session/AcpEndedCallout.js";
import { DriverChip } from "../session/DriverChip.js";
import { SessionCard } from "../session/SessionCard.js";

vi.mock("../../hooks/useMobile.js", () => ({ useMobile: vi.fn(() => false) }));
afterEach(() => {
  cleanup();
  _setAcpAgentsForTests(null);
});

const base: DashboardSession = {
  id: "s1",
  cwd: "/w",
  source: "dashboard",
  status: "ended",
  startedAt: Date.now() - 60_000,
  tokensIn: 0,
  tokensOut: 0,
  cost: 0,
  sessionFile: "/x/s1.jsonl",
};

function card(session: DashboardSession) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return render(
    <Router hook={hook}>
      <SessionCard
        session={session}
        selectedId={undefined}
        onSelect={() => {}}
        now={Date.now()}
        showGitInfo={false}
        isHidden={false}
        onArchive={() => {}}
        onResume={() => {}}
        onSpawnSibling={() => {}}
      />
    </Router>,
  );
}

describe("ACP driver UI (E46)", () => {
  it("an ended ACP card shows the driver chip and NO Resume/Fork; a pi card keeps Resume + Fork and has no chip", () => {
    _setAcpAgentsForTests([{ id: "qmt", name: "querymt" }]);
    const acp = card({ ...base, driver: "acp", acpAgentId: "qmt" });
    expect(screen.getByTestId("session-driver-chip").textContent).toContain("querymt");
    expect(screen.queryByText("Resume")).toBeNull();
    expect(screen.queryByText("Fork")).toBeNull();
    acp.unmount();
    card(base);
    expect(screen.queryByTestId("session-driver-chip")).toBeNull();
    expect(screen.getByText("Resume")).toBeTruthy();
    expect(screen.getByText("Fork")).toBeTruthy();
  });

  it("DriverChip renders nothing for pi; falls back to the agent id when the agent is no longer configured", () => {
    const { container, unmount } = render(<DriverChip session={{}} />);
    expect(container.innerHTML).toBe("");
    unmount();
    render(<DriverChip session={{ driver: "acp", acpAgentId: "gone" }} />);
    expect(screen.getByTestId("session-driver-chip").textContent).toContain("gone");
  });

  it("AcpEndedCallout: only for an ended ACP session; the action starts a new session", () => {
    _setAcpAgentsForTests([{ id: "qmt", name: "querymt" }]);
    const onNew = vi.fn();
    const { container, rerender } = render(<AcpEndedCallout session={{ ...base, status: "active", driver: "acp", acpAgentId: "qmt" }} onNewSession={onNew} />);
    expect(container.innerHTML).toBe("");
    rerender(<AcpEndedCallout session={base} onNewSession={onNew} />);
    expect(container.innerHTML).toBe("");
    rerender(<AcpEndedCallout session={{ ...base, driver: "acp", acpAgentId: "qmt" }} onNewSession={onNew} />);
    expect(screen.getByTestId("acp-ended-callout").textContent).toContain("querymt");
    screen.getByTestId("acp-ended-new-session").click();
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
