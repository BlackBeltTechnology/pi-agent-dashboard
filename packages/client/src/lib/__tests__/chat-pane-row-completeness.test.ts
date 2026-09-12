import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_PANE_ROW_TABLE } from "../layout/chat-pane-row-class.js";

/**
 * Task 2.2 / Test-Plan #E2: Classification completeness.
 *
 * Assert that every row App.tsx renders into `SessionSplitView`'s `chat` prop
 * (including every conditional row: content-header-sticky, error-boundary fallback,
 * session-banner, composer-context-strip, status-bar, queue-panel, composer-root,
 * content-inline-footer) appears in CHAT_PANE_ROW_TABLE exactly once as
 * either `shrinkable` or `fixed`.
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
      "composer-context-strip",
      "status-bar",
      "queue-panel",
      "composer-root",
      "content-inline-footer",
    ];

    // Verify all expected rows exist in App.tsx (or in the component it renders)
    expect(appSource).toContain("ContentHeaderStickySlot");
    expect(appSource).toContain("<ChatView");
    expect(appSource).toContain("ErrorBoundary");
    expect(appSource).toContain("<SessionBanner");
    expect(appSource).toContain('data-testid="composer-context-strip"');
    expect(appSource).toContain("<StatusBar");
    expect(appSource).toContain("<QueuePanel");
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
