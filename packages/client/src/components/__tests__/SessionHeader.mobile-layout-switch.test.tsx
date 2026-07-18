/**
 * F11 — the layout-mode switch is present in the MOBILE session header and
 * reflects the current mode. Covers task 2.5 (add the switch to MobileHeader)
 * and test-plan #F11 at component level; the mobile-viewport L3 spawn path is
 * flaky harness infra (shared-container spawn helpers assume desktop layout).
 *
 * See change: editor-layout-modes.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { loadSplitState } from "../../lib/layout/split-state.js";
import { SessionHeader } from "../session/SessionHeader.js";
import { SplitWorkspaceProvider } from "../split/SplitWorkspaceContext.js";

// Force mobile layout for these tests.
vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => true }));

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function makeSession(): DashboardSession {
  return { id: "sMob", status: "idle", cwd: "/tmp", startedAt: Date.now() - 60_000 } as DashboardSession;
}

function renderMobileHeader() {
  return render(
    <SplitWorkspaceProvider sessionId="sMob" cwd="/tmp" orientation="v">
      <SessionHeader session={makeSession()} state={createInitialState()} mobileActions={{}} />
    </SplitWorkspaceProvider>,
  );
}

describe("SessionHeader mobile layout switch (F11)", () => {
  it("renders the layout-mode switch in the mobile header, Chat active by default", () => {
    renderMobileHeader();
    expect(screen.getByTestId("layout-mode-switch").getAttribute("role")).toBe("radiogroup");
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByTestId("layout-mode-closed").getAttribute("aria-checked")).toBe("true");
  });

  it("is mode-reactive: selecting Editor sets full on the mobile header", () => {
    renderMobileHeader();
    fireEvent.click(screen.getByTestId("layout-mode-full"));
    expect(loadSplitState("sMob").mode).toBe("full");
    expect(screen.getByTestId("layout-mode-full").getAttribute("aria-checked")).toBe("true");
  });
});
