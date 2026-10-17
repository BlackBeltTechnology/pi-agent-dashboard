/**
 * Side placement of the session actions flyout (pure compute).
 * See change: add-session-actions-flyout (test-plan F12).
 */
import { describe, expect, it } from "vitest";
import { computeSideFlyoutPosition, FLYOUT_GAP, FLYOUT_MARGIN } from "../useSideFlyoutPosition.js";

const VIEW = { width: 1000, height: 700 };
const card = (over: Partial<{ left: number; top: number; right: number; bottom: number }> = {}) => ({ left: 20, top: 100, right: 320, bottom: 180, ...over });
const PANEL = { width: 240, height: 300 };

describe("computeSideFlyoutPosition (anchor mode)", () => {
  it("room on the right: left = card.right + 8, top = card.top", () => {
    const p = computeSideFlyoutPosition(card(), PANEL, VIEW);
    expect(p.left).toBe(320 + FLYOUT_GAP);
    expect(p.top).toBe(100);
  });

  it("bottom near the viewport: the panel's bottom clamps to viewport − 8", () => {
    const p = computeSideFlyoutPosition(card({ top: 600, bottom: 680 }), PANEL, VIEW);
    expect(p.top + PANEL.height).toBe(VIEW.height - FLYOUT_MARGIN);
  });

  it("no room on the right: clamps to the viewport's right edge − 8 (overlapping the card)", () => {
    const p = computeSideFlyoutPosition(card({ right: 900, left: 700 }), PANEL, VIEW);
    expect(p.left + PANEL.width).toBe(VIEW.width - FLYOUT_MARGIN);
    expect(p.left).toBeLessThan(900); // overlaps the card rather than leaving the viewport
  });

  it("caps maxHeight to the available viewport space", () => {
    expect(computeSideFlyoutPosition(card(), PANEL, VIEW).maxHeight).toBe(VIEW.height - 2 * FLYOUT_MARGIN);
    // a taller-than-viewport panel is clamped, never pushed off the top
    const tall = computeSideFlyoutPosition(card({ top: 500 }), { width: 240, height: 2000 }, VIEW);
    expect(tall.top).toBe(FLYOUT_MARGIN);
  });
});

describe("computeSideFlyoutPosition (point mode)", () => {
  it("re-applies the open-time pointer offset to the card's CURRENT rect", () => {
    const offset = { dx: 150 - 20, dy: 440 - 400 }; // pointer (150, 440) over a card at (20, 400)
    const small = { width: 240, height: 200 };
    const first = computeSideFlyoutPosition({ left: 20, top: 400, right: 320, bottom: 480 }, small, VIEW, offset);
    expect([first.left, first.top]).toEqual([150, 440]);
    // the sidebar scrolled 60 px: the card moved up, the menu follows
    const scrolled = computeSideFlyoutPosition({ left: 20, top: 340, right: 320, bottom: 420 }, small, VIEW, offset);
    expect([scrolled.left, scrolled.top]).toEqual([150, 380]);
  });

  it("clamps inside the viewport", () => {
    const p = computeSideFlyoutPosition(card(), PANEL, VIEW, { dx: 2000, dy: 2000 });
    expect(p.left + PANEL.width).toBe(VIEW.width - FLYOUT_MARGIN);
    expect(p.top + PANEL.height).toBe(VIEW.height - FLYOUT_MARGIN);
  });
});
