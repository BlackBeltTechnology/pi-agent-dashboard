/**
 * useWebLinkOpen — routing table (test-plan #E23).
 *  - loopback + plain click → `openLiveTarget` (any context, as before);
 *  - non-loopback http(s) + plain click + same session as the split workspace →
 *    `openUrlTarget(url, {opener:"operator-click"})` + `preventDefault`;
 *  - every other combination → no call, no `preventDefault` (native `target="_blank"`).
 * See changes: open-loopback-links-in-split-viewer, rich-chat-links (design D7).
 */
import { renderHook } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWebLinkOpen } from "../use-web-link-open.js";

// vi.hoisted so the mock (also hoisted) can reference the spies without a TDZ.
// `box.ctx` is mutable so a test can flip the context to null.
const { openLiveTarget, openUrlTarget, box } = vi.hoisted(() => {
  const openLiveTarget = vi.fn();
  const openUrlTarget = vi.fn();
  return {
    openLiveTarget,
    openUrlTarget,
    box: {
      ctx: { sessionId: "pane-session", openLiveTarget, openUrlTarget } as {
        sessionId: string;
        openLiveTarget: typeof openLiveTarget;
        openUrlTarget: typeof openUrlTarget;
      } | null,
    },
  };
});

vi.mock("../../components/split/SplitWorkspaceContext.js", () => ({
  useOptionalSplitWorkspace: () => box.ctx,
}));

function evt(over: Partial<React.MouseEvent> = {}): React.MouseEvent {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...over,
  } as unknown as React.MouseEvent;
}

const CTX = { sessionId: "pane-session", openLiveTarget, openUrlTarget };
afterEach(() => {
  openLiveTarget.mockClear();
  openUrlTarget.mockClear();
  box.ctx = { ...CTX };
});

const CLICKS: Record<string, Partial<React.MouseEvent>> = {
  plain: {},
  meta: { metaKey: true },
  ctrl: { ctrlKey: true },
  shift: { shiftKey: true },
  alt: { altKey: true },
  middle: { button: 1 },
};
const SESSIONS: Record<string, string | undefined> = { same: "pane-session", other: "other-session", none: undefined };
const HREFS = [
  "https://example.com/d",
  "http://localhost:5173/x",
  "http://localhost@evil.com/",
  "http://192.168.1.20:50452/b.html",
  "mailto:x",
] as const;

type Expected = "live" | "url" | "none";
function expected(href: string, session: string, click: string): Expected {
  if (click !== "plain") return "none";
  if (href === "http://localhost:5173/x") return "live"; // loopback: any context, as today
  if (href === "mailto:x") return "none";
  return session === "same" ? "url" : "none";
}

describe("useWebLinkOpen routing table (#E23)", () => {
  for (const href of HREFS) {
    for (const session of Object.keys(SESSIONS)) {
      for (const click of Object.keys(CLICKS)) {
        const want = expected(href, session, click);
        it(`${href} × session ${session} × ${click} click → ${want}`, () => {
          const { result } = renderHook(() => useWebLinkOpen({ sessionId: SESSIONS[session] }));
          const e = evt(CLICKS[click]);
          result.current(e, href);
          if (want === "live") {
            expect(openLiveTarget).toHaveBeenCalledWith(href);
            expect(openUrlTarget).not.toHaveBeenCalled();
            expect(e.preventDefault).toHaveBeenCalled();
          } else if (want === "url") {
            expect(openUrlTarget).toHaveBeenCalledWith(href, { opener: "operator-click" });
            expect(openLiveTarget).not.toHaveBeenCalled();
            expect(e.preventDefault).toHaveBeenCalled();
          } else {
            expect(openLiveTarget).not.toHaveBeenCalled();
            expect(openUrlTarget).not.toHaveBeenCalled();
            expect(e.preventDefault).not.toHaveBeenCalled();
          }
        });
      }
    }
  }

  it("no link context (undefined) never opens a non-loopback URL in the pane", () => {
    const { result } = renderHook(() => useWebLinkOpen(undefined));
    const e = evt();
    result.current(e, "https://example.com/d");
    expect(openUrlTarget).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("loopback still routes with no link context (as before)", () => {
    const { result } = renderHook(() => useWebLinkOpen(undefined));
    result.current(evt(), "http://localhost:50452/report.html");
    expect(openLiveTarget).toHaveBeenCalledWith("http://localhost:50452/report.html");
  });

  it("null split context no-ops without throwing", () => {
    box.ctx = null;
    const { result } = renderHook(() => useWebLinkOpen({ sessionId: "pane-session" }));
    const e = evt();
    expect(() => result.current(e, "https://example.com/d")).not.toThrow();
    expect(() => result.current(e, "http://localhost:50452/x")).not.toThrow();
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(openLiveTarget).not.toHaveBeenCalled();
    expect(openUrlTarget).not.toHaveBeenCalled();
  });
});
