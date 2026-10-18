/**
 * Active-YOLO signals (changes: add-access-grant-dialog 8b.7 / fix-yolo-indicator-overflow;
 * test-plan #E9-#E14, #F1-#F7).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { YoloSessionView } from "../../../lib/access-grants/access-prompts-types.js";
import { yoloStatus } from "../../../lib/access-grants/yolo-status.js";
import { useYoloAppBar, YoloBarLink, YoloComposerStrip, yoloTone } from "../YoloIndicators.js";
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
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
  server = installFakeYoloServer({ now: NOW });
  setSession(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Bar consumer: applies `useYoloAppBar` props to a div, like SessionList does. */
function Bar() {
  const props = useYoloAppBar();
  return (
    <div {...props} data-testid="bar">
      <YoloBarLink />
    </div>
  );
}

const unscopedSession = (): YoloSessionView => ({ ...scopedSession(NOW), unscoped: true });
const foreverSession = (unscoped = false): YoloSessionView => ({
  ...(unscoped ? unscopedSession() : scopedSession(NOW, "/repo")),
  source: "env",
  expiresAt: null,
});
const strip = () => screen.getByTestId("yolo-composer-strip");
const stripLink = () => strip().querySelector("a") as HTMLAnchorElement;
const stripTime = () => strip().lastElementChild as HTMLElement;

describe("YoloComposerStrip structure (E9, E10)", () => {
  it("E10: wrapper, strip classes, link holds shield + truncating sentence, time is a sibling of the link", () => {
    for (const [session, scope] of [
      [scopedSession(NOW, "/repo"), "scoped"],
      [unscopedSession(), "unscoped"],
    ] as const) {
      setSession(session);
      renderAt(<YoloComposerStrip cwd="/repo/pkg" />);
      const el = strip();
      expect(el.parentElement?.className).toBe("shrink-0 px-3 pt-2");
      expect(el.dataset.scope).toBe(scope);
      for (const c of ["flex", "w-full", "min-w-0", "whitespace-nowrap", "overflow-hidden"]) {
        expect(el.className.split(/\s+/)).toContain(c);
      }
      const link = stripLink();
      expect(link.getAttribute("href")).toBe("/settings/access");
      expect(link.querySelector("svg")).toBeTruthy();
      const sentence = link.querySelector("span.truncate.min-w-0");
      expect(sentence?.textContent).toMatch(/YOLO/);
      expect(link.contains(stripTime())).toBe(false);
      expect(stripTime().parentElement).toBe(el);
      cleanup();
    }
  });

  it("E9: time text across ticks, node is shrink-0 tabular-nums", () => {
    setSession({ ...scopedSession(NOW, "/repo"), expiresAt: NOW + 60 * 60_000 });
    renderAt(<YoloComposerStrip cwd="/repo" />);
    expect(stripTime().textContent).toBe("1:00:00");
    expect(stripTime().className).toContain("shrink-0");
    expect(stripTime().className).toContain("tabular-nums");
    act(() => vi.advanceTimersByTime(1000));
    expect(stripTime().textContent).toBe("59:59");
    act(() => vi.advanceTimersByTime(59 * 60_000 + 58_000));
    expect(stripTime().textContent).toBe("0:01");
  });
});

describe("coverage copy selection (E11, E12, E13)", () => {
  it.each([
    ["scoped", scopedSession(NOW, "/repo"), "agent and dashboard file access in its folders", false],
    ["unscoped", unscopedSession(), "every folder", false],
    ["scoped forever", foreverSession(false), "until the server stops", true],
    ["unscoped forever", foreverSession(true), "everywhere until the server stops", true],
  ])("E11 %s: bar title, bar link, strip sentence and title agree", (_n, session, needle, forever) => {
    setSession(session);
    renderAt(
      <>
        <Bar />
        <YoloComposerStrip cwd="/repo" />
      </>,
    );
    const title = screen.getByTestId("bar").getAttribute("title") ?? "";
    expect(title).toContain(needle);
    expect(title).toMatch(/Open Access to end it\./);
    expect(screen.getByTestId("yolo-bar-link").textContent).toBe(title);
    expect(strip().querySelector("span.truncate")?.textContent).toBe(title);
    expect(stripLink().getAttribute("title")).toBe(title);
    if (forever) {
      const marker = stripTime().querySelector("[aria-hidden='true']");
      expect(marker?.textContent).toBe("\u221e");
      expect(stripTime().querySelector(".sr-only")?.textContent).toBe("no expiry");
    } else {
      expect(stripTime().querySelector("[aria-hidden]")).toBeNull();
      expect(stripTime().textContent).toMatch(/^\d+:\d\d/);
    }
  });

  it("E12: unscoped carries the heavy warning tone, scoped does not; both warning, never error", () => {
    setSession(scopedSession(NOW, "/repo"));
    renderAt(<YoloComposerStrip cwd="/repo" />);
    const scoped = strip();
    expect(scoped.className).toContain(yoloTone(false));
    expect(scoped.className).not.toContain("font-bold");
    expect(scoped.className).toContain("--severity-warning-");
    expect(strip().textContent).not.toContain("\u221e");
    cleanup();
    setSession(unscopedSession());
    renderAt(<YoloComposerStrip cwd="/x" />);
    expect(strip().className).toContain(yoloTone(true));
    expect(strip().className).toContain("border-2 ");
    expect(strip().className).toContain("font-bold");
    expect(strip().className).not.toContain("severity-error");
    expect(strip().dataset.scope).toBe("unscoped");
    expect(strip().textContent).not.toContain("\u221e");
  });

  it("E13: sentence names the agent and the dashboard, only unscoped says every folder, no time in it", () => {
    for (const [session, every] of [
      [scopedSession(NOW, "/repo"), false],
      [unscopedSession(), true],
    ] as const) {
      setSession(session);
      renderAt(<YoloComposerStrip cwd="/repo" />);
      const text = strip().querySelector("span.truncate")?.textContent ?? "";
      expect(text).toMatch(/agent/);
      expect(text).toMatch(/dashboard/);
      expect(/every folder/.test(text)).toBe(every);
      expect(text).not.toMatch(/\d+:\d\d/);
      cleanup();
    }
  });
});

