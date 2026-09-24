/**
 * Sidebar header row 1 + the conditional YOLO pill (change:
 * add-access-grant-dialog, tasks 8b.7, 8b.7c; test-plan row 10.66 / #E50).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { yoloStatus } from "../../lib/access-grants/yolo-status.js";
import { installFakeYoloServer, scopedSession, view } from "../access-grant/__tests__/yolo-test-server.js";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

function TestRouter({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

const NOW = Date.now();
const session = { id: "s1", cwd: "/repo", source: "tui", status: "active", startedAt: NOW, tokensIn: 0, tokensOut: 0, cost: 0 } as DashboardSession;

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

function renderRow() {
  render(
    <TestRouter>
      <ThemeProvider>
        <SessionList sessions={[session]} onSelect={() => {}} />
      </ThemeProvider>
    </TestRouter>,
  );
  return screen.getByTestId("header-app-bar");
}

/** Row-1 controls that exist regardless of YOLO. */
const TODAY = ["theme-toggle", "discord-btn", "settings-btn"];
const rowTestIds = (row: HTMLElement) =>
  [...row.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid"));

describe("sidebar header row 1", () => {
  it("no YOLO session: row 1 holds today's controls and no pill", () => {
    const server = installFakeYoloServer({ now: NOW });
    yoloStatus.publish(view(server).yolo);
    const row = renderRow();
    for (const id of TODAY) expect(row.querySelector(`[data-testid="${id}"]`)).toBeTruthy();
    expect(rowTestIds(row)).not.toContain("yolo-pill");
  });

  it("active YOLO: pill added beside the Gateway control, every existing control still present", () => {
    const server = installFakeYoloServer({ now: NOW });
    yoloStatus.publish(view(server).yolo);
    const before = rowTestIds(renderRow());
    cleanup();

    server.session = scopedSession(NOW, "/repo");
    yoloStatus.publish(view(server).yolo);
    const row = renderRow();
    const after = rowTestIds(row);
    expect(after.filter((id) => id !== "yolo-pill")).toEqual(before);
    const pill = screen.getByTestId("yolo-pill");
    expect(row.contains(pill)).toBe(true);
    expect(pill.textContent).toMatch(/\d+:\d\d/);
    // Beside the Gateway (TunnelButton) control.
    const gateway = screen.getByTestId("tunnel-btn");
    expect(after.indexOf("yolo-pill")).toBe(after.indexOf("tunnel-btn") + 1);
    expect(row.contains(gateway)).toBe(true);
  });
});
