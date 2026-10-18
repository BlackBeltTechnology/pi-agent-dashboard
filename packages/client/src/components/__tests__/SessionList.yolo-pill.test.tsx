/**
 * Sidebar header row 1 under active YOLO: tint, no added control, no ticking
 * (changes: add-access-grant-dialog 8b.7c; fix-yolo-indicator-overflow;
 * test-plan #E16, #P1). The file name predates the pill's removal.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { Profiler } from "react";
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
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderRow(onRender?: React.ProfilerOnRenderCallback) {
  const list = (
    <TestRouter>
      <ThemeProvider>
        <SessionList sessions={[session]} onSelect={() => {}} />
      </ThemeProvider>
    </TestRouter>
  );
  render(onRender ? <Profiler id="list" onRender={onRender}>{list}</Profiler> : list);
  return screen.getByTestId("header-app-bar");
}

/** Row-1 controls that exist regardless of YOLO. */
const TODAY = ["theme-toggle", "discord-btn", "settings-btn"];
const rowTestIds = (row: HTMLElement) =>
  [...row.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid"));

describe("sidebar header row 1", () => {
  it("no YOLO session: row 1 holds today's controls, untinted, no link, no YOLO testids", () => {
    const server = installFakeYoloServer({ now: NOW });
    yoloStatus.publish(view(server).yolo);
    const row = renderRow();
    for (const id of TODAY) expect(row.querySelector(`[data-testid="${id}"]`)).toBeTruthy();
    expect(rowTestIds(row)).not.toContain("yolo-pill");
    expect(rowTestIds(row)).not.toContain("yolo-bar-link");
    expect(row.dataset.yolo).toBeUndefined();
    expect(row.getAttribute("title")).toBeNull();
    expect(row.className).not.toContain("severity-warning");
  });

  it("E16 active YOLO: bar tinted with title + data-yolo, only the focus-revealed link is added", () => {
    const server = installFakeYoloServer({ now: NOW });
    yoloStatus.publish(view(server).yolo);
    const before = rowTestIds(renderRow());
    cleanup();

    server.session = scopedSession(NOW, "/repo");
    yoloStatus.publish(view(server).yolo);
    const row = renderRow();
    const after = rowTestIds(row);
    expect(after.filter((id) => id !== "yolo-bar-link")).toEqual(before);
    expect(after).not.toContain("yolo-pill");
    expect(row.dataset.yolo).toBe("scoped");
    expect(row.className).toContain("bg-[var(--severity-warning-bg)]");
    expect(row.className).toContain("shadow-[inset_0_-2px_0_var(--accent-orange-text)]");
    expect(row.className.split(/\s+/)).toContain("relative");
    expect(row.getAttribute("title")).toMatch(/^YOLO is on: .*Open Access to end it\.$/);
    const link = screen.getByTestId("yolo-bar-link");
    expect(row.firstElementChild).toBe(link);
    expect(link.className.split(/\s+/)).toEqual(expect.arrayContaining(["opacity-0", "absolute"]));
  });
});

describe("P1: the bar does not tick", () => {
  it("SessionList commits at most once in 5 s of advanced time while YOLO is live", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(NOW);
    const server = installFakeYoloServer({ now: NOW });
    server.session = scopedSession(NOW, "/repo");
    yoloStatus.publish(view(server).yolo);
    let commits = 0;
    renderRow(() => {
      commits += 1;
    });
    commits = 0;
    act(() => vi.advanceTimersByTime(5000));
    expect(commits).toBeLessThanOrEqual(1);
  });
});
