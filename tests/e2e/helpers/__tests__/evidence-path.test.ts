/**
 * Unit tests for the measurement-evidence path resolver (#549).
 *
 * These run under the `tests` vitest project, NOT Playwright: the resolver is
 * pure filesystem logic and must be exercised by normal CI, because both specs
 * that use it are opt-in (`PI_SYNTH_AGENT_TICKS=1`) and therefore never run
 * there.
 *
 * The negative cases carry the weight. The bug this fixes was a SILENT
 * misdirected write: `mkdirSync(..., { recursive: true })` conjured a phantom
 * active-change directory once the change was archived, so a re-measure
 * appeared to leave the archived numbers untouched while recording different
 * ones elsewhere. "Throws when neither location exists" is the whole point —
 * a resolver that quietly invents a path reintroduces the bug.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EVIDENCE_FILENAME, resolveEvidencePath } from "../evidence-path.js";

const CHANGE = "verify-subagent-pull-under-load";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "evidence-path-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Create `openspec/changes/<rel>` under the fake repo root. */
function changeDir(rel: string): string {
  const dir = join(root, "openspec", "changes", rel);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("active change directory", () => {
  it("resolves into the active dir when it exists", () => {
    const dir = changeDir(CHANGE);
    expect(resolveEvidencePath(CHANGE, root)).toBe(join(dir, EVIDENCE_FILENAME));
  });

  it("prefers the active dir over an archived copy", () => {
    const active = changeDir(CHANGE);
    changeDir(`archive/2026-08-24-${CHANGE}`);
    expect(resolveEvidencePath(CHANGE, root)).toBe(join(active, EVIDENCE_FILENAME));
  });
});

describe("archived change directory", () => {
  it("falls back to the archived dir once the change is archived", () => {
    const archived = changeDir(`archive/2026-08-24-${CHANGE}`);
    expect(resolveEvidencePath(CHANGE, root)).toBe(join(archived, EVIDENCE_FILENAME));
  });

  it("picks the NEWEST archive when a reopened change was archived twice", () => {
    changeDir(`archive/2026-08-24-${CHANGE}`);
    const newer = changeDir(`archive/2026-09-02-${CHANGE}`);
    expect(resolveEvidencePath(CHANGE, root)).toBe(join(newer, EVIDENCE_FILENAME));
  });

  it("does not match a different change that merely shares a prefix", () => {
    changeDir(`archive/2026-08-24-${CHANGE}-followup`);
    expect(() => resolveEvidencePath(CHANGE, root)).toThrow();
  });

  it("ignores a plain file that happens to match the archive pattern", () => {
    mkdirSync(join(root, "openspec", "changes", "archive"), { recursive: true });
    writeFileSync(join(root, "openspec", "changes", "archive", `2026-08-24-${CHANGE}`), "not a dir");
    expect(() => resolveEvidencePath(CHANGE, root)).toThrow();
  });
});

describe("neither location exists — fail loud, never create", () => {
  it("throws instead of returning a path", () => {
    mkdirSync(join(root, "openspec", "changes"), { recursive: true });
    expect(() => resolveEvidencePath(CHANGE, root)).toThrow(/verify-subagent-pull-under-load/);
  });

  it("names both searched locations so the failure is actionable", () => {
    mkdirSync(join(root, "openspec", "changes"), { recursive: true });
    expect(() => resolveEvidencePath(CHANGE, root)).toThrow(/archive/);
  });

  it("throws when openspec/ is absent entirely", () => {
    expect(() => resolveEvidencePath(CHANGE, root)).toThrow();
  });

  it("creates no directory as a side effect of failing", () => {
    mkdirSync(join(root, "openspec", "changes"), { recursive: true });
    expect(() => resolveEvidencePath(CHANGE, root)).toThrow();
    // The phantom active-change directory in #549 is exactly what must NOT appear.
    expect(existsSync(join(root, "openspec", "changes", CHANGE))).toBe(false);
  });
});
