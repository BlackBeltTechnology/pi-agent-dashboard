/**
 * Tests for the shared file-mutation tool classifier.
 *
 * The classifier recognizes shipped file-mutation tool families by NAME only
 * (case-insensitive), never by provider or model id. See change:
 * retain-failed-tool-file-changes.
 */
import { describe, expect, it } from "vitest";
import { isMutationTool, mutationFamily } from "../tool-mutation.js";

describe("isMutationTool", () => {
  it("recognizes direct-file tools case-insensitively", () => {
    for (const name of ["write", "Write", "WRITE", "edit", "Edit", "strreplace", "StrReplace", "STRREPLACE"]) {
      expect(isMutationTool(name)).toBe(true);
    }
  });

  it("recognizes shell tools case-insensitively", () => {
    for (const name of ["bash", "Bash", "shell", "Shell", "exec_command", "Exec_Command"]) {
      expect(isMutationTool(name)).toBe(true);
    }
  });

  it("recognizes the patch tool case-insensitively", () => {
    for (const name of ["apply_patch", "Apply_Patch", "APPLY_PATCH"]) {
      expect(isMutationTool(name)).toBe(true);
    }
  });

  it("excludes non-mutation tools", () => {
    for (const name of ["read", "Read", "search", "grep", "glob", "ls", "web_search", "task", "todo", ""]) {
      expect(isMutationTool(name)).toBe(false);
    }
  });

  it("handles surrounding whitespace and undefined-ish input", () => {
    expect(isMutationTool("  write  ")).toBe(true);
    expect(isMutationTool(undefined as unknown as string)).toBe(false);
    expect(isMutationTool(null as unknown as string)).toBe(false);
  });
});

describe("mutationFamily", () => {
  it("classifies direct-file tools", () => {
    expect(mutationFamily("write")).toBe("direct");
    expect(mutationFamily("Edit")).toBe("direct");
    expect(mutationFamily("StrReplace")).toBe("direct");
  });

  it("classifies shell tools", () => {
    expect(mutationFamily("bash")).toBe("shell");
    expect(mutationFamily("Shell")).toBe("shell");
    expect(mutationFamily("exec_command")).toBe("shell");
  });

  it("classifies the patch tool", () => {
    expect(mutationFamily("apply_patch")).toBe("patch");
  });

  it("returns null for non-mutation tools", () => {
    expect(mutationFamily("read")).toBeNull();
    expect(mutationFamily("")).toBeNull();
  });
});
