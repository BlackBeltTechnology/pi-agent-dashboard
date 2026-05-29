/**
 * Tests for packages/shared/src/platform/openspec.ts.
 *
 * Pure argv + parse tests; integration with a live openspec binary is
 * out of scope for unit tests (openspec may not be on PATH in CI).
 *
 * See change: platform-command-executor.
 */
import { describe, it, expect } from "vitest";
import {
  OPENSPEC_LIST,
  OPENSPEC_STATUS,
  OPENSPEC_ARCHIVE_COMPLETED,
  OPENSPEC_RECIPES,
} from "../platform/openspec.js";

describe("OPENSPEC_LIST", () => {
  it("produces `openspec list --json`", () => {
    expect(OPENSPEC_LIST.argv({ cwd: "/tmp" })).toEqual(["openspec", "list", "--json"]);
  });

  it("parses valid JSON output", () => {
    const input = { cwd: "/tmp" };
    const out = OPENSPEC_LIST.parse('{"changes":[{"name":"x"}]}', input);
    expect(out).toEqual({ changes: [{ name: "x" }] });
  });

  it("returns null for empty stdout", () => {
    expect(OPENSPEC_LIST.parse("", { cwd: "/tmp" })).toBeNull();
    expect(OPENSPEC_LIST.parse("   \n", { cwd: "/tmp" })).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(OPENSPEC_LIST.parse("not json", { cwd: "/tmp" })).toBeNull();
    expect(OPENSPEC_LIST.parse("{broken", { cwd: "/tmp" })).toBeNull();
  });
});

describe("OPENSPEC_STATUS", () => {
  it("produces `openspec status --change <name> --json`", () => {
    expect(OPENSPEC_STATUS.argv({ cwd: "/tmp", change: "add-feature" })).toEqual([
      "openspec", "status", "--change", "add-feature", "--json",
    ]);
  });

  it("parses status result JSON", () => {
    const input = { cwd: "/tmp", change: "x" };
    const out = OPENSPEC_STATUS.parse('{"artifacts":[{"id":"proposal","status":"done"}]}', input);
    expect(out).toEqual({ artifacts: [{ id: "proposal", status: "done" }] });
  });

  it("accepts change names with special characters verbatim (no shell escaping needed)", () => {
    // argv is an array, so special chars flow through unchanged
    expect(OPENSPEC_STATUS.argv({ cwd: "/tmp", change: "a b/c" })).toEqual([
      "openspec", "status", "--change", "a b/c", "--json",
    ]);
  });
});

describe("OPENSPEC_ARCHIVE_COMPLETED", () => {
  it("produces `openspec archive --completed`", () => {
    expect(OPENSPEC_ARCHIVE_COMPLETED.argv({ cwd: "/tmp" })).toEqual([
      "openspec", "archive", "--completed",
    ]);
  });

  it("returns stdout verbatim (no JSON parsing)", () => {
    expect(OPENSPEC_ARCHIVE_COMPLETED.parse("Archived 3 changes\n", { cwd: "/tmp" }))
      .toBe("Archived 3 changes\n");
  });

  it("has a longer timeout than list/status (archive can be slow)", () => {
    expect(OPENSPEC_ARCHIVE_COMPLETED.timeout).toBeGreaterThanOrEqual(15_000);
  });
});

describe("OPENSPEC_RECIPES registry", () => {
  it("enumerates all exported recipes", () => {
    expect(Object.keys(OPENSPEC_RECIPES).sort()).toEqual([
      "OPENSPEC_ARCHIVE_COMPLETED",
      "OPENSPEC_CONFIG_LIST",
      "OPENSPEC_LIST",
      "OPENSPEC_STATUS",
    ]);
  });

  it("every recipe has argv and parse functions", () => {
    for (const [name, recipe] of Object.entries(OPENSPEC_RECIPES)) {
      expect(typeof recipe.argv, `${name}.argv`).toBe("function");
      expect(typeof recipe.parse, `${name}.parse`).toBe("function");
    }
  });
});
