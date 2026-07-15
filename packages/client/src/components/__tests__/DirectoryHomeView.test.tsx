/**
 * Tests for DirectoryHomeView — the bare `/folder/:encodedCwd` directory home
 * page. Covers the spawn-mode adapter args (E1), empty-prompt guard (E2),
 * in-flight send disable (E3), the pinned guard (E4) + cold-load gate (E5), and
 * populated / empty folder content (F3 / F4).
 * See change: add-directory-home-page.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { DirectoryHomeView } from "../DirectoryHomeView.js";

function TestRouter({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => cleanup());

function makeSession(id: string, cwd: string, name?: string): DashboardSession {
  return {
    id,
    cwd,
    name,
    source: "tui",
    status: "idle",
    startedAt: 0,
  } as DashboardSession;
}

function renderView(
  overrides: Partial<React.ComponentProps<typeof DirectoryHomeView>> = {},
) {
  const onSpawnSession = vi.fn();
  const onSelectSession = vi.fn();
  const onPinDirectory = vi.fn();
  const props: React.ComponentProps<typeof DirectoryHomeView> = {
    cwd: "/a",
    pinnedDirectories: ["/a"],
    pinnedDirectoriesLoaded: true,
    sessions: [],
    onSpawnSession,
    onSelectSession,
    onPinDirectory,
    ...overrides,
  };
  const utils = render(
    <TestRouter>
      <DirectoryHomeView {...props} />
    </TestRouter>,
  );
  return { onSpawnSession, onSelectSession, onPinDirectory, ...utils };
}

function typePrompt(text: string) {
  const textarea = screen.getByRole("textbox");
  fireEvent.change(textarea, { target: { value: text } });
}

describe("DirectoryHomeView spawn-mode adapter", () => {
  it("E1: send calls handleSpawnSession(cwd, undefined, { initialPrompt }) — 2nd arg is undefined", () => {
    const { onSpawnSession } = renderView({ cwd: "/a" });
    typePrompt("do X");
    fireEvent.click(screen.getByTestId("send-button"));
    expect(onSpawnSession).toHaveBeenCalledTimes(1);
    expect(onSpawnSession).toHaveBeenCalledWith("/a", undefined, { initialPrompt: "do X" });
    // Explicit: the 2nd arg (attachProposal) must be undefined, not an options object.
    expect(onSpawnSession.mock.calls[0]![1]).toBeUndefined();
  });

  it("E2: empty / whitespace-only prompt does not spawn", () => {
    const { onSpawnSession } = renderView();
    typePrompt("   ");
    // Send is disabled for whitespace-only text; a click is a no-op.
    expect((screen.getByTestId("send-button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("send-button"));
    expect(onSpawnSession).not.toHaveBeenCalled();
  });

  it("E3: send is disabled while a spawn from this page is in flight; no second spawn", () => {
    const { onSpawnSession } = renderView();
    typePrompt("first");
    fireEvent.click(screen.getByTestId("send-button"));
    expect(onSpawnSession).toHaveBeenCalledTimes(1);
    // After the first spawn, the send control is disabled.
    expect((screen.getByTestId("send-button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("send-button"));
    expect(onSpawnSession).toHaveBeenCalledTimes(1);
  });
});

describe("DirectoryHomeView pinned guard", () => {
  it("E4: a non-pinned cwd renders the not-pinned notice + pin CTA, no prompt", () => {
    const { onPinDirectory } = renderView({
      pinnedDirectories: ["/a"],
      cwd: "/b",
      pinnedDirectoriesLoaded: true,
    });
    expect(screen.getByTestId("directory-home-not-pinned")).toBeTruthy();
    expect(screen.queryByTestId("directory-home-prompt")).toBeNull();
    fireEvent.click(screen.getByTestId("directory-home-pin-cta"));
    expect(onPinDirectory).toHaveBeenCalledWith("/b");
  });

  it("E5: cold load shows loading, never flashes not-pinned; prompt appears once loaded", () => {
    const { rerender } = render(
      <TestRouter>
        <DirectoryHomeView
          cwd="/a"
          pinnedDirectories={[]}
          pinnedDirectoriesLoaded={false}
          sessions={[]}
          onSpawnSession={vi.fn()}
          onSelectSession={vi.fn()}
        />
      </TestRouter>,
    );
    expect(screen.getByTestId("directory-home-loading")).toBeTruthy();
    expect(screen.queryByTestId("directory-home-not-pinned")).toBeNull();
    expect(screen.queryByTestId("directory-home-prompt")).toBeNull();

    rerender(
      <TestRouter>
        <DirectoryHomeView
          cwd="/a"
          pinnedDirectories={["/a"]}
          pinnedDirectoriesLoaded={true}
          sessions={[]}
          onSpawnSession={vi.fn()}
          onSelectSession={vi.fn()}
        />
      </TestRouter>,
    );
    expect(screen.queryByTestId("directory-home-loading")).toBeNull();
    expect(screen.queryByTestId("directory-home-not-pinned")).toBeNull();
    expect(screen.getByTestId("directory-home-prompt")).toBeTruthy();
  });
});

describe("DirectoryHomeView content", () => {
  it("F3: a populated folder renders header, sessions, quick actions, and the prompt", () => {
    const { onSelectSession } = renderView({
      cwd: "/a",
      sessions: [makeSession("s1", "/a", "Session One"), makeSession("s2", "/a", "Session Two")],
    });
    expect(screen.getByTestId("directory-home-header")).toBeTruthy();
    expect(screen.getByTestId("directory-home-session-s1")).toBeTruthy();
    expect(screen.getByTestId("directory-home-session-s2")).toBeTruthy();
    expect(screen.getByTestId("directory-home-open-terminals")).toBeTruthy();
    expect(screen.getByTestId("directory-home-open-editor")).toBeTruthy();
    expect(screen.getByTestId("directory-home-open-settings")).toBeTruthy();
    expect(screen.getByTestId("directory-home-prompt")).toBeTruthy();
    fireEvent.click(screen.getByTestId("directory-home-session-s1"));
    expect(onSelectSession).toHaveBeenCalledWith("s1");
  });

  it("F4: an empty folder renders the centered prompt, an empty session list, and no LandingPage surface", () => {
    renderView({ cwd: "/a", sessions: [] });
    expect(screen.getByTestId("directory-home-prompt")).toBeTruthy();
    expect(screen.queryByTestId("directory-home-session-list")).toBeNull();
    // No onboarding LandingPage surface leaks into the folder home.
    expect(screen.queryByTestId("onboarding-step-1-cta")).toBeNull();
    expect(screen.queryByTestId("onboarding-step-1-done")).toBeNull();
  });
});
