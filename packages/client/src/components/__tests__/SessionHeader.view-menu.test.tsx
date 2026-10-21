/**
 * F17 — the `⚙ View` menu (`ChatViewMenu`) mounts in the session header
 * immediately after the layout switch, its popover opens below the trigger, and
 * it is absent from the composer and the dock. See change: add-composer-dock
 * (task 8.3; test-plan #F17). The move was NOT done by `reorganize-session-header`
 * in this tree, so this change performs it.
 *
 * @structural-pin "absent from the composer and dock" is a source-level invariant (no mount to render both in one DOM)
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { SessionHeader } from "../session/SessionHeader.js";
import { SplitWorkspaceProvider } from "../split/SplitWorkspaceContext.js";

let mobile = false;
vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => mobile }));

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    top: 20, bottom: 50, left: 600, right: 660, width: 60, height: 30, x: 600, y: 20, toJSON: () => ({}),
  } as DOMRect);
});

const session = { id: "sv", status: "idle", cwd: "/tmp", startedAt: Date.now() - 60_000 } as DashboardSession;

function renderHeader(over: Partial<React.ComponentProps<typeof SessionHeader>> = {}) {
  const send = vi.fn();
  const utils = render(
    <SplitWorkspaceProvider sessionId="sv" cwd="/tmp" orientation="v">
      <SessionHeader
        session={session}
        state={createInitialState()}
        mobileActions={mobile ? {} : undefined}
        sendDisplayPrefs={send}
        {...over}
      />
    </SplitWorkspaceProvider>,
  );
  return { send, ...utils };
}

describe.each([false, true])("SessionHeader View menu (mobile=%s)", (isMobile) => {
  beforeEach(() => {
    mobile = isMobile;
  });

  it("mounts the View trigger immediately after the layout switch", async () => {
    renderHeader();
    const trigger = await screen.findByTitle("View options");
    const layout = screen.getByTestId("layout-mode-switch");
    expect(layout.nextElementSibling?.contains(trigger)).toBe(true);
  });

  it("opens the popover below the trigger", async () => {
    renderHeader();
    fireEvent.click(await screen.findByTitle("View options"));
    const popover = await screen.findByTestId("chat-view-popover");
    expect(popover.className).toContain("top-full");
    expect(popover.className).not.toContain("bottom-full");
  });

  it("sends setSessionDisplayPrefs for the header's session", async () => {
    const { send } = renderHeader();
    fireEvent.click(await screen.findByTitle("View options"));
    await screen.findByTestId("chat-view-popover");
    fireEvent.click(screen.getByTestId("chat-view-popover").querySelector("input[type=checkbox], [role=switch]") as HTMLElement);
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.[0]).toMatchObject({ type: "setSessionDisplayPrefs", sessionId: "sv" });
  });

  it("is absent when the header gets no display-prefs sender (read-only archived view)", () => {
    renderHeader({ sendDisplayPrefs: undefined });
    expect(screen.queryByTitle("View options")).toBeNull();
  });
});

describe("View menu is not in the composer or dock", () => {
  it("CommandInput and ComposerDock sources do not reference ChatViewMenu", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    for (const rel of ["../chat/CommandInput.tsx", "../chat/ComposerDock.tsx"]) {
      const src = fs.readFileSync(path.resolve(__dirname, rel), "utf8");
      expect(src).not.toContain("ChatViewMenu");
    }
  });
});
