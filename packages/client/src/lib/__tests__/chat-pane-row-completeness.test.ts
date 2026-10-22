import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_PANE_ROW_TABLE, COLLAPSED_BAR_PX, YOLO_FOOTER_HEIGHT } from "../layout/chat-pane-row-class.js";

/**
 * Task 2.2 / Test-Plan #E2: Classification completeness.
 *
 * Assert that every row App.tsx renders into `SessionSplitView`'s `chat` prop
 * (including every conditional row: content-header-sticky, error-boundary fallback,
 * session-banner, composer-dock, composer-root, content-inline-footer) appears in CHAT_PANE_ROW_TABLE exactly once as
 * either `shrinkable` or `fixed`.
 *
 * @structural-pin a row table must cover every row App.tsx renders; App.tsx cannot be mounted in a unit test
 */
describe("chat-pane row classification completeness (L1, #E2)", () => {
  it("classifies every row rendered in App.tsx chat slot exactly once", () => {
    // Read App.tsx to verify the rows that are present in the source.
    const appPath = path.resolve(__dirname, "../../App.tsx");
    const appSource = fs.readFileSync(appPath, "utf-8");

    // The known rows rendered into the chat pane in App.tsx:
    const expectedRows = [
      "content-header-sticky",
      "chat-view",
      "error-boundary-fallback",
      "session-banner",
      "composer-stack-anchor",
      "composer-dock",
      "composer-dock:footer-only",
      "composer-dock:collapsed",
      "composer-dock:collapsed-yolo",
      "composer-root",
      "content-inline-footer",
    ];

    // Verify all expected rows exist in App.tsx (or in the component it renders)
    expect(appSource).toContain("ContentHeaderStickySlot");
    expect(appSource).toContain("<ChatView");
    expect(appSource).toContain("ErrorBoundary");
    expect(appSource).toContain("<SessionBanner");
    expect(appSource).toContain('data-testid="composer-stack-anchor"');
    expect(appSource).toContain("<ComposerDock");
    expect(appSource).toContain("<CommandInput");
    expect(appSource).toContain("ContentInlineFooterSlot");

    // Assert each expected row is in CHAT_PANE_ROW_TABLE exactly once
    const tableKeys = Object.keys(CHAT_PANE_ROW_TABLE);
    expect(new Set(tableKeys).size).toBe(tableKeys.length); // no duplicates

    for (const row of expectedRows) {
      expect(
        CHAT_PANE_ROW_TABLE,
        `Row '${row}' rendered in App.tsx must be in CHAT_PANE_ROW_TABLE`,
      ).toHaveProperty(row);
      const spec = CHAT_PANE_ROW_TABLE[row];
      expect(["shrinkable", "fixed"]).toContain(spec.rowClass);
    }

    // And assert no unknown rows exist in the table that aren't expected
    for (const key of tableKeys) {
      expect(
        expectedRows,
        `Table entry '${key}' must correspond to a row rendered in App.tsx`,
      ).toContain(key);
    }
  });
});

/**
 * Test-plan #F14: the composer dock's two static shrinkable shapes keep the
 * footer from ever being clipped (floor strictly above bound, with or without
 * lanes). See change: add-composer-dock (D10).
 */
describe("composer dock row entries (L1, #F14)", () => {
  it("every shrinkable entry has floor > bound (the dock's included)", () => {
    for (const [key, spec] of Object.entries(CHAT_PANE_ROW_TABLE)) {
      if (spec.rowClass !== "shrinkable") continue;
      expect(spec.floor, `${key}: floor must exceed bound`).toBeGreaterThan(spec.bound);
    }
  });

  it("declares composer-dock and composer-dock:footer-only as shrinkable", () => {
    expect(CHAT_PANE_ROW_TABLE["composer-dock"]?.rowClass).toBe("shrinkable");
    expect(CHAT_PANE_ROW_TABLE["composer-dock:footer-only"]?.rowClass).toBe("shrinkable");
  });

  it("composer-dock: bound = YOLO footer height, floor = bound + 41, weight 1", () => {
    expect(CHAT_PANE_ROW_TABLE["composer-dock"]).toEqual({
      rowClass: "shrinkable",
      floor: YOLO_FOOTER_HEIGHT + 41,
      bound: YOLO_FOOTER_HEIGHT,
      weight: 1,
    });
  });

  it("composer-dock:footer-only: bound == YOLO_FOOTER_HEIGHT, floor = bound + 1", () => {
    const spec = CHAT_PANE_ROW_TABLE["composer-dock:footer-only"];
    expect(spec).toMatchObject({ rowClass: "shrinkable", bound: YOLO_FOOTER_HEIGHT, floor: YOLO_FOOTER_HEIGHT + 1 });
  });

  // test-plan #E9 — See change: composer-dock-collapse-and-file-open.
  it("collapsed entries: shrinkable, bound = bar (+ YOLO footer), floor = bound + 1", () => {
    expect(COLLAPSED_BAR_PX).toBe(44);
    expect(CHAT_PANE_ROW_TABLE["composer-dock:collapsed"]).toEqual({
      rowClass: "shrinkable",
      floor: COLLAPSED_BAR_PX + 1,
      bound: COLLAPSED_BAR_PX,
      weight: 1,
    });
    expect(CHAT_PANE_ROW_TABLE["composer-dock:collapsed-yolo"]).toEqual({
      rowClass: "shrinkable",
      floor: COLLAPSED_BAR_PX + YOLO_FOOTER_HEIGHT + 1,
      bound: COLLAPSED_BAR_PX + YOLO_FOOTER_HEIGHT,
      weight: 1,
    });
  });

  it("the footer's fixed height is the h-8 line (32px) and the legacy fixed rows are gone", () => {
    expect(YOLO_FOOTER_HEIGHT).toBe(32);
    for (const gone of ["composer-context-strip", "status-bar", "queue-panel"]) {
      expect(CHAT_PANE_ROW_TABLE).not.toHaveProperty(gone);
    }
  });
});
