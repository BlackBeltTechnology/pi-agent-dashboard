/**
 * Repository lint: ban the JSX-slot ↔ `??` fallback anti-pattern in
 * `packages/client/src/App.tsx` (and any future shell file pattern under
 * `packages/client/src/`).
 *
 * The bug — fixed during deployment of `add-extension-ui-decorations`,
 * captured in change `fix-slot-fallback-masks-content` — was:
 *
 *   <ContentViewSlot .../> ?? sessionDetail ?? (...)
 *
 * `<ContentViewSlot .../>` is a JSX element (always truthy from `??`'s
 * perspective). When the slot renders `null` (no plugins claim it), `??`
 * still picks the truthy element and the fallback never runs. Symptom:
 * the chat view silently disappears.
 *
 * Fix: gate the JSX construction on a claim count *before* the element is
 * created:
 *
 *   (claimCount > 0 ? <ContentViewSlot .../> : null) ?? sessionDetail
 *
 * This lint scans for the broken shape and fails with the offending
 * file:line. Mirrors the existing `no-direct-process-kill.test.ts`
 * convention.
 *
 * See change: fix-slot-fallback-masks-content.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CLIENT_SRC = path.resolve(__dirname, "..");

/** Files to scan. Add more entry points here as the shell grows. */
const SCAN_FILES = [
  "App.tsx",
  "components/SessionCard.tsx",
  // Removing 15 `SettingsSectionSlot` mounts touched `??` chains here.
  // See change: plugin-settings-pages (task 3.4).
  "components/settings/SettingsPanel.tsx",
];

/**
 * Two-stage match:
 *   1. SLOT_NEAR_NULLISH — a `<XxxSlot …/>` element followed (within ~400
 *      chars across newlines) by a `??` operator. Catches both shapes:
 *        <FooSlot/> ?? fallback                       (direct)
 *        (cond ? <FooSlot/> : null) ?? fallback       (ternary-wrapped)
 *   2. GATE_TOKEN — `getClaims(` or `.length` must appear in the same
 *      window (the ternary condition that gates element construction).
 *      If absent, the slot will mask the fallback when the slot returns
 *      `null` at render time.
 */
/**
 * Between the slot's `/>` and the `??`, only the canonical ternary-tail
 * vocabulary is allowed: whitespace, `:`, `null`, and `)`. Anything else
 * (`{`, `}`, `;`, `<`, etc.) means the `??` is consumed by a different
 * expression and is irrelevant to this slot — do not flag.
 *
 *   Matches:  `/> ??`               (direct)
 *             `/>\n  : null\n) ??`  (ternary-wrapped, the production bug)
 *   Skips:    `/>\n  {nextChild}`   (sibling-mounted; ?? unrelated)
 */
// Cap the slot-tag span at 300 chars (enough for a multi-attribute,
// multi-line slot element; not enough to bleed into a sibling JSX
// subtree). Then enforce that ONLY whitespace / `:` / `)` / `null` may
// appear between the closing `/>` and the `??` operator — anything else
// (`<`, `{`, `;`, etc.) means the `??` consumes a different expression.
const SLOT_NEAR_NULLISH = /<[A-Z]\w*Slot\b[\s\S]{0,300}?\/>[\s:)null]*\?\?/g;
const GATE_TOKEN = /getClaims\(|\.length\s*[><=]/;

function scanFile(absPath: string): Array<{ line: number; snippet: string }> {
  const text = fs.readFileSync(absPath, "utf8");
  const hits: Array<{ line: number; snippet: string }> = [];
  for (const match of text.matchAll(SLOT_NEAR_NULLISH)) {
    const matchStart = match.index ?? 0;
    const matchEnd = matchStart + match[0].length;
    // The gating check looks ONLY at the captured slot expression itself
    // (matchStart..matchEnd) plus a small lookback window for the
    // enclosing ternary condition. Looking too far backwards finds
    // unrelated `.length > 0` checks elsewhere in the file.
    const contextStart = Math.max(0, matchStart - 120);
    const context = text.slice(contextStart, matchEnd);
    if (GATE_TOKEN.test(context)) continue; // properly gated
    const line = text.slice(0, matchStart).split("\n").length;
    const snippet = match[0].trim().slice(0, 240).replace(/\s+/g, " ");
    hits.push({ line, snippet });
  }
  return hits;
}

describe("Lint: no JSX <*Slot/> directly preceding ?? fallback", () => {
  it("packages/client/src/App.tsx contains no offending pattern", () => {
    const offenders: string[] = [];
    for (const rel of SCAN_FILES) {
      const abs = path.join(CLIENT_SRC, rel);
      if (!fs.existsSync(abs)) continue;
      const hits = scanFile(abs);
      for (const h of hits) {
        offenders.push(`${rel}:${h.line}  ${h.snippet}`);
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `Found JSX-slot ?? fallback anti-pattern (see change fix-slot-fallback-masks-content for context):\n` +
          offenders.map((o) => `  - ${o}`).join("\n") +
          `\n\nFix: gate the slot element on a claim count BEFORE constructing the JSX, e.g.\n` +
          `  (claimCount > 0 ? <FooSlot .../> : null) ?? fallback`,
      );
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Helper to drive the same logic as `scanFile` against an in-memory
   * string — lets us validate the matcher catches/ignores the right
   * shapes without depending on file paths.
   */
  function scanText(text: string): Array<{ line: number; snippet: string }> {
    const hits: Array<{ line: number; snippet: string }> = [];
    for (const match of text.matchAll(SLOT_NEAR_NULLISH)) {
      const matchStart = match.index ?? 0;
      const matchEnd = matchStart + match[0].length;
      const contextStart = Math.max(0, matchStart - 120);
      const context = text.slice(contextStart, matchEnd);
      if (GATE_TOKEN.test(context)) continue;
      const line = text.slice(0, matchStart).split("\n").length;
      hits.push({ line, snippet: match[0].trim().slice(0, 240).replace(/\s+/g, " ") });
    }
    return hits;
  }

  it("matcher sanity: catches the direct broken shape", () => {
    expect(scanText("<ContentViewSlot foo={bar} /> ?? sessionDetail")).toHaveLength(1);
    expect(scanText("<FooSlot/>) ?? next")).toHaveLength(1);
    expect(scanText(`<FooSlot
      session={s}
      routeParams={{}}
    /> ?? next`)).toHaveLength(1);
  });

  it("matcher sanity: catches the ternary-wrapped broken shape (the actual production bug)", () => {
    // This is the exact shape that shipped in App.tsx pre-fix — a ternary
    // gating only on `selectedId && selectedSession` (no claim check),
    // returning the JSX in the truthy branch and `null` in the falsy branch.
    const broken = `(selectedId && selectedSession
              ? <ContentViewSlot session={selectedSession} routeParams={{}} onClose={onClose} />
              : null
            ) ?? sessionDetail`;
    expect(scanText(broken)).toHaveLength(1);
  });

  it("matcher sanity: does NOT match the gated (fixed) shape with getClaims()", () => {
    const fixed = `(selectedId && selectedSession && _pluginRegistry.getClaims("content-view").length > 0
              ? <ContentViewSlot session={s} routeParams={{}} onClose={onClose} />
              : null
            ) ?? sessionDetail`;
    expect(scanText(fixed)).toEqual([]);
  });

  it("matcher sanity: does NOT match a sibling-mounted slot (no ?? after it)", () => {
    expect(scanText("<ToastSlot sessions={sessions} />")).toEqual([]);
    expect(scanText("<ContentHeaderStickySlot session={s} />\n<ErrorBoundary>...")).toEqual([]);
  });
});
