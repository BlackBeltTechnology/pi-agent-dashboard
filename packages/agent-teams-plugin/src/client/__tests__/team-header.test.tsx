// @vitest-environment jsdom
/**
 * TeamHeader (test-plan S37 control matrix, S118 persist_degraded, S121 test ids):
 * Shut down only for control ∧ live status, closing indicator, closed read-only.
 * See change: add-agent-teams-ui.
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamHeader, type TeamHeaderProps } from "../TeamHeader.js";
import { member, renderHost, snap } from "./view-fixtures.js";

afterEach(cleanup);
const header = (over: Partial<TeamHeaderProps> = {}) => {
  const props: TeamHeaderProps = { snap: snap(), shutdownPending: false, shutdownNote: undefined, onShutdown: vi.fn(), onBack: vi.fn(), ...over };
  return { ...renderHost(<TeamHeader {...props} />), props };
};

describe("control matrix (S37)", () => {
  const STATUSES = ["starting", "active", "orphaned", "closing", "closed"] as const;
  const LIVE = new Set(["starting", "active", "orphaned"]);
  const matrix = STATUSES.flatMap((status) => [true, false].flatMap((control) => [true, false].map((degraded) => ({ status, control, degraded, name: `${status} × control=${control} × persist_degraded=${degraded}` }))));

  it.each(matrix)("$name", ({ status, control, degraded }) => {
    header({ snap: snap({ status, viewerCanControl: control, persist_degraded: degraded }) });
    expect(screen.queryByTestId("team-shutdown") !== null).toBe(control && LIVE.has(status));
    expect(screen.queryByTestId("team-shutdown-closing") !== null).toBe(status === "closing");
    expect((screen.queryByTestId("team-shutdown-closing") as HTMLButtonElement | null)?.disabled ?? true).toBe(true);
    expect(screen.queryByRole("button", { name: /shut down/i }) !== null).toBe(control && LIVE.has(status));
    expect(screen.queryByTestId("team-persist-degraded") !== null).toBe(degraded);
    expect(screen.queryByTestId("team-persist-degraded")?.textContent ?? "may not survive a restart").toContain("may not survive a restart");
  });

  it("orphaned states that the lead ended; closed states read-only", () => {
    header({ snap: snap({ status: "orphaned" }) });
    expect(screen.getByTestId("team-orphaned").textContent).toContain("lead session ended");
    expect(screen.getByTestId("team-status").textContent).toContain("Lead ended");
    cleanup();
    header({ snap: snap({ status: "closed" }) });
    expect(screen.getByTestId("team-closed").textContent).toContain("read-only");
  });

  it("starting and closing show their notices", () => {
    header({ snap: snap({ status: "starting" }) });
    expect(screen.getByTestId("team-starting")).toBeTruthy();
    cleanup();
    header({ snap: snap({ status: "closing" }) });
    expect(screen.getByTestId("team-closing")).toBeTruthy();
  });
});

describe("content", () => {
  it("mode / parallel test ids, counts and the viewed-from line (teammate route only)", () => {
    const s = snap({ mode: "worktree", members: [member("a", "busy"), member("b", "busy"), member("c", "idle")] });
    const { rerender, props } = header({ snap: s });
    expect(screen.getByTestId("team-header-mode").textContent).toBe("Mode: worktree");
    expect(screen.getByTestId("team-header-parallel").textContent).toBe("2 working in parallel");
    expect(screen.getByTestId("team-header").textContent).toContain("3 members");
    expect(screen.queryByTestId("team-viewed-from")).toBeNull();
    rerender(<TeamHeader {...props} viewedFrom="bob" />);
    expect(screen.getByTestId("team-viewed-from").textContent).toBe("Viewing from bob’s session.");
  });

  it("Back calls onBack; the team name is literal text", () => {
    const { props } = header({ snap: snap({ name: "<b>x</b> **y**" }) });
    expect(screen.getByTestId("team-name").textContent).toBe("<b>x</b> **y**");
    expect(screen.getByTestId("team-name").querySelector("b")).toBeNull();
    fireEvent.click(screen.getByTestId("team-back"));
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it("an unknown team status renders as text, not a crash", () => {
    header({ snap: snap({ status: "weird" as never }) });
    expect(screen.getByTestId("team-status").textContent).toContain("Unknown");
  });
});
