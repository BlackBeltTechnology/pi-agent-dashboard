/**
 * `terminal_limit_reached` drives the terminal-limit notice store; `folder_refused`
 * toasts the refusal copy. See change: harden-server-capability-bounds (#F1-#F3, #F6).
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalLimitNotice } from "../../components/terminal/TerminalLimitNotice.js";
import { __resetTerminalLimitNoticeForTests } from "../../lib/state/terminal-limit-notice-store.js";
import { useMessageHandler } from "../useMessageHandler.js";

function setup(pendingCwd: string | null = null) {
  const showToast = vi.fn();
  const setters: any = {
    setSessions: vi.fn(), setSessionStates: vi.fn(), setSessionCommands: vi.fn(),
    setFileResults: vi.fn(), setOpenspecMap: vi.fn(), setModelsMap: vi.fn(),
    setRolesMap: vi.fn(), setSpawnResult: vi.fn(), setSessionOrderMap: vi.fn(),
    setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(), setTerminals: vi.fn(),
    setEditorStatuses: vi.fn(), setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(),
    setResumeErrors: vi.fn(), setLoadingHistory: vi.fn(),
  };
  const deps: any = {
    send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: pendingCwd }, lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map() }, selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map() }, loadingHistoryTimersRef: { current: new Map() },
    showToast,
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return { dispatch: (m: ServerToBrowserMessage) => act(() => result.current(m)), showToast, setters, deps };
}

const limit = (over: Partial<Extract<ServerToBrowserMessage, { type: "terminal_limit_reached" }>> = {}): ServerToBrowserMessage => ({
  type: "terminal_limit_reached", scope: "global", limit: 32, cwd: "/w", inline: false, ...over,
});

beforeEach(() => __resetTerminalLimitNoticeForTests());
afterEach(() => cleanup());

describe("terminal limit notice", () => {
  it("F1 one role=status notice; replaced by the next rejection; dismissed; cleared by terminal_added for that cwd", () => {
    const { dispatch } = setup();
    render(<TerminalLimitNotice cwd="/w" inline={false} />);
    expect(screen.queryByRole("status")).toBeNull();

    dispatch(limit());
    dispatch(limit());
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("32 terminals are open");

    dispatch(limit({ limit: 40 }));
    expect(screen.getByRole("status").textContent).toContain("40 terminals are open");

    act(() => screen.getByRole("button", { name: /dismiss/i }).click());
    expect(screen.queryByRole("status")).toBeNull();

    dispatch(limit());
    expect(screen.getByRole("status")).toBeTruthy();
    dispatch({ type: "terminal_added", terminal: { id: "t1", cwd: "/w", shell: "sh", status: "active", createdAt: 1 } } as ServerToBrowserMessage);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a notice for another cwd is not shown, and its terminal_added does not clear this one", () => {
    const { dispatch } = setup();
    render(<TerminalLimitNotice cwd="/w" inline={false} />);
    dispatch(limit({ cwd: "/other" }));
    expect(screen.queryByRole("status")).toBeNull();
    dispatch(limit());
    dispatch({ type: "terminal_added", terminal: { id: "t2", cwd: "/other", shell: "sh", status: "active", createdAt: 1 } } as ServerToBrowserMessage);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("F2 owner scope copy", () => {
    const { dispatch } = setup();
    render(<TerminalLimitNotice cwd="/w" inline={false} />);
    dispatch(limit({ scope: "owner", limit: 16 }));
    expect(screen.getByRole("status").textContent).toContain("You already have 16 terminals open");
  });

  it("F3 an inline refusal shows in the inline slot only, not the tab slot", () => {
    const { dispatch } = setup();
    render(
      <>
        <div data-testid="tab"><TerminalLimitNotice cwd="/w" inline={false} /></div>
        <div data-testid="chat"><TerminalLimitNotice cwd="/w" inline /></div>
      </>,
    );
    dispatch(limit({ inline: true }));
    expect(screen.getByTestId("chat").querySelector('[role="status"]')).toBeTruthy();
    expect(screen.getByTestId("tab").querySelector('[role="status"]')).toBeNull();
  });
});

const terr = (over: Partial<Extract<ServerToBrowserMessage, { type: "terminal_error" }>> = {}): ServerToBrowserMessage => ({
  type: "terminal_error", code: "cwd_not_admitted", cwd: "/w", inline: false, message: "Refused: not a known folder.", ...over,
});

describe("terminal_error notice (change: harden-git-terminal-plugin-boundaries, #SF1)", () => {
  it.each([
    ["cwd_not_admitted", false],
    ["cwd_admission_unavailable", false],
    ["session_not_found", true],
    ["cwd_not_admitted", true],
  ] as const)("SF1 %s inline=%s renders the server message, adds no terminal, clears the pending cwd", (code, inline) => {
    const { dispatch, setters, deps } = setup("/w");
    render(<><TerminalLimitNotice cwd="/w" inline={false} /><TerminalLimitNotice cwd="/w" inline /></>);
    dispatch(terr({ code, inline, message: `msg for ${code}` }));
    const status = screen.getAllByRole("status");
    expect(status).toHaveLength(1);
    expect(status[0].textContent).toContain(`msg for ${code}`);
    expect(setters.setTerminals).not.toHaveBeenCalled();
    expect(deps.pendingTerminalCwdRef.current).toBeNull();
    act(() => screen.getByRole("button", { name: /dismiss/i }).click());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("SF1 shows for a cwd with no pane of its own (an unknown folder has none)", () => {
    const { dispatch } = setup();
    render(<TerminalLimitNotice cwd="/pane/cwd" inline={false} />);
    dispatch(terr({ cwd: "/somewhere/else" }));
    expect(screen.getByRole("status").textContent).toContain("Refused");
  });

  it("SF1 a newer terminal notice replaces the older one, in both orders: exactly one at any time", () => {
    const { dispatch } = setup();
    render(<TerminalLimitNotice cwd="/w" inline={false} />);
    dispatch(terr());
    dispatch(limit());
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("32 terminals are open");
    dispatch(terr({ message: "second refusal" }));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("second refusal");
    expect(screen.getByRole("status").textContent).not.toContain("32 terminals");
  });

  it("SF1 a terminal_limit_reached also clears the pending cwd and adds no terminal", () => {
    const { dispatch, setters, deps } = setup("/w");
    dispatch(limit());
    expect(setters.setTerminals).not.toHaveBeenCalled();
    expect(deps.pendingTerminalCwdRef.current).toBeNull();
  });

  it("SF1 a terminal_added clears a terminal_error notice (a later create in a known folder)", () => {
    const { dispatch } = setup();
    render(<TerminalLimitNotice cwd="/known" inline={false} />);
    dispatch(terr({ cwd: "/unknown" }));
    expect(screen.getByRole("status")).toBeTruthy();
    dispatch({ type: "terminal_added", terminal: { id: "t9", cwd: "/known", shell: "sh", status: "active", createdAt: 1 } } as ServerToBrowserMessage);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("folder_refused", () => {
  it("F6 one error toast naming the path and telling the user to ask the host", () => {
    const { dispatch, showToast } = setup();
    dispatch({ type: "folder_refused", path: "/", reason: "outside_allowed_roots" });
    expect(showToast).toHaveBeenCalledTimes(1);
    const [text, variant] = showToast.mock.calls[0];
    expect(text).toContain("/");
    expect(text).toMatch(/Ask the host to pin it/);
    expect(variant).toBe("error");
  });
});
