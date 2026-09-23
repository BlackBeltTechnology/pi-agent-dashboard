/**
 * Active-YOLO indicators (change: add-access-grant-dialog, task 8b.7;
 * test-plan rows 10.66, 10.71 (unit half), 10.72).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { YoloSessionView } from "../../../lib/access-grants/access-prompts-types.js";
import { yoloStatus } from "../../../lib/access-grants/yolo-status.js";
import { YoloPill, YoloSessionIndicator } from "../YoloIndicators.js";
import { type FakeYoloServer, installFakeYoloServer, scopedSession, view } from "./yolo-test-server.js";

let server: FakeYoloServer;
const NOW = 1_700_000_000_000;

function setSession(session: YoloSessionView | null) {
  server.session = session;
  yoloStatus.publish(view(server).yolo);
}

function renderAt(ui: React.ReactNode) {
  const loc = memoryLocation({ path: "/", record: true });
  render(<Router hook={loc.hook}>{ui}</Router>);
  return loc;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  server = installFakeYoloServer({ now: NOW });
  setSession(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("YoloPill (sidebar header row 1)", () => {
  it("is absent when no YOLO session is active (10.66)", () => {
    renderAt(<YoloPill />);
    expect(screen.queryByTestId("yolo-pill")).toBeNull();
  });

  it("shows the remaining time and leads to the Access page", () => {
    setSession(scopedSession(NOW, "/repo"));
    const loc = renderAt(<YoloPill />);
    const pill = screen.getByTestId("yolo-pill");
    expect(pill.textContent).toContain("15:00");
    expect(pill.getAttribute("href")).toBe("/settings/access");
    fireEvent.click(pill);
    expect(loc.history?.at(-1)).toBe("/settings/access");
  });

  it("ticks client-side from expiresAt", () => {
    setSession(scopedSession(NOW, "/repo"));
    renderAt(<YoloPill />);
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByTestId("yolo-pill").textContent).toContain("13:59");
  });

  it("an unscoped session is visibly distinct from a scoped one", () => {
    setSession(scopedSession(NOW, "/repo"));
    renderAt(<YoloPill />);
    const scoped = screen.getByTestId("yolo-pill");
    const scopedClass = scoped.className;
    expect(scoped.dataset.scope).toBe("scoped");
    expect(scoped.textContent).not.toMatch(/everywhere/i);
    cleanup();

    setSession({ ...scopedSession(NOW), unscoped: true });
    renderAt(<YoloPill />);
    const unscoped = screen.getByTestId("yolo-pill");
    expect(unscoped.dataset.scope).toBe("unscoped");
    expect(unscoped.textContent).toMatch(/everywhere/i);
    // Warning, never error (ui-plan S6); distinct by weight and border.
    expect(unscoped.className).toContain("severity-warning");
    expect(unscoped.className).not.toContain("severity-error");
    expect(unscoped.className).toContain("font-bold");
    expect(scopedClass).toContain("severity-warning");
  });

  it("an environment session reads as unbounded", () => {
    setSession({ ...scopedSession(NOW, "/repo"), source: "env", expiresAt: null });
    renderAt(<YoloPill />);
    expect(screen.getByTestId("yolo-pill").getAttribute("title")).toMatch(/until the server stops/);
  });

  it("disappears once the expiry has passed", () => {
    setSession(scopedSession(NOW, "/repo"));
    renderAt(<YoloPill />);
    act(() => {
      vi.advanceTimersByTime(15 * 60_000);
    });
    expect(screen.queryByTestId("yolo-pill")).toBeNull();
  });
});

describe("YoloSessionIndicator (session surface)", () => {
  it("renders on a session whose cwd is inside a root, with the remaining time", () => {
    setSession(scopedSession(NOW, "/repo"));
    renderAt(<YoloSessionIndicator cwd="/repo/pkg" />);
    expect(screen.getByTestId("yolo-session-indicator").textContent).toMatch(/15:00 left/);
  });

  it("is absent outside every root (component-wise: /repo-secrets is not in /repo)", () => {
    setSession(scopedSession(NOW, "/repo"));
    renderAt(<YoloSessionIndicator cwd="/repo-secrets" />);
    expect(screen.queryByTestId("yolo-session-indicator")).toBeNull();
  });

  it("renders on every session when unscoped, marked as such", () => {
    setSession({ ...scopedSession(NOW), unscoped: true });
    renderAt(<YoloSessionIndicator cwd="/anywhere/at/all" />);
    const el = screen.getByTestId("yolo-session-indicator");
    expect(el.dataset.scope).toBe("unscoped");
    expect(el.textContent).toMatch(/everywhere/i);
  });
});

describe("no indicator can be dismissed (10.72)", () => {
  it.each([
    ["pill", () => <YoloPill />, "yolo-pill"],
    ["session indicator", () => <YoloSessionIndicator cwd="/repo" />, "yolo-session-indicator"],
  ])("%s: no dismiss control; Escape, click and blur leave it rendered", (_n, ui, id) => {
    setSession(scopedSession(NOW, "/repo"));
    renderAt(ui());
    const el = screen.getByTestId(id);
    expect(el.querySelector("button")).toBeNull();
    fireEvent.keyDown(el, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(el);
    fireEvent.blur(el);
    expect(screen.getByTestId(id)).toBeTruthy();
  });
});
