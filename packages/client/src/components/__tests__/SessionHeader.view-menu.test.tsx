/**
 * F17 — the `⚙ View` menu (`ChatViewMenu`) mounts in the session header
 * immediately after the layout switch, and is absent from the composer and the
 * dock. See change: add-composer-dock (test-plan #F17). The header mount itself
 * shipped with `reorganize-session-header` (`renderViewMenu`); this pins the
 * placement from the dock's side.
 *
 * @structural-pin "absent from the composer and dock" is a source-level invariant (no mount to render both in one DOM)
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { SessionHeader } from "../session/SessionHeader.js";
import { SplitWorkspaceProvider } from "../split/SplitWorkspaceContext.js";

let mobile = false;
vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => mobile }));

afterEach(cleanup);

const session = { id: "sv", status: "idle", cwd: "/tmp", startedAt: Date.now() - 60_000 } as DashboardSession;

function renderHeader(withMenu = true) {
  return render(
    <SplitWorkspaceProvider sessionId="sv" cwd="/tmp" orientation="v">
      <SessionHeader
        session={session}
        state={createInitialState()}
        mobileActions={mobile ? {} : undefined}
        renderViewMenu={withMenu ? () => <button type="button" title="View options">View</button> : undefined}
      />
    </SplitWorkspaceProvider>,
  );
}

describe("SessionHeader View menu (desktop)", () => {
  beforeEach(() => {
    mobile = false;
  });

  it("mounts the View trigger immediately after the layout switch", async () => {
    renderHeader();
    const trigger = await screen.findByTitle("View options");
    const layout = screen.getByTestId("layout-mode-switch");
    expect(layout.nextElementSibling?.contains(trigger) || layout.nextElementSibling === trigger).toBe(true);
  });

  it("is absent when the header gets no View renderer (read-only archived view)", () => {
    renderHeader(false);
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