describe("i18n catalogue (E14)", () => {
  const i18nDir = resolve(__dirname, "../../../lib/i18n");
  const repoRoot = resolve(__dirname, "../../../../../..");
  const deleted = ["yolo.pill", "yolo.pillUnscoped", "yolo.pillTitle", "yolo.pillTitleUnscoped", "yolo.sessionScoped", "yolo.sessionUnscoped"];
  const added = ["yolo.coverage", "yolo.coverageUnscoped", "yolo.coverageForever", "yolo.coverageUnscopedForever", "yolo.noExpiry"];

  it.each(["i18n-hu.ts", "i18n-zh-CN.ts"])("%s has the new keys, not the deleted ones, keeps yolo.left", (file) => {
    const src = readFileSync(resolve(i18nDir, file), "utf8");
    for (const k of added) expect(src).toContain(`"${k}":`);
    for (const k of deleted) expect(src).not.toContain(`"${k}":`);
    expect(src).toContain('"yolo.left":');
    expect(src).toContain('"yolo.untilServerStops":');
  });

  it("npm run i18n:parity (scripts/i18n-parity.mjs) exits 0", () => {
    expect(() => execFileSync("node", ["scripts/i18n-parity.mjs"], { cwd: repoRoot, stdio: "pipe" })).not.toThrow();
  });

  it("the component source no longer references the deleted keys", () => {
    const src = readFileSync(resolve(__dirname, "../YoloIndicators.tsx"), "utf8");
    for (const k of deleted) expect(src).not.toContain(`"${k}"`);
    for (const k of added) expect(src).toContain(`"${k}"`);
  });
});

describe("strip gating (F5) and bar hook", () => {
  it("is absent when no session is active", () => {
    renderAt(
      <>
        <Bar />
        <YoloComposerStrip cwd="/repo" />
      </>,
    );
    expect(screen.queryByTestId("yolo-composer-strip")).toBeNull();
    expect(screen.queryByTestId("yolo-bar-link")).toBeNull();
    const bar = screen.getByTestId("bar");
    expect(bar.getAttribute("title")).toBeNull();
    expect(bar.dataset.yolo).toBeUndefined();
  });

  it("F5: out-of-scope cwd (component-wise) has no strip, bar still tinted", () => {
    setSession(scopedSession(NOW, "/repo"));
    renderAt(
      <>
        <Bar />
        <YoloComposerStrip cwd="/repo-secrets" />
      </>,
    );
    expect(screen.queryByTestId("yolo-composer-strip")).toBeNull();
    expect(screen.getByTestId("bar").dataset.yolo).toBe("scoped");
    expect(screen.getByTestId("bar").className).toContain("--severity-warning-bg");
    expect(screen.getByTestId("bar").className).toContain("inset_0_-2px_0_var(--accent-orange-text)");
  });

  it("F4: scoped republished unscoped flips sentence, data attributes and tone", () => {
    setSession(scopedSession(NOW, "/repo"));
    renderAt(
      <>
        <Bar />
        <YoloComposerStrip cwd="/repo" />
      </>,
    );
    const scopedSentence = strip().querySelector("span.truncate")?.textContent;
    expect(scopedSentence).not.toMatch(/every folder/);
    act(() => setSession({ ...scopedSession(NOW, "/repo"), unscoped: true }));
    expect(strip().querySelector("span.truncate")?.textContent).toMatch(/every folder/);
    expect(strip().dataset.scope).toBe("unscoped");
    expect(screen.getByTestId("bar").dataset.yolo).toBe("unscoped");
    expect(strip().className).toContain("font-bold");
    expect(screen.getByTestId("bar").getAttribute("title")).toMatch(/everywhere/);
  });
});

