import { describe, it, expect } from "vitest";
import { detectOpenSpecActivity } from "@blackbelt-technology/pi-dashboard-shared/openspec-activity-detector.js";

const CWD = "/Users/dev/project";

describe("detectOpenSpecActivity", () => {
  describe("phase detection from skill file reads", () => {
    it("detects apply phase from SKILL.md read", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-apply-change/SKILL.md",
      }, CWD);
      expect(result).toEqual({ phase: "apply" });
    });

    it("detects explore phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-explore/SKILL.md",
      }, CWD);
      expect(result).toEqual({ phase: "explore" });
    });

    it("detects new phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-new-change/SKILL.md",
      }, CWD);
      expect(result).toEqual({ phase: "new" });
    });

    it("detects continue phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-continue-change/SKILL.md",
      }, CWD);
      expect(result).toEqual({ phase: "continue" });
    });

    it("detects ff phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-ff-change/SKILL.md",
      }, CWD);
      expect(result).toEqual({ phase: "ff" });
    });

    it("detects verify phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-verify-change/SKILL.md",
      }, CWD);
      expect(result).toEqual({ phase: "verify" });
    });

    it("detects archive phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-archive-change/SKILL.md",
      }, CWD);
      expect(result).toEqual({ phase: "archive" });
    });

    it("detects sync-specs phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-sync-specs/SKILL.md",
      }, CWD);
      expect(result).toEqual({ phase: "sync-specs" });
    });

    it("detects onboard phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-onboard/SKILL.md",
      }, CWD);
      expect(result).toEqual({ phase: "onboard" });
    });

    it("handles absolute paths", () => {
      const result = detectOpenSpecActivity("read", {
        path: "/Users/dev/project/.pi/skills/openspec-apply-change/SKILL.md",
      }, CWD);
      expect(result).toEqual({ phase: "apply" });
    });

    it("returns null for non-openspec skill reads", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/some-other-skill/SKILL.md",
      }, CWD);
      expect(result).toBeNull();
    });

    it("returns null for non-SKILL.md reads in openspec dirs", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-apply-change/README.md",
      }, CWD);
      expect(result).toBeNull();
    });
  });

  describe("change name detection from CLI calls", () => {
    it("detects change name from openspec status command", () => {
      const result = detectOpenSpecActivity("bash", {
        command: 'openspec status --change "session-sync" --json',
      }, CWD);
      expect(result).toEqual({ changeName: "session-sync", isActive: true });
    });

    it("detects change name from openspec instructions command", () => {
      const result = detectOpenSpecActivity("bash", {
        command: 'openspec instructions apply --change "my-feature" --json',
      }, CWD);
      expect(result).toEqual({ changeName: "my-feature", isActive: true });
    });

    it("detects change name without quotes", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec status --change session-sync --json",
      }, CWD);
      expect(result).toEqual({ changeName: "session-sync", isActive: true });
    });

    it("detects change name from openspec archive command", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec archive session-sync",
      }, CWD);
      expect(result).toEqual({ changeName: "session-sync", isActive: true });
    });

    it("returns null for non-openspec bash commands", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "npm test",
      }, CWD);
      expect(result).toBeNull();
    });

    it("detects change name from openspec new change with quoted name", () => {
      const result = detectOpenSpecActivity("bash", {
        command: 'openspec new change "add-auth"',
      }, CWD);
      expect(result).toEqual({ changeName: "add-auth", isActive: true, localEvidence: true });
    });

    it("detects change name from openspec new change with unquoted name", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec new change add-auth",
      }, CWD);
      expect(result).toEqual({ changeName: "add-auth", isActive: true, localEvidence: true });
    });

    it("detects change name from openspec new change with cd prefix", () => {
      const result = detectOpenSpecActivity("bash", {
        command: 'cd /Users/dev/project && openspec new change "my-feature"',
      }, CWD);
      expect(result).toEqual({ changeName: "my-feature", isActive: true, localEvidence: true });
    });

    it("returns null for openspec list (no change name)", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec list --json",
      }, CWD);
      expect(result).toBeNull();
    });
  });

  describe("change name detection from file reads", () => {
    it("detects change name from openspec change file read as passive", () => {
      const result = detectOpenSpecActivity("read", {
        path: "openspec/changes/session-sync/tasks.md",
      }, CWD);
      expect(result).toEqual({ changeName: "session-sync", isActive: false, localEvidence: true });
    });

    it("detects change name from absolute path as passive", () => {
      const result = detectOpenSpecActivity("read", {
        path: "/Users/dev/project/openspec/changes/my-feature/proposal.md",
      }, CWD);
      expect(result).toEqual({ changeName: "my-feature", isActive: false, localEvidence: true });
    });

    it("returns null for non-openspec file reads", () => {
      const result = detectOpenSpecActivity("read", {
        path: "src/server/server.ts",
      }, CWD);
      expect(result).toBeNull();
    });
  });

  describe("change name detection from file writes", () => {
    it("detects change name from openspec change file write as active", () => {
      const result = detectOpenSpecActivity("write", {
        path: "openspec/changes/session-sync/proposal.md",
      }, CWD);
      expect(result).toEqual({ changeName: "session-sync", isActive: true, localEvidence: true });
    });

    it("detects change name from absolute path write as active", () => {
      const result = detectOpenSpecActivity("write", {
        path: "/Users/dev/project/openspec/changes/my-feature/spec.md",
      }, CWD);
      expect(result).toEqual({ changeName: "my-feature", isActive: true, localEvidence: true });
    });

    it("returns null for non-openspec file writes", () => {
      const result = detectOpenSpecActivity("write", {
        path: "src/server/server.ts",
      }, CWD);
      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("handles capitalized tool names (backward compatibility)", () => {
      expect(detectOpenSpecActivity("Read", {
        path: "openspec/changes/my-feature/proposal.md",
      }, CWD)).toEqual({ changeName: "my-feature", isActive: false, localEvidence: true });

      expect(detectOpenSpecActivity("Bash", {
        command: 'openspec status --change "add-auth" --json',
      }, CWD)).toEqual({ changeName: "add-auth", isActive: true });

      expect(detectOpenSpecActivity("Write", {
        path: "openspec/changes/my-feature/design.md",
      }, CWD)).toEqual({ changeName: "my-feature", isActive: true, localEvidence: true });
    });

    it("returns null for unknown tool names", () => {
      const result = detectOpenSpecActivity("unknown", { path: "foo.ts" }, CWD);
      expect(result).toBeNull();
    });

    it("returns null when args are missing", () => {
      const result = detectOpenSpecActivity("read", undefined, CWD);
      expect(result).toBeNull();
    });

    it("returns null when args are empty", () => {
      const result = detectOpenSpecActivity("read", {}, CWD);
      expect(result).toBeNull();
    });
  });

  describe("flag-shaped change names", () => {
    it("returns null for `openspec archive --help`", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec archive --help",
      }, CWD);
      expect(result).toBeNull();
    });

    it("returns null for `openspec new change --help`", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec new change --help",
      }, CWD);
      expect(result).toBeNull();
    });

    it("returns null when --change is followed by another flag", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec foo --change --help",
      }, CWD);
      expect(result).toBeNull();
    });

    it("still extracts a real change name from `openspec archive add-auth`", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec archive add-auth",
      }, CWD);
      expect(result).toEqual({ changeName: "add-auth", isActive: true });
    });

    it("still extracts a quoted change name from `openspec archive \"add-auth\"`", () => {
      const result = detectOpenSpecActivity("bash", {
        command: 'openspec archive "add-auth"',
      }, CWD);
      expect(result).toEqual({ changeName: "add-auth", isActive: true });
    });
  });

  describe("non-slug-shaped change names (fix-uuid-rename-bug)", () => {
    const UUID = "019df0aa-1234-5678-9abc-def012345678";

    it("returns null for UUID-shaped path on Read", () => {
      const result = detectOpenSpecActivity("read", {
        path: `openspec/changes/${UUID}/proposal.md`,
      }, CWD);
      expect(result).toBeNull();
    });

    it("returns null for UUID-shaped path on Write", () => {
      const result = detectOpenSpecActivity("write", {
        path: `openspec/changes/${UUID}/proposal.md`,
      }, CWD);
      expect(result).toBeNull();
    });

    it("returns null for UUID-shaped CLI argument", () => {
      const result = detectOpenSpecActivity("bash", {
        command: `openspec archive ${UUID}`,
      }, CWD);
      expect(result).toBeNull();
    });

    it("returns null for uppercase change name on Read", () => {
      const result = detectOpenSpecActivity("read", {
        path: "openspec/changes/AddAuth/proposal.md",
      }, CWD);
      expect(result).toBeNull();
    });

    it("returns null for underscore-containing CLI argument", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec archive add_auth",
      }, CWD);
      expect(result).toBeNull();
    });

    it("returns null for digit-prefixed CLI argument", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec archive 1bad",
      }, CWD);
      expect(result).toBeNull();
    });

    it("returns null for token exceeding 64-character cap", () => {
      const longName = "a".repeat(65);
      const result = detectOpenSpecActivity("write", {
        path: `openspec/changes/${longName}/spec.md`,
      }, CWD);
      expect(result).toBeNull();
    });

    it("still extracts valid digit-containing kebab slug", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec archive valid-name-123",
      }, CWD);
      expect(result).toEqual({ changeName: "valid-name-123", isActive: true });
    });

    it("still extracts valid slug from Write path", () => {
      const result = detectOpenSpecActivity("write", {
        path: "openspec/changes/fix-mobile-attach/proposal.md",
      }, CWD);
      expect(result).toEqual({ changeName: "fix-mobile-attach", isActive: true, localEvidence: true });
    });
  });

  // cwd-locality scoping (change: scope-openspec-auto-attach-to-session-cwd).
  // Fixtures assert the EXPECTED OUTCOME, never merely "no throw" — on a
  // case-insensitive filesystem a mismatched fixture/cwd pair can silently
  // flip a test's meaning.
  describe("cwd scoping", () => {
    const A = "/repo-a";

    it("E12 detects a path inside the session cwd", () => {
      expect(
        detectOpenSpecActivity("write", { path: "/repo-a/openspec/changes/c-a/tasks.md" }, A),
      ).toEqual({ changeName: "c-a", isActive: true, localEvidence: true });
    });

    it("E13 ignores a path in another root", () => {
      expect(
        detectOpenSpecActivity("write", { path: "/repo-b/openspec/changes/c-b/tasks.md" }, A),
      ).toBeNull();
    });

    it("E14 sibling prefix is not containment", () => {
      expect(
        detectOpenSpecActivity("write", { path: "/repo-a-other/openspec/changes/c-b/tasks.md" }, A),
      ).toBeNull();
    });

    it("E15 resolves a relative path against the cwd", () => {
      expect(
        detectOpenSpecActivity("read", { path: "openspec/changes/c-a/tasks.md" }, A),
      ).toEqual({ changeName: "c-a", isActive: false, localEvidence: true });
    });

    it("E16 rejects the incident command shape (cd into another repo first)", () => {
      expect(
        detectOpenSpecActivity("bash", { command: "cd /repo-b && openspec new change add-auth" }, A),
      ).toBeNull();
    });

    it("E17 suppression is position-insensitive (cd after the invocation)", () => {
      expect(
        detectOpenSpecActivity("bash", { command: "openspec new change add-auth && cd /repo-b" }, A),
      ).toBeNull();
    });

    it("E18 an inside-cwd relocation is not suppressed", () => {
      expect(
        detectOpenSpecActivity("bash", { command: "cd /repo-a/packages/server && openspec new change add-auth" }, A),
      ).toEqual({ changeName: "add-auth", isActive: true, localEvidence: true });
    });

    it("E19 suppression covers the archive pattern", () => {
      expect(
        detectOpenSpecActivity("bash", { command: "cd /repo-b && openspec archive c-b" }, A),
      ).toBeNull();
    });

    it("E20 suppression covers the --change flag pattern", () => {
      expect(
        detectOpenSpecActivity("bash", { command: "openspec validate --change c-b && cd /repo-b" }, A),
      ).toBeNull();
    });
  });
});
