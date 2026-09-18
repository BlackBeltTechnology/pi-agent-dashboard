/**
 * Regression coverage for change: fix-long-session-ux-degradation (§1,
 * capability `drag-body-style`, design D1; test-plan rows E1–E7).
 *
 * The resize surfaces used to set `document.body.style.cursor` +
 * `userSelect: none` on mousedown and clear them only in the mouseup handler.
 * Unmounting mid-drag (breakpoint flip, collapse, session switch) or losing the
 * mouseup (released outside the window) left the page permanently
 * `user-select: none` — text could no longer be selected or copied.
 *
 * The hook-scoped contract: styles clear on `endBodyDrag()` AND on unmount,
 * both guarded by a private `active` ref, so an idle instance never clears a
 * concurrent drag's styles and never touches a value it did not set.
 *
 * Glue mirrors `hooks/__tests__/useAppHidden.test.ts` (hook under test) and
 * `hooks/__tests__/effect-cleanup-contract.test.tsx` (unmount cleanup).
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useBodyDragStyle } from "../useBodyDragStyle.js";

afterEach(() => {
  cleanup();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

function strictWrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

describe("useBodyDragStyle (drag-body-style, D1)", () => {
  // E1 — drag start applies the overrides.
  it("E1: beginBodyDrag applies cursor + userSelect:none", () => {
    const { result } = renderHook(() => useBodyDragStyle());

    act(() => result.current.beginBodyDrag("col-resize"));

    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
  });

  // E2 — drag end restores selection and cursor.
  it("E2: endBodyDrag clears both overrides", () => {
    const { result } = renderHook(() => useBodyDragStyle());

    act(() => result.current.beginBodyDrag("col-resize"));
    act(() => result.current.endBodyDrag());

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    // The document is selectable again (computed style no longer suppresses it).
    expect(getComputedStyle(document.body).userSelect).not.toBe("none");
  });

  // E3 — affordance disappears mid-drag.
  it("E3: unmount mid-drag clears both overrides and leaves the document selectable", () => {
    const { result, unmount } = renderHook(() => useBodyDragStyle());
    act(() => result.current.beginBodyDrag("col-resize"));
    expect(document.body.style.userSelect).toBe("none");

    unmount();

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    expect(getComputedStyle(document.body).userSelect).not.toBe("none");
  });

  // E4 — idle affordance removal touches nothing.
  it("E4: idle unmount leaves a value the hook never set untouched", () => {
    document.body.style.cursor = "crosshair";

    const { unmount } = renderHook(() => useBodyDragStyle());
    unmount();

    expect(document.body.style.cursor).toBe("crosshair");
  });

  // E5 — one affordance's removal does not disrupt another's active drag.
  it("E5: unmounting an idle instance leaves a concurrent drag's overrides applied", () => {
    const active = renderHook(() => useBodyDragStyle());
    act(() => active.result.current.beginBodyDrag("col-resize"));

    const idle = renderHook(() => useBodyDragStyle());
    idle.unmount();

    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    act(() => active.result.current.endBodyDrag());
    expect(document.body.style.cursor).toBe("");
  });

  // E6 — StrictMode's double mount/unmount is harmless.
  it("E6: under StrictMode the discarded mount fires no clear and the drag still applies", () => {
    // Pre-set a value the hook never owns: a clear fired by StrictMode's
    // discarded first mount would wipe it.
    document.body.style.cursor = "crosshair";

    const { result, unmount } = renderHook(() => useBodyDragStyle(), {
      wrapper: strictWrapper,
    });

    // The discarded mount's cleanup must not have cleared anything.
    expect(document.body.style.cursor).toBe("crosshair");

    act(() => result.current.beginBodyDrag("col-resize"));
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    unmount();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  // E7 — endBodyDrag idempotent.
  it("E7: endBodyDrag twice is a no-op and never mutates an untouched body", () => {
    const { result } = renderHook(() => useBodyDragStyle());

    act(() => {
      result.current.endBodyDrag();
      result.current.endBodyDrag();
    });

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    // Never-began instance with a pre-set value: two idle `end` calls leave it
    // exactly as it was.
    document.body.style.cursor = "crosshair";
    const idle = renderHook(() => useBodyDragStyle());
    act(() => {
      idle.result.current.endBodyDrag();
      idle.result.current.endBodyDrag();
    });
    expect(document.body.style.cursor).toBe("crosshair");
  });
});
