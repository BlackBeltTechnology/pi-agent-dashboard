/**
 * Desktop session header redesign.
 * See changes: redesign-split-layout-controls, reorganize-session-header.
 *
 * Covers test-plan E4, E6, E7, E12, E13, E21, P1 (+ the layout-order contract).
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiFileCompare } from "@mdi/js";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type React from "react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { SplitWorkspaceProvider } from "../split/SplitWorkspaceContext.js";

const headerRenders = vi.hoisted(() => ({ n: 0 }));
vi.mock("../extension-ui/FooterSegmentSlot.js", () => ({
  FooterSegmentSlot: () => {
    headerRenders.n++;
    return null;
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetModules();
  vi.doUnmock("../../hooks/useMobile.js");
});
beforeEach(() => localStorage.clear());

function makeSession(overrides?: Partial<DashboardSession>): DashboardSession {
  return {
    id: "s1",
    status: "idle",
    cwd: "/tmp",
    startedAt: Date.now() - 60_000,
    model: "claude-opus-4",
    thinkingLevel: "high",
    piVersion: "0.9.9",
    name: "My session",
    ...overrides,
  } as DashboardSession;
}

async function loadDesktopHeader() {
  vi.doMock("../../hooks/useMobile.js", () => ({ useMobile: () => false }));
  const mod = await import("../session/SessionHeader.js");
  return mod.SessionHeader;
}

function renderInProvider(node: React.ReactElement) {
  return render(
    <SplitWorkspaceProvider sessionId="s1" cwd="/tmp" orientation="h">
      {node}
    </SplitWorkspaceProvider>,
  );
}

const FOLLOWS = Node.DOCUMENT_POSITION_FOLLOWING;
const openTitleMenu = () => fireEvent.click(screen.getByTestId("session-title-menu"));

describe("SessionHeader layout (desktop)", () => {
  it("orders back → title → reveal in the leading zone; the switch sits in the trailing zone", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(
      <SessionHeader session={makeSession()} state={createInitialState()} onRename={() => {}} showBack onBack={() => {}} onSeekToCard={() => {}} />,
    );
    const back = screen.getByTestId("back-button");
    const title = screen.getByTestId("session-title-menu");
    const reveal = screen.getByTestId("session-header-seek-card");
    const sw = screen.getByTestId("layout-mode-switch");
    expect(back.compareDocumentPosition(title) & FOLLOWS).toBeTruthy();
    expect(title.compareDocumentPosition(reveal) & FOLLOWS).toBeTruthy();
    expect(reveal.compareDocumentPosition(sw) & FOLLOWS).toBeTruthy();
    expect(within(screen.getByTestId("session-header-trailing")).getByTestId("layout-mode-switch")).toBe(sw);
  });

  it("drops model + thinkingLevel, keeps the pi version segment", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(<SessionHeader session={makeSession()} state={createInitialState()} onRename={() => {}} onSeekToCard={() => {}} />);
    expect(screen.queryByText("claude-opus-4")).toBeNull();
    expect(screen.queryByText("high")).toBeNull();
    expect(screen.getByText(/pi 0\.9\.9/)).toBeTruthy();
  });
});

describe("SessionHeader context ring gate (E4)", () => {
  const usage = { tokens: 127_000, contextWindow: 1_000_000 };

  it("renders the ring when the preference is on, and not when it is off", async () => {
    const SessionHeader = await loadDesktopHeader();
    const on = renderInProvider(<SessionHeader session={makeSession()} state={createInitialState()} contextUsage={usage} showContextRing />);
    expect(screen.getByRole("meter")).toBeTruthy();
    on.unmount();
    renderInProvider(<SessionHeader session={makeSession()} state={createInitialState()} contextUsage={usage} showContextRing={false} />);
    expect(screen.queryByRole("meter")).toBeNull();
  });

  it("falls back to state.contextUsage when no prop is given", async () => {
    const SessionHeader = await loadDesktopHeader();
    const state = { ...createInitialState(), contextUsage: usage };
    renderInProvider(<SessionHeader session={makeSession()} state={state} />);
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("13");
  });
});

describe("SessionHeader title menu (E6, E7)", () => {
  const callbacks = () => ({ onRename: vi.fn(), onSeekToCard: vi.fn(), onSetTags: vi.fn(), onRefresh: vi.fn() });

  it("E6 lists Rename, Reveal, Edit tags, Reload in order on a live session", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(<SessionHeader session={makeSession()} state={createInitialState()} {...callbacks()} />);
    openTitleMenu();
    const labels = screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");
    expect(labels[0]).toContain("Rename");
    expect(labels[1]).toContain("Reveal in sidebar");
    expect(labels[2]).toContain("Edit tags");
    expect(labels[3]).toContain("Reload transcript");
    expect(labels[3]).toContain("Re-fetch every event from the server");
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("E6 omits Rename for an ended session", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(<SessionHeader session={makeSession({ status: "ended" })} state={createInitialState()} {...callbacks()} />);
    openTitleMenu();
    expect(screen.queryByText("Rename")).toBeNull();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("E6 omits Reveal without onSeekToCard and Edit tags without onSetTags", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(<SessionHeader session={makeSession()} state={createInitialState()} onRename={vi.fn()} onRefresh={vi.fn()} />);
    openTitleMenu();
    const text = screen.getAllByRole("menuitem").map((el) => el.textContent).join("|");
    expect(text).not.toContain("Reveal in sidebar");
    expect(text).not.toContain("Edit tags");
    expect(text).toContain("Reload transcript");
  });

  it("E7 Escape closes the menu and focuses the title button", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(<SessionHeader session={makeSession()} state={createInitialState()} {...callbacks()} />);
    openTitleMenu();
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("session-title-menu"));
  });

  it("Edit tags opens the tag editor popover", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(<SessionHeader session={makeSession()} state={createInitialState()} {...callbacks()} />);
    openTitleMenu();
    fireEvent.click(screen.getByText("Edit tags"));
    expect(screen.getByRole("dialog", { name: "Add tag" })).toBeTruthy();
  });
});

describe("SessionHeader rename entry points (E12, E13)", () => {
  it("E12 F2 opens the rename input while the header has focus", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(<SessionHeader session={makeSession()} state={createInitialState()} onRename={vi.fn()} />);
    const title = screen.getByTestId("session-title-menu");
    title.focus();
    fireEvent.keyDown(title, { key: "F2" });
    expect(screen.getByDisplayValue("My session")).toBeTruthy();
  });

  it("E12 F2 inside the tag editor input does nothing", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(<SessionHeader session={makeSession()} state={createInitialState()} onRename={vi.fn()} onSetTags={vi.fn()} allTags={[]} />);
    fireEvent.click(screen.getByLabelText("Add tag", { selector: "button" }));
    const input = screen.getByLabelText("Tag name");
    fireEvent.keyDown(input, { key: "F2" });
    expect(screen.queryByDisplayValue("My session")).toBeNull();
  });

  it("E12 F2 does nothing on an ended session", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(<SessionHeader session={makeSession({ status: "ended" })} state={createInitialState()} onRename={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId("session-title-menu"), { key: "F2" });
    expect(screen.queryByDisplayValue("My session")).toBeNull();
  });

  it("E12 Escape closes the rename input and returns focus to the title button", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(<SessionHeader session={makeSession()} state={createInitialState()} onRename={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId("session-title-menu"), { key: "F2" });
    const input = screen.getByDisplayValue("My session");
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByDisplayValue("My session")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("session-title-menu"));
  });

  it("E13 double-click on the title does not start a rename", async () => {
    const onRename = vi.fn();
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(<SessionHeader session={makeSession()} state={createInitialState()} onRename={onRename} />);
    fireEvent.doubleClick(screen.getByTestId("session-title-menu"));
    expect(screen.queryByDisplayValue("My session")).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("the rename pencil button is gone", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(<SessionHeader session={makeSession()} state={createInitialState()} onRename={vi.fn()} />);
    expect(screen.queryByTitle("Rename session")).toBeNull();
  });

  it("Rename from the menu opens the input", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(<SessionHeader session={makeSession()} state={createInitialState()} onRename={vi.fn()} />);
    openTitleMenu();
    fireEvent.click(screen.getByText("Rename"));
    expect(screen.getByDisplayValue("My session")).toBeTruthy();
  });
});

describe("SessionHeader Changed Files (E21)", () => {
  it("renders the mdiFileCompare icon + 'Changed Files' text; narrow hides text visually but keeps the name", async () => {
    const SessionHeader = await loadDesktopHeader();
    renderInProvider(<SessionHeader session={makeSession()} state={createInitialState()} hasFileChanges onOpenDiffView={() => {}} />);
    const chip = screen.getByTestId("changed-files-chip");
    expect(chip.querySelector("svg path")?.getAttribute("d")).toBe(mdiFileCompare);
    expect(chip.textContent).toContain("Changed Files");
    expect(chip.getAttribute("title")).toBe("Changed Files");
    // The word is visually hidden (not removed) below the 760 px container.
    const word = Array.from(chip.querySelectorAll("span")).find((el) => el.textContent === "Changed Files");
    expect(word?.className).toContain("@max-[760px]:sr-only");
  });
});

describe("SessionHeader clock isolation (P1)", () => {
  it("a clock tick re-renders SessionClock only — SessionHeader renders 0 times in 3 s", async () => {
    vi.useFakeTimers();
    const SessionHeader = await loadDesktopHeader();
    const commits = { n: 0 };
    renderInProvider(
      <Profiler id="header" onRender={() => { commits.n++; }}>
        <SessionHeader session={makeSession({ startedAt: Date.now() })} state={createInitialState()} />
      </Profiler>,
    );
    expect(screen.getByTestId("session-clock").textContent).toBe("running 0s");
    // FooterSegmentSlot is an un-memoised direct child of the header: it only
    // re-renders when SessionHeader itself does.
    headerRenders.n = 0;
    commits.n = 0;
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(headerRenders.n).toBe(0);
    expect(screen.getByTestId("session-clock").textContent).toBe("running 3s");
    // One commit per tick, all of them inside the clock leaf.
    expect(commits.n).toBe(3);
  });
});
