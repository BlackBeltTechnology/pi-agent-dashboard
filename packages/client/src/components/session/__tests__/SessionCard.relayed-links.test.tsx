/**
 * Relayed repository URLs never become active links (harden-client-sinks, test-plan #E9).
 *
 * `gitPrUrl` / `gitBranchUrl` are relayed from a pi session, so they are
 * untrusted. A `javascript:` or `data:` value must render as text only.
 *
 * Harness glue copied from SessionCard.ended-reason.test.tsx.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeRunConfig, RunConfigHarness } from "../../../test-support/runConfigHarness.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { MobileActionMenu } from "../../shell/MobileActionMenu.js";
import { PrSegment } from "../../worktree/WorktreeActionsMenu.js";
import { GroupGitInfo, SessionCard } from "../SessionCard.js";

vi.mock("../../../hooks/useMobile.js", () => ({
  useMobile: vi.fn(() => false),
}));

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
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

const render = (ui: React.ReactElement) =>
  rtlRender(
    <ThemeProvider>
      <RunConfigHarness value={makeRunConfig()}>{ui}</RunConfigHarness>
    </ThemeProvider>,
  );

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "relay-1",
    cwd: "/home/user/project",
    source: "tui",
    status: "idle",
    startedAt: Date.now() - 60_000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    gitBranch: "feature/x",
    gitBranchUrl: "data:text/html,x",
    gitPrNumber: 7,
    gitPrUrl: "javascript:alert(1)",
    ...overrides,
  };
}

function expectNoScriptOrDataHref(root: ParentNode) {
  for (const el of root.querySelectorAll("[href]")) {
    const href = (el.getAttribute("href") ?? "").trim().toLowerCase();
    expect(href.startsWith("javascript:"), href).toBe(false);
    expect(href.startsWith("data:"), href).toBe(false);
  }
}

describe("relayed git URLs render inert (#E9)", () => {
  it("SessionCard git row", () => {
    const { container } = render(
      <SessionCard session={makeSession()} selectedId={undefined} onSelect={() => {}} now={Date.now()} showGitInfo isHidden={false} onArchive={() => {}} />,
    );
    expect(container.textContent).toContain("feature/x");
    expect(container.textContent).toContain("#7");
    expectNoScriptOrDataHref(container);
  });

  it("folder header GroupGitInfo", () => {
    const { container } = render(<GroupGitInfo sessions={[makeSession()]} cwd="/home/user/project" />);
    expect(container.textContent).toContain("feature/x");
    expect(container.textContent).toContain("#7");
    expectNoScriptOrDataHref(container);
  });

  it("MobileActionMenu git row", () => {
    render(<MobileActionMenu session={makeSession()} />);
    fireEvent.click(screen.getByTestId("mobile-kebab-btn"));
    const menu = screen.getByTestId("mobile-action-menu");
    expect(menu.textContent).toContain("#7");
    expectNoScriptOrDataHref(document.body);
  });

  it("WorktreeActionsMenu PR segment", () => {
    const { container } = render(<PrSegment session={makeSession()} />);
    expect(container.textContent).toContain("7");
    expectNoScriptOrDataHref(container);
  });
});
