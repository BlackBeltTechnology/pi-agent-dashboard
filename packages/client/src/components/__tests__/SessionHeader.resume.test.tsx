/**
 * Resume / Fork affordance in the desktop SessionHeader toolbar.
 * See change: resume-button-in-session-header.
 *
 * Render gate: session.status === "ended" AND session.sessionFile AND onResume.
 * When gated on, replaces the elapsed-duration span with a green Resume pill
 * and a blue Fork pill that mirror the sidebar SessionCard's visual language.
 * Disabled while session.resuming. Mobile path is unaffected.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { createInitialState } from "../../lib/event-reducer.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeSession(overrides?: Partial<DashboardSession>): DashboardSession {
  return {
    id: "s1",
    status: "idle",
    cwd: "/tmp",
    startedAt: Date.now() - 60_000,
    ...overrides,
  } as DashboardSession;
}

describe("SessionHeader Resume / Fork pills — desktop", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.doUnmock("../../hooks/useMobile.js");
  });

  async function loadDesktop() {
    vi.doMock("../../hooks/useMobile.js", () => ({ useMobile: () => false }));
    const mod = await import("../SessionHeader.js");
    return mod.SessionHeader;
  }

  it("renders Resume and Fork buttons when ended + sessionFile + onResume", async () => {
    const SessionHeader = await loadDesktop();
    const onResume = vi.fn();
    render(
      <SessionHeader
        session={makeSession({ status: "ended", sessionFile: "/path/to/session.jsonl" })}
        state={createInitialState()}
        onResume={onResume}
      />,
    );
    expect(screen.getByTestId("header-resume-button")).toBeTruthy();
    expect(screen.getByTestId("header-fork-button")).toBeTruthy();
  });

  it("does NOT render the duration span when buttons are shown", async () => {
    const SessionHeader = await loadDesktop();
    const startedAt = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    const onResume = vi.fn();
    const { container } = render(
      <SessionHeader
        session={makeSession({ status: "ended", sessionFile: "/p", startedAt })}
        state={createInitialState()}
        onResume={onResume}
      />,
    );
    // The duration span renders text matching /\d+m \d+s/. Confirm absent.
    expect(container.textContent).not.toMatch(/\d+m \d+s/);
  });

  it("hides Resume / Fork on active session and shows duration", async () => {
    const SessionHeader = await loadDesktop();
    const onResume = vi.fn();
    const { container } = render(
      <SessionHeader
        session={makeSession({ status: "active", sessionFile: "/p" })}
        state={createInitialState()}
        onResume={onResume}
      />,
    );
    expect(screen.queryByTestId("header-resume-button")).toBeNull();
    expect(screen.queryByTestId("header-fork-button")).toBeNull();
    // Duration span (formatDuration output) must still appear.
    expect(container.textContent).toMatch(/\d+s|\d+m/);
  });

  it("hides Resume / Fork when sessionFile is missing", async () => {
    const SessionHeader = await loadDesktop();
    const onResume = vi.fn();
    render(
      <SessionHeader
        session={makeSession({ status: "ended" /* no sessionFile */ })}
        state={createInitialState()}
        onResume={onResume}
      />,
    );
    expect(screen.queryByTestId("header-resume-button")).toBeNull();
    expect(screen.queryByTestId("header-fork-button")).toBeNull();
  });

  it("hides Resume / Fork when onResume callback is omitted (opt-in gate)", async () => {
    const SessionHeader = await loadDesktop();
    render(
      <SessionHeader
        session={makeSession({ status: "ended", sessionFile: "/p" })}
        state={createInitialState()}
        /* onResume omitted */
      />,
    );
    expect(screen.queryByTestId("header-resume-button")).toBeNull();
    expect(screen.queryByTestId("header-fork-button")).toBeNull();
  });

  it("invokes onResume('continue') exactly once on Resume click", async () => {
    const SessionHeader = await loadDesktop();
    const onResume = vi.fn();
    render(
      <SessionHeader
        session={makeSession({ status: "ended", sessionFile: "/p" })}
        state={createInitialState()}
        onResume={onResume}
      />,
    );
    fireEvent.click(screen.getByTestId("header-resume-button"));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledWith("continue");
  });

  it("invokes onResume('fork') exactly once on Fork click", async () => {
    const SessionHeader = await loadDesktop();
    const onResume = vi.fn();
    render(
      <SessionHeader
        session={makeSession({ status: "ended", sessionFile: "/p" })}
        state={createInitialState()}
        onResume={onResume}
      />,
    );
    fireEvent.click(screen.getByTestId("header-fork-button"));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledWith("fork");
  });

  it("disables both buttons while session.resuming and ignores clicks", async () => {
    const SessionHeader = await loadDesktop();
    const onResume = vi.fn();
    render(
      <SessionHeader
        session={makeSession({ status: "ended", sessionFile: "/p", resuming: true })}
        state={createInitialState()}
        onResume={onResume}
      />,
    );
    const resumeBtn = screen.getByTestId("header-resume-button") as HTMLButtonElement;
    const forkBtn = screen.getByTestId("header-fork-button") as HTMLButtonElement;
    expect(resumeBtn.disabled).toBe(true);
    expect(forkBtn.disabled).toBe(true);
    fireEvent.click(resumeBtn);
    fireEvent.click(forkBtn);
    expect(onResume).not.toHaveBeenCalled();
  });
});

describe("SessionHeader Resume / Fork pills — mobile path unaffected", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.doUnmock("../../hooks/useMobile.js");
  });

  async function loadMobile() {
    vi.doMock("../../hooks/useMobile.js", () => ({ useMobile: () => true }));
    const mod = await import("../SessionHeader.js");
    return mod.SessionHeader;
  }

  it("does not render the desktop Resume / Fork pills on mobile", async () => {
    const SessionHeader = await loadMobile();
    const onResume = vi.fn();
    render(
      <SessionHeader
        session={makeSession({ status: "ended", sessionFile: "/p" })}
        state={createInitialState()}
        onResume={onResume}
      />,
    );
    expect(screen.queryByTestId("header-resume-button")).toBeNull();
    expect(screen.queryByTestId("header-fork-button")).toBeNull();
  });
});
