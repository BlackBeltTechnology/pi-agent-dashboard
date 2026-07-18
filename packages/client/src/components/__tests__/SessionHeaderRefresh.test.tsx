import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { SessionHeader } from "../session/SessionHeader.js";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// Stub useMobile to return false (desktop)
vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => false }));

function makeSession(overrides?: Partial<DashboardSession>): DashboardSession {
  return {
    id: "s1",
    status: "idle",
    cwd: "/tmp",
    startedAt: Date.now() - 60_000,
    ...overrides,
  } as DashboardSession;
}

describe("SessionHeader refresh button", () => {
  afterEach(cleanup);

  it("renders refresh button on desktop", () => {
    render(
      <SessionHeader
        session={makeSession()}
        state={createInitialState()}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByTitle("Refresh chat")).toBeTruthy();
  });

  it("does not render refresh button when onRefresh is not provided", () => {
    render(
      <SessionHeader
        session={makeSession()}
        state={createInitialState()}
      />,
    );
    expect(screen.queryByTitle("Refresh chat")).toBeNull();
  });

  it("calls onRefresh when clicked", () => {
    const onRefresh = vi.fn();
    render(
      <SessionHeader
        session={makeSession()}
        state={createInitialState()}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByTitle("Refresh chat"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
