/**
 * Sidebar header row 1 + the open-questions pill (sidebar-header spec; test-plan
 * #E17 host half, #F1 filter-bypass half). See change: add-pending-question-stack.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { yoloStatus } from "../../lib/access-grants/yolo-status.js";
import { questionStore } from "../../lib/questions/question-store.js";
import { installFakeYoloServer, scopedSession, view } from "../access-grant/__tests__/yolo-test-server.js";
import { row, rows } from "../questions/__tests__/question-fixtures.js";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

function TestRouter({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

const NOW = Date.now();
const mk = (id: string, over: Partial<DashboardSession> = {}) =>
  ({ id, cwd: "/repo", source: "tui", status: "active", startedAt: NOW, tokensIn: 0, tokensOut: 0, cost: 0, name: `Name ${id}`, ...over }) as DashboardSession;

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
  questionStore.reset();
  yoloStatus.publish(view(installFakeYoloServer({ now: NOW })).yolo);
});
afterEach(() => {
  cleanup();
  questionStore.reset();
});

function renderList(sessions: DashboardSession[], onSelect = vi.fn(), onSeekToCard = vi.fn()) {
  render(
    <TestRouter>
      <ThemeProvider>
        <SessionList sessions={sessions} onSelect={onSelect} onSeekToCard={onSeekToCard} />
      </ThemeProvider>
    </TestRouter>,
  );
  return { row1: screen.getByTestId("header-app-bar"), onSelect, onSeekToCard };
}
const ids = (row1: HTMLElement) => [...row1.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid"));

describe("sidebar header row 1 — open-questions pill (E17)", () => {
  it("0 open: no pill, row-1 testids exactly as before", () => {
    act(() => questionStore.set([]));
    const before = ids(renderList([mk("s1")]).row1);
    expect(before).not.toContain("question-pill");
    expect(before).toEqual(expect.arrayContaining(["theme-toggle", "tunnel-btn", "discord-btn", "settings-btn"]));
  });

  it("3 open: pill named '3 open questions', every existing control still present", () => {
    act(() => questionStore.set([]));
    const before = ids(renderList([mk("s1")]).row1);
    cleanup();
    act(() => questionStore.set(rows(3)));
    const { row1 } = renderList([mk("s1")]);
    const pill = screen.getByTestId("question-pill");
    expect(row1.contains(pill)).toBe(true);
    expect(pill.getAttribute("aria-label")).toBe("3 open questions");
    expect(ids(row1).filter((id) => id !== "question-pill")).toEqual(before);
  });

  it("sits immediately after the YOLO slot when YOLO is active", () => {
    const server = installFakeYoloServer({ now: NOW });
    server.session = scopedSession(NOW, "/repo");
    yoloStatus.publish(view(server).yolo);
    act(() => questionStore.set(rows(1)));
    const { row1 } = renderList([mk("s1")]);
    const order = ids(row1);
    expect(order.indexOf("question-pill")).toBe(order.indexOf("yolo-pill") + 1);
  });

  it("sits after the Gateway control when YOLO is off (the YOLO slot position)", () => {
    act(() => questionStore.set(rows(1)));
    const { row1 } = renderList([mk("s1")]);
    const order = ids(row1);
    expect(order.indexOf("question-pill")).toBe(order.indexOf("tunnel-btn") + 1);
  });
});

describe("activation from the host (F1)", () => {
  it("visible session: selects it, reveals its card, no dialog", () => {
    act(() => questionStore.set([row({ id: "q1", sessionId: "s1" })]));
    const { onSelect, onSeekToCard } = renderList([mk("s1")]);
    fireEvent.click(screen.getByTestId("question-pill"));
    fireEvent.click(screen.getByTestId("question-row-q1"));
    expect(onSelect).toHaveBeenCalledWith("s1");
    expect(onSeekToCard).toHaveBeenCalledWith("s1");
    expect(screen.queryByTestId("question-dialog")).toBeNull();
  });

  it("session filtered out by the search filter: filter bypassed, session selected", () => {
    act(() => questionStore.set([row({ id: "q1", sessionId: "s1" })]));
    const { onSelect } = renderList([mk("s1", { name: "Alpha" })]);
    const search = screen.getByTestId("session-search-input") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "zzz-no-match" } });
    expect(search.value).toBe("zzz-no-match");
    fireEvent.click(screen.getByTestId("question-pill"));
    fireEvent.click(screen.getByTestId("question-row-q1"));
    expect(search.value).toBe("");
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("hidden automation session: dialog opens, no selection", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404, json: async () => ({ success: false, error: "nf" }) }));
    const hidden = mk("s1", { kind: "automation", automationRun: { name: "n", runId: "r", visibility: "hidden" } });
    act(() => questionStore.set([row({ id: "q1", sessionId: "s1" })]));
    const { onSelect } = renderList([hidden]);
    fireEvent.click(screen.getByTestId("question-pill"));
    fireEvent.click(screen.getByTestId("question-row-q1"));
    await act(async () => {});
    expect(screen.getByTestId("question-dialog")).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
