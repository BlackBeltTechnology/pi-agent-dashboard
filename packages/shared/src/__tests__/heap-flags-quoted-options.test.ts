/**
 * NODE_OPTIONS may carry quoted values (`--require "/a  b.js"`). Removing or
 * replacing the dashboard's own heap token must leave every other byte exactly
 * as written — a split/join round-trip collapses repeated spaces inside quotes
 * and silently retargets the operator's path.
 * See change: guard-server-heap-and-store-coupling (CodeRabbit PR #780).
 */
import { describe, expect, it } from "vitest";
import {
  HEAP_FLAG_MARKER_ENV,
  mergeHeapIntoNodeOptions,
  stampHeapFlag,
  stripDashboardHeapFlag,
} from "../heap-flags.js";

const QUOTED = '--require "/opt/my  hooks/pre  load.js"';
const OURS = "--max-old-space-size=1536";

describe("heap-flag helpers preserve quoted NODE_OPTIONS verbatim", () => {
  it("stripDashboardHeapFlag removes only our token", () => {
    const env = stripDashboardHeapFlag({ NODE_OPTIONS: `${QUOTED} ${OURS}`, [HEAP_FLAG_MARKER_ENV]: OURS });
    expect(env.NODE_OPTIONS).toBe(QUOTED);
  });

  it("stripDashboardHeapFlag handles our token first and in the middle", () => {
    expect(stripDashboardHeapFlag({ NODE_OPTIONS: `${OURS} ${QUOTED}`, [HEAP_FLAG_MARKER_ENV]: OURS }).NODE_OPTIONS).toBe(QUOTED);
    expect(
      stripDashboardHeapFlag({ NODE_OPTIONS: `--a ${OURS} ${QUOTED}`, [HEAP_FLAG_MARKER_ENV]: OURS }).NODE_OPTIONS,
    ).toBe(`--a ${QUOTED}`);
  });

  it("stripDashboardHeapFlag does not match a token that merely starts with ours", () => {
    const env = stripDashboardHeapFlag({ NODE_OPTIONS: `${OURS}0`, [HEAP_FLAG_MARKER_ENV]: OURS });
    expect(env.NODE_OPTIONS).toBe(`${OURS}0`);
  });

  it("stampHeapFlag replaces our token and keeps the quoted value", () => {
    const env = stampHeapFlag<Record<string, string>>({ NODE_OPTIONS: `${QUOTED} ${OURS}`, [HEAP_FLAG_MARKER_ENV]: OURS }, 2048);
    expect(env.NODE_OPTIONS).toBe(`${QUOTED} --max-old-space-size=2048`);
  });

  it("stampHeapFlag keeps the quoted value when an operator pin wins", () => {
    const env = stampHeapFlag<Record<string, string>>(
      { NODE_OPTIONS: `${QUOTED} --max_old_space_size=4096 ${OURS}`, [HEAP_FLAG_MARKER_ENV]: OURS },
      2048,
    );
    expect(env.NODE_OPTIONS).toBe(`${QUOTED} --max_old_space_size=4096`);
  });

  it("mergeHeapIntoNodeOptions keeps the quoted value", () => {
    expect(mergeHeapIntoNodeOptions(`${QUOTED} ${OURS}`, "--max-old-space-size=512", OURS)).toBe(
      `${QUOTED} --max-old-space-size=512`,
    );
  });

  // CodeRabbit PR #780 round 2: boundaries count only OUTSIDE quotes, so a
  // quoted value that literally contains our token is not edited.
  describe("a quoted value containing our exact token is untouched", () => {
    const TRAP = `--require "/tmp/pre ${OURS} load.cjs"`;

    it("stripDashboardHeapFlag", () => {
      const env = stripDashboardHeapFlag({ NODE_OPTIONS: `${TRAP} ${OURS}`, [HEAP_FLAG_MARKER_ENV]: OURS });
      expect(env.NODE_OPTIONS).toBe(TRAP);
    });

    it("stampHeapFlag (re-stamp) — and the quoted text is not mistaken for an operator pin", () => {
      const env = stampHeapFlag<Record<string, string>>({ NODE_OPTIONS: `${TRAP} ${OURS}`, [HEAP_FLAG_MARKER_ENV]: OURS }, 2048);
      expect(env.NODE_OPTIONS).toBe(`${TRAP} --max-old-space-size=2048`);
      expect(env[HEAP_FLAG_MARKER_ENV]).toBe("--max-old-space-size=2048");
    });

    it("mergeHeapIntoNodeOptions", () => {
      expect(mergeHeapIntoNodeOptions(`${TRAP} ${OURS}`, "--max-old-space-size=512", OURS)).toBe(
        `${TRAP} --max-old-space-size=512`,
      );
    });

    it("an escaped quote inside a quoted value does not end it", () => {
      const esc = `--title "a \\" ${OURS} b"`;
      const env = stripDashboardHeapFlag({ NODE_OPTIONS: `${esc} ${OURS}`, [HEAP_FLAG_MARKER_ENV]: OURS });
      expect(env.NODE_OPTIONS).toBe(esc);
    });
  });
});
