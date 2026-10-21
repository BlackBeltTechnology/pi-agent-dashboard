/**
 * Tests for the file read endpoint logic.
 * Uses lightweight path validation tests since integration tests
 * require a full server (covered by manual testing).
 */

import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Extracted path containment check — same logic used in the endpoint.
 */
function isPathContained(cwd: string, relPath: string): boolean {
  const resolved = path.resolve(cwd, relPath);
  return resolved.startsWith(cwd + path.sep) || resolved === cwd;
}

describe("file endpoint path validation", () => {
  it("should allow a simple relative path", () => {
    expect(isPathContained("/project", "readme.md")).toBe(true);
  });

  it("should allow a nested relative path", () => {
    expect(isPathContained("/project", "openspec/changes/foo/proposal.md")).toBe(true);
  });

  it("should allow a subdirectory path", () => {
    expect(isPathContained("/project", "openspec/changes/foo/specs")).toBe(true);
  });

  it("should reject path traversal with ../", () => {
    expect(isPathContained("/project", "../../etc/passwd")).toBe(false);
  });

  it("should reject path traversal that resolves outside cwd", () => {
    expect(isPathContained("/project/sub", "../other/file.md")).toBe(false);
  });

  it("should allow path with ../ that stays inside cwd", () => {
    expect(isPathContained("/project", "a/../b/file.md")).toBe(true);
  });

  it("should reject absolute path outside cwd", () => {
    expect(isPathContained("/project", "/etc/passwd")).toBe(false);
  });

  it("should allow cwd itself", () => {
    expect(isPathContained("/project", ".")).toBe(true);
  });
});
