/**
 * Mobile session header: one 48 px row — back, title, ring, layout menu, View, ⋯.
 * See changes: editor-layout-modes (F11), reorganize-session-header (E4, E14, E16, X1).
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { loadSplitState } from "../../lib/layout/split-state.js";
import { SessionHeader } from "../session/SessionHeader.js";
import { SplitWorkspaceProvider } from "../split/SplitWorkspaceContext.js";

// Force mobile layout for these tests.
vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => true }));
vi.mock("../shell/MobileActionMenu.js", () => ({
  MobileActionMenu: () => <button type="button" data-testid="mobile-kebab-btn" aria-label="Session actions" />,
}));

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function makeSession(overrides?: Partial<DashboardSession>): DashboardSession {
  return { id: "sMob", name: "Mobile session", status: "idle", cwd: "/tmp", startedAt: Date.now() - 60_000, ...overrides } as DashboardSession;
}

type HeaderProps = Partial<React.ComponentProps<typeof SessionHeader>>;

function renderMobileHeader(props: HeaderProps = {}, session = makeSession()) {
  const ui = (p: HeaderProps) => (
    <SplitWorkspaceProvider sessionId="sMob" cwd="/tmp" orientation="v">
      <SessionHeader session={session} state={createInitialState()} mobileActions={{}} {...p} />
    </SplitWorkspaceProvider>
  );
  const view = render(ui(props));
  return { ...view, rerenderWith: (p: HeaderProps) => view.rerender(ui(p)) };
}

const USAGE = { tokens: 127_000, contextWindow: 1_000_000 };
const VIEW = () => <button type="button" data-testid="view-trigger" aria-label="View options" />;

describe("SessionHeader mobile layout menu (F11)", () => {
  it("renders the layout-mode trigger in the mobile header, Chat active by default", () => {
    renderMobileHeader();
    const trigger = screen.getByTestId("layout-mode-switch");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(trigger);
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
    expect(screen.getByTestId("layout-mode-closed").getAttribute("aria-checked")).toBe("true");
  });

  it("is mode-reactive: selecting Editor sets full on the mobile header", () => {
    renderMobileHeader();
    fireEvent.click(screen.getByTestId("layout-mode-switch"));
    fireEvent.click(screen.getByTestId("layout-mode-full"));
    expect(loadSplitState("sMob").mode).toBe("full");
  });
});

describe("SessionHeader mobile one row (E14)", () => {
  it("renders back, title, ring button, layout trigger, View and ⋯ in one row; warning + vault chip below", () => {
    renderMobileHeader(
      { showBack: true, onBack: () => {}, contextUsage: USAGE, renderViewMenu: VIEW },
      makeSession({ piBelowFloor: { required: "1.2.0", actual: "1.0.0" } as never, piVersion: "1.0.0" }),
    );
    const row = screen.getByTestId("mobile-header-row");
    for (const id of ["back-button", "mobile-header-title", "context-ring-button", "layout-mode-switch", "view-trigger", "mobile-kebab-btn"]) {
      expect(row.contains(screen.getByTestId(id))).toBe(true);
    }
    const order = ["back-button", "mobile-header-title", "context-ring-button", "layout-mode-switch", "view-trigger", "mobile-kebab-btn"].map((id) => screen.getByTestId(id));
    for (let i = 0; i < order.length - 1; i++) {
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(row.contains(screen.getByTestId("pi-below-floor-warning"))).toBe(false);
    expect(screen.queryByTestId("mobile-attach-btn")).toBeNull();
    expect(screen.queryByTestId("mobile-header-attached-chip")).toBeNull();
  });
});

describe("SessionHeader mobile context ring (E4, E16, X1)", () => {
  it("E4 the ring follows the contextUsageBar preference on mobile", () => {
    const on = renderMobileHeader({ contextUsage: USAGE, showContextRing: true });
    expect(screen.getByTestId("context-ring-button")).toBeTruthy();
    on.unmount();
    renderMobileHeader({ contextUsage: USAGE, showContextRing: false });
    expect(screen.queryByTestId("context-ring-button")).toBeNull();
  });

  it("E16 the popover reads pct · tokens · cost, omits a zero cost, and Escape returns focus", () => {
    const withCost = render(
      <SplitWorkspaceProvider sessionId="sMob" cwd="/tmp" orientation="v">
        <SessionHeader session={makeSession()} state={{ ...createInitialState(), cost: 0.99 }} mobileActions={{}} contextUsage={USAGE} />
      </SplitWorkspaceProvider>,
    );
    const button = screen.getByTestId("context-ring-button");
    expect(button.getAttribute("aria-label")).toBe("Context: 13% used, 127.0k of 1.0M tokens");
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("false");
    expect(dialog.textContent).toBe("13% · 127.0k of 1.0M tokens · $0.99");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
    withCost.unmount();

    renderMobileHeader({ contextUsage: USAGE });
    fireEvent.click(screen.getByTestId("context-ring-button"));
    expect(screen.getByRole("dialog").textContent).toBe("13% · 127.0k of 1.0M tokens");
  });

  it("X1 usage disappearing while the popover is open unmounts ring and popover without error", () => {
    const view = renderMobileHeader({ contextUsage: USAGE });
    const button = screen.getByTestId("context-ring-button");
    fireEvent.click(button);
    button.focus();
    expect(screen.getByRole("dialog")).toBeTruthy();
    view.rerenderWith({ contextUsage: undefined });
    expect(screen.queryByTestId("context-ring-button")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.contains(document.activeElement)).toBe(true);
    expect([document.body, screen.getByTestId("mobile-kebab-btn")]).toContain(document.activeElement);
  });
});
