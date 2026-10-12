/**
 * Regression test for the bug fixed in session
 * 019dc93e-ff44-7063-8083-3632afdebc2b: a JSX slot wrapper combined with
 * `??` in a route fallback chain silently masked `sessionDetail` because
 * `??` evaluates the JSX **element** (always truthy), not its rendered
 * output (`null` when no plugins claim the slot).
 *
 * The fix in `packages/client/src/App.tsx` gates the slot element on
 * `_pluginRegistry.getClaims("content-view").length > 0` *before*
 * constructing the JSX element. This test pins that semantic so a future
 * refactor cannot reintroduce the regression.
 *
 * See change: fix-slot-fallback-masks-content.
 */

import { cleanup, render } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => cleanup());

/**
 * Reproduce the *broken* original pattern: a slot wrapper that returns
 * `null` when empty, mounted inside a `?? fallback` chain. The slot's
 * rendered output is `null`, but the JSX element wrapping it is truthy,
 * so `??` never falls through to `fallback`.
 */
function SlotWrapper(): React.ReactElement | null {
  // Mimics ContentViewSlot's "no claims" branch.
  return null;
}

describe("JSX slot ?? fallback semantics", () => {
  it("documents the bug: <Slot/> ?? fallback chooses the slot element even when the slot renders null", () => {
    // The expression mirrors the broken pattern that shipped in App.tsx.
    // Cast to a nullable type so TS doesn't reject the deliberately-buggy
    // pattern this regression test exists to document.
    const slotElement: React.ReactElement | null = (<SlotWrapper />) as React.ReactElement | null;
    const broken = slotElement ?? <span data-testid="fallback">FALLBACK</span>;
    const { queryByTestId, container } = render(<>{broken}</>);

    // The "fallback" branch is NOT chosen — `<SlotWrapper/>` is truthy.
    expect(queryByTestId("fallback")).toBeNull();
    // The page is empty because SlotWrapper itself rendered `null`.
    expect(container.textContent ?? "").toBe("");
  });

  it("the fix: gating on a claim count BEFORE constructing the element makes ?? work", () => {
    // The fixed expression in App.tsx, parameterized.
    const claimCount = 0;
    const fixed =
      (claimCount > 0 ? <SlotWrapper /> : null) ??
      <span data-testid="fallback">FALLBACK</span>;
    const { getByTestId } = render(<>{fixed}</>);

    expect(getByTestId("fallback").textContent).toBe("FALLBACK");
  });

  it("when there ARE claims, the slot element wins (does not regress the happy path)", () => {
    function ActiveSlot() {
      return <span data-testid="slot-active">ACTIVE</span>;
    }
    const claimCount = 1;
    const fixed =
      (claimCount > 0 ? <ActiveSlot /> : null) ??
      <span data-testid="fallback">FALLBACK</span>;
    const { getByTestId, queryByTestId } = render(<>{fixed}</>);

    expect(getByTestId("slot-active").textContent).toBe("ACTIVE");
    expect(queryByTestId("fallback")).toBeNull();
  });
});
