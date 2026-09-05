/**
 * Behaviour-preservation census for the fixed-tick conversion (F2).
 *
 * The 10 client test files converted from fixed-tick barriers to `waitFor`
 * must keep exactly the tests they had at the merge base: same ids, same
 * count, in the same order — no assertion quietly added, renamed, or dropped
 * by the mechanical conversion. The census below is the merge-base snapshot;
 * this test fails the moment a conversion (or anything after it) alters a
 * test's identity in those files.
 *
 * If you are ADDING a test to one of these files on purpose, update the
 * census in the same commit — a visible, reviewed change, exactly like the
 * wording-locked description digests in the skill-frontmatter guard.
 *
 * See change: make-test-suite-deterministic (test-plan F2).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** file (relative to client src) → test ids in declaration order, at merge base. */
const CENSUS: Record<string, string[]> = {
  "hooks/__tests__/useImagePaste.test.ts": [
    "starts with empty pendingImages and null error",
    "appends a pasted PNG to pendingImages",
    "rejects unsupported mime with a transient error",
    "removeImage removes by index",
    // Added by this change — test-plan F1: convergence must come from polling
    // even when decode lands later than any fixed tick count.
    "converges when decode lands later than any fixed tick count (F1)",
    "clearImages empties the list and clears errors",
    "uses caller-owned `images` as the source of truth",
    "routes paste through onImagesChange (caller owns array)",
    "removeImage in controlled mode emits the new array via onImagesChange",
    "clearImages in controlled mode emits an empty array",
    "does NOT mutate local state when controlled",
  ],
  "components/__tests__/WorktreeActionsMenu.test.tsx": [
    "renders all four action buttons for a worktree session when gh is available",
    "hides the PR button when gh is NOT resolvable (no existing PR)",
    "still shows 'View PR' button when gh missing but gitPrNumber is set",
    "does not render for a session without gitWorktree",
    "Open PR toggles to 'View PR #N' label when gitPrNumber is set",
    "clicking 'Merge' opens the merge confirm dialog",
    "clicking 'Close' opens the close-worktree dialog",
    "Push action shows a success toast on ok response",
    "PR failure shows human-readable label + stderr in <details>",
    "flips the mobile sheet to left-0 when the pane's right anchor cannot fit",
    "keeps the sheet right-0 (default) when the pane has ample room to the left",
    "renders a ⋯ trigger instead of inline buttons",
    "opens an action sheet on click revealing the four actions",
    "mobile sheet hides until the trigger is clicked",
  ],
  "components/__tests__/PluginStalenessBanner.test.tsx": [
    "renders nothing when /api/health.bundleHash matches the embedded hash",
    "renders the banner when hashes differ",
    "Refresh button calls window.location.reload",
    "Dismiss button hides the banner and records sessionStorage",
    "does not render when dismissed in sessionStorage",
    "renders nothing when /api/health response is malformed",
  ],
  "components/__tests__/UnifiedPackagesSection.auto-check.test.tsx": [
    "fires /api/packages/check-updates once after installed list loads",
    "re-fires check-updates on package_operation_complete WS event",
    "does NOT re-fire on package_operation_complete with success=false",
    "dedupes overlapping triggers (single in-flight check)",
  ],
  "components/__tests__/PathPicker.test.tsx": [
      "should render input with initial path and fetch entries",
      "should show loading state while fetching",
      "should show .. entry for non-root directories",
      "should send typed partial as q query via debounced fetch",
      "should abort in-flight request when partial changes",
      "should descend into directory on click",
      "should navigate to parent on .. click",
      "should move highlight with arrow keys",
      "should descend on Tab with highlighted entry",
      "should auto-complete single match on Tab (after server filter returns 1)",
      "Enter on trailing-slash current directory calls onSelect and closes",
      "Enter on exact-match partial selects that entry's full path",
      "Enter on single candidate (no exact match) completes without closing",
      "Enter on non-existent typo path is a no-op (not onSelect)",
      "Select button click follows Enter rules (no onSelect on typo)",
      "Select button click on trailing-slash path calls onSelect",
      "should disable Select button when input is empty",
      "should call onCancel when Cancel button clicked",
      "should call onCancel on Escape",
      "should show git and pi indicators after lazy classify resolves",
      "should show 'No subdirectories' for empty directory",
      "should default to home directory when no initialPath",
      "does not clobber a path typed while the default-directory fetch is in flight",
      "should reset highlight when typing",
      "arrow-down navigates into the create-here row",
      "shows inline 'Create \\\"<name>\\\" here' row when partial has no exact match",
      "hides 'Create here' row when partial exactly matches an entry",
      "clicking 'Create here' calls mkdir and descends into new path",
      "footer ＋ New folder button opens name entry; Enter creates and descends",
      "Escape in footer name entry closes without creating",
      "surfaces server error and does not descend on mkdir failure",
      "renders the remedy hint (not a bare error) on a 403 network_not_allowed browse denial",
      "offers a Settings → Servers affordance on a network_not_allowed denial",
      "renders existing error copy for a non-denial browse failure",
      "renders git/pi badges after the lazy classifyPaths phase resolves",
      "swallows classifyPaths failures silently (no error surfaced, no badges)",
      "aborts phase-2 classifyPaths when fetchDir is re-invoked",
      "Enter on C:\\\\Users\\\\me\\\\ calls onSelect with the input value and closes",
      "Select button on C:\\\\Users\\\\me\\\\ calls onSelect",
      "Enter on UNC \\\\\\\\server\\\\share\\\\ calls onSelect",
      "row activation browses into the directory and never calls onSelect",
      "the checkbox selects without navigating",
      "the checkbox carries its own accessible name and checked state",
      "the trailing chevron descends",
      "Space toggles selection on the highlighted row; Enter activates it",
      "single-select mode renders no checkboxes",
      "E2 — activation toggles the self-row OFF",
      "E3 — self-row uses the open-folder glyph and renders no chevron",
      "E6 — self-row + equivalent child do not double-count",
      "E7 — current dir with live sessions is badged on the self-row",
      "E9 — self-row is absent while no current directory is resolved",
      "E9b — self-row absent when a resolved current path is empty or relative",
      "E10 — child-row activation still descends (regression)",
      "E11 — single-select mode renders no self-row, CONTENTS label, or checkboxes",
      "F1 — CONTENTS label is skipped by keyboard traversal",
      "F2 — CONTENTS label sits below the self-row and above `..`",
      "F3 — Space toggles the self-row and inserts no literal space",
      "renders no emoji glyphs and gives every row an SVG path",
      "keeps git / pi as text badges",
  ],
  "components/__tests__/LlmProviderCard.test.tsx": [
    "renders a Test button",
    "Test button is disabled when baseUrl is empty",
    "Test button is disabled when apiKey is empty",
    "Test button is enabled when both baseUrl and apiKey have values",
    "click sends POST with correct payload for a new provider (no name)",
    "saved (non-new) provider includes name in payload",
    "shows success pill with model count on ok",
    "shows 'Connected' without count when modelCount is 0",
    "shows yellow error pill with HTTP status + verbatim error line",
    "shows red unreachable pill when there is no status",
    "falls back to the not-tested register when edited with no cached health",
    "does not call testProvider when disabled",
  ],
  "components/__tests__/ServerSelector.test.tsx": [
    "does NOT probe on mount—only when dropdown opens",
    "probes once when dropdown opens, not again until it reopens",
    "renders Unreachable badge for localhost when probe fails",
    "unreachable entry is disabled and does NOT fire onSwitch when clicked",
    "renders CORS-blocked (not Unreachable) for a LAN host whose probe fails",
    "shows spinner on the entry that matches inFlightSwitchKey",
  ],
  "components/__tests__/PiUpdateBadge.test.tsx": [
    "renders nothing when there are no updates",
    "renders a count badge when updates available",
    "navigates to settings packages tab on click",
    "sets aria-label with plural-aware wording",
  ],
  "__tests__/chat-input-draft-integration.test.tsx": [
    "draft survives unmount/remount of the chat view",
    "drafts do not leak between sessions on switch",
    "hydrates drafts from localStorage on mount",
    "persists drafts through the debounced effect (write path)",
    "clears localStorage when the draft becomes empty",
  ],
  "hooks/__tests__/usePiChangelog.test.tsx": [
    "does NOT fetch when enabled is false",
    "fetches once when enabled and resolves data",
    "does not fetch when from or to is missing",
    "clears state when enabled flips to false",
    "refetches on pi_core_update_complete WS event for the same pkg",
    "ignores pi_core_update_complete for unrelated packages",
    "surfaces fetch error without throwing",
  ],
};

/**
 * Extract `it(` / `test(` first-string arguments, single-line, in declaration
 * order. None of the census files use `it.each`, so a flat scan is complete.
 */
function extractTestIds(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(/(?:^|[^.\w])(?:it|test)\(\s*([`'"])(.*?)\1\s*,/g)) {
    ids.push(m[2]);
  }
  return ids;
}

describe("fixed-tick conversion preserves behaviour (F2)", () => {
  it.each(Object.keys(CENSUS))("%s keeps its merge-base test ids", (file) => {
    const text = readFileSync(join(import.meta.dirname, "..", file), "utf8");
    expect(extractTestIds(text)).toEqual(CENSUS[file]);
  });
});