describe("no live region, static names (F1, F2)", () => {
  it("F1: no live-region role or aria-live anywhere", () => {
    setSession(scopedSession(NOW, "/repo"));
    renderAt(
      <>
        <Bar />
        <YoloComposerStrip cwd="/repo" />
      </>,
    );
    for (const el of document.body.querySelectorAll("*")) {
      expect(["status", "alert", "log", "timer", "marquee"]).not.toContain(el.getAttribute("role"));
      const live = el.getAttribute("aria-live");
      expect(live === null || live === "off").toBe(true);
    }
  });

  it("F2: ticking changes only the time; names and titles stay byte-identical", () => {
    setSession(scopedSession(NOW, "/repo"));
    renderAt(
      <>
        <Bar />
        <YoloComposerStrip cwd="/repo" />
      </>,
    );
    const snap = () => ({
      barTitle: screen.getByTestId("bar").getAttribute("title"),
      barLink: screen.getByTestId("yolo-bar-link").textContent,
      stripLink: stripLink().textContent,
      stripTitle: stripLink().getAttribute("title"),
      time: stripTime().textContent,
    });
    const before = snap();
    act(() => vi.advanceTimersByTime(1000));
    const after = snap();
    expect(after.time).not.toBe(before.time);
    expect({ ...after, time: "" }).toEqual({ ...before, time: "" });
    expect(after.stripLink).not.toMatch(/\d+:\d\d/);
  });
});

describe("expiry (F3) and not dismissible (F6)", () => {
  it("F3: bar untints via a single timeout; link and strip unmount at expiry", () => {
    setSession(scopedSession(NOW, "/repo"));
    renderAt(
      <>
        <Bar />
        <YoloComposerStrip cwd="/repo" />
      </>,
    );
    expect(screen.getByTestId("bar").dataset.yolo).toBe("scoped");
    act(() => vi.advanceTimersByTime(15 * 60_000));
    const bar = screen.getByTestId("bar");
    expect(bar.dataset.yolo).toBeUndefined();
    expect(bar.getAttribute("title")).toBeNull();
    expect(bar.className).toBe("");
    expect(screen.queryByTestId("yolo-bar-link")).toBeNull();
    expect(screen.queryByTestId("yolo-composer-strip")).toBeNull();
  });

  it("F6: no dismiss control; Escape, click outside the link and blur leave every signal rendered", () => {
    setSession(scopedSession(NOW, "/repo"));
    renderAt(
      <>
        <Bar />
        <YoloComposerStrip cwd="/repo" />
      </>,
    );
    expect(document.body.querySelector("button")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("bar"));
    fireEvent.click(strip());
    fireEvent.blur(stripLink());
    expect(screen.getByTestId("bar").dataset.yolo).toBe("scoped");
    expect(screen.getByTestId("yolo-bar-link")).toBeTruthy();
    expect(strip()).toBeTruthy();
  });

  it("the bar carries no click handler: a background click does not navigate", () => {
    setSession(scopedSession(NOW, "/repo"));
    const loc = renderAt(<Bar />);
    fireEvent.click(screen.getByTestId("bar"));
    expect(loc.history?.at(-1)).toBe("/");
  });

  it("the bar link is out of flow and invisible until focused, but stays in the a11y tree", () => {
    setSession(scopedSession(NOW, "/repo"));
    renderAt(<Bar />);
    const cls = screen.getByTestId("yolo-bar-link").className.split(/\s+/);
    for (const c of ["absolute", "opacity-0", "pointer-events-none", "focus:opacity-100", "focus:pointer-events-auto", "top-full"]) {
      expect(cls).toContain(c);
    }
    expect(cls).not.toContain("sr-only");
    expect(screen.getByTestId("bar").firstElementChild).toBe(screen.getByTestId("yolo-bar-link"));
  });
});

describe("click handling (F7)", () => {
  const cases: [string, MouseEventInit, boolean][] = [
    ["primary", { button: 0 }, true],
    ["middle", { button: 1 }, false],
    ["meta", { button: 0, metaKey: true }, false],
    ["ctrl", { button: 0, ctrlKey: true }, false],
    ["shift", { button: 0, shiftKey: true }, false],
    ["alt", { button: 0, altKey: true }, false],
  ];
  it.each(cases)("%s click on bar link and strip link: SPA nav only when plain primary", (_n, init, spa) => {
    setSession(scopedSession(NOW, "/repo"));
    const loc = renderAt(
      <>
        <Bar />
        <YoloComposerStrip cwd="/repo" />
      </>,
    );
    for (const link of [screen.getByTestId("yolo-bar-link"), stripLink()]) {
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
      act(() => {
        link.dispatchEvent(ev);
      });
      expect(ev.defaultPrevented).toBe(spa);
      expect(loc.history?.at(-1)).toBe(spa ? "/settings/access" : "/");
      loc.navigate("/", { replace: true });
    }
  });

  it("a click on the time does not navigate (it is outside the link)", () => {
    setSession(scopedSession(NOW, "/repo"));
    const loc = renderAt(<YoloComposerStrip cwd="/repo" />);
    fireEvent.click(stripTime());
    expect(loc.history?.at(-1)).toBe("/");
  });
});
