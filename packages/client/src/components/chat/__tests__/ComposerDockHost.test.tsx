/**
 * ComposerDockHost: row targets and collapse controls exist only for a dock that is live for the
 * session the editor pane serves; Open / Diff dispatch into the split workspace, Review is untouched.
 * Test-plan #E16 (+ host half of #E11/#E13). See change: composer-dock-collapse-and-file-open (task 4.3).
 */
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { createInitialState } from "../../../lib/chat/event-reducer.js";
import { OpenSpecMapContext } from "../../../lib/openspec/OpenSpecMapContext.js";
import { ComposerDockHost, type ComposerDockHostProps } from "../ComposerDockHost.js";
import { useDockAccordion } from "../composer-dock-model.js";
import { makeSession, stubSessionDiffFetch } from "./dock-harness.js";

const split = { current: null as null | { sessionId: string; openInSplit: ReturnType<typeof vi.fn>; openDiffTab: ReturnType<typeof vi.fn> } };
vi.mock("../../split/SplitWorkspaceContext.js", () => ({ useOptionalSplitWorkspace: () => split.current }));

const settle = () =>
  act(async () => {
    // Microtask flush (mocked fetch + state), deterministic under load.
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

beforeEach(() => {
  localStorage.clear();
  split.current = { sessionId: "s1", openInSplit: vi.fn(), openDiffTab: vi.fn() };
  stubSessionDiffFetch(() => ({
    body: {
      success: true,
      data: {
        isGitRepo: true,
        files: [{ path: "src/a.ts", changes: [], origin: "edit", sessionOwned: true, previewable: true, additions: 2, deletions: 1 }],
      },
    },
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function HostWithAccordion(props: Omit<ComposerDockHostProps, "openLane" | "onOpenLaneChange">) {
  const accordion = useDockAccordion(props.session?.id ?? null);
  return <ComposerDockHost {...props} openLane={accordion.openLane} onOpenLaneChange={accordion.setOpenLane} />;
}

async function renderHost(over: Partial<Omit<ComposerDockHostProps, "openLane" | "onOpenLaneChange">> = {}) {
  const props = {
    session: makeSession(),
    state: createInitialState(),
    cwd: "/repo",
    working: false,
    onKillProcess: () => {},
    openspecHasDir: false,
    openspecPending: false,
    ...over,
  };
  const view = render(
    <Router hook={memoryLocation({ path: "/" }).hook}>
      <OpenSpecMapContext.Provider value={new Map()}>
        <PluginContextProvider registry={createSlotRegistry()}>
          <HostWithAccordion {...props} />
        </PluginContextProvider>
      </OpenSpecMapContext.Provider>
    </Router>,
  );
  await settle();
  return view;
}
const openChangesLane = async () => {
  fireEvent.click(document.querySelector("[data-dock-toggle='changes']") as HTMLElement);
  await settle();
};

describe("ComposerDockHost", () => {
  it("E11/E13: Open dispatches openFile for the path, Diff opens diff:<path>, Review still navigates", async () => {
    const onReview = vi.fn();
    await renderHost({ onReview });
    await openChangesLane();
    const row = screen.getAllByTestId("composer-dock-row")[0] as HTMLElement;
    fireEvent.click(within(row).getByTestId("composer-dock-file-open"));
    expect(split.current?.openInSplit).toHaveBeenCalledTimes(1);
    expect(split.current?.openInSplit.mock.calls[0][0]).toBe("src/a.ts");
    fireEvent.click(within(row).getByTestId("composer-dock-file-diff"));
    expect(split.current?.openDiffTab).toHaveBeenCalledWith("src/a.ts");
    expect(onReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("composer-dock-review"));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it("E16: a non-live dock (frozen underlay) renders no row targets and no collapse controls", async () => {
    await renderHost({ live: false });
    await openChangesLane();
    expect(screen.queryByTestId("composer-dock-file-open")).toBeNull();
    expect(screen.queryByTestId("composer-dock-file-diff")).toBeNull();
    expect(screen.queryByTestId("composer-dock-hide")).toBeNull();
  });

  it("E16: a split workspace bound to another session renders no row targets and no collapse controls", async () => {
    split.current = { sessionId: "other", openInSplit: vi.fn(), openDiffTab: vi.fn() };
    await renderHost();
    await openChangesLane();
    expect(screen.queryByTestId("composer-dock-file-open")).toBeNull();
    expect(screen.queryByTestId("composer-dock-hide")).toBeNull();
  });

  it("no split workspace at all: no targets, no collapse controls", async () => {
    split.current = null;
    await renderHost();
    await openChangesLane();
    expect(screen.queryByTestId("composer-dock-file-open")).toBeNull();
    expect(screen.queryByTestId("composer-dock-hide")).toBeNull();
  });

  it("a live dock offers Hide", async () => {
    await renderHost();
    expect(screen.getByTestId("composer-dock-hide")).toBeTruthy();
  });
});
