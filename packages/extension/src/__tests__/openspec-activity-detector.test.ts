import { describe, it, expect } from "vitest";
import { detectOpenSpecActivity } from "@blackbelt-technology/pi-dashboard-shared/openspec-activity-detector.js";

describe("detectOpenSpecActivity", () => {
  describe("phase detection from skill file reads", () => {
    it("detects apply phase from SKILL.md read", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-apply-change/SKILL.md",
      });
      expect(result).toEqual({ phase: "apply" });
    });

    it("detects explore phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-explore/SKILL.md",
      });
      expect(result).toEqual({ phase: "explore" });
    });

    it("detects new phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-new-change/SKILL.md",
      });
      expect(result).toEqual({ phase: "new" });
    });

    it("detects continue phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-continue-change/SKILL.md",
      });
      expect(result).toEqual({ phase: "continue" });
    });

    it("detects ff phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-ff-change/SKILL.md",
      });
      expect(result).toEqual({ phase: "ff" });
    });

    it("detects verify phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-verify-change/SKILL.md",
      });
      expect(result).toEqual({ phase: "verify" });
    });

    it("detects archive phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-archive-change/SKILL.md",
      });
      expect(result).toEqual({ phase: "archive" });
    });

    it("detects sync-specs phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-sync-specs/SKILL.md",
      });
      expect(result).toEqual({ phase: "sync-specs" });
    });

    it("detects onboard phase", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-onboard/SKILL.md",
      });
      expect(result).toEqual({ phase: "onboard" });
    });

    it("handles absolute paths", () => {
      const result = detectOpenSpecActivity("read", {
        path: "/Users/dev/project/.pi/skills/openspec-apply-change/SKILL.md",
      });
      expect(result).toEqual({ phase: "apply" });
    });

    it("returns null for non-openspec skill reads", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/some-other-skill/SKILL.md",
      });
      expect(result).toBeNull();
    });

    it("returns null for non-SKILL.md reads in openspec dirs", () => {
      const result = detectOpenSpecActivity("read", {
        path: ".pi/skills/openspec-apply-change/README.md",
      });
      expect(result).toBeNull();
    });
  });

  describe("change name detection from CLI calls", () => {
    it("detects change name from openspec status command", () => {
      const result = detectOpenSpecActivity("bash", {
        command: 'openspec status --change "session-sync" --json',
      });
      expect(result).toEqual({ changeName: "session-sync", isActive: true });
    });

    it("detects change name from openspec instructions command", () => {
      const result = detectOpenSpecActivity("bash", {
        command: 'openspec instructions apply --change "my-feature" --json',
      });
      expect(result).toEqual({ changeName: "my-feature", isActive: true });
    });

    it("detects change name without quotes", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec status --change session-sync --json",
      });
      expect(result).toEqual({ changeName: "session-sync", isActive: true });
    });

    it("detects change name from openspec archive command", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec archive session-sync",
      });
      expect(result).toEqual({ changeName: "session-sync", isActive: true });
    });

    it("returns null for non-openspec bash commands", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "npm test",
      });
      expect(result).toBeNull();
    });

    it("detects change name from openspec new change with quoted name", () => {
      const result = detectOpenSpecActivity("bash", {
        command: 'openspec new change "add-auth"',
      });
      expect(result).toEqual({ changeName: "add-auth", isActive: true });
    });

    it("detects change name from openspec new change with unquoted name", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec new change add-auth",
      });
      expect(result).toEqual({ changeName: "add-auth", isActive: true });
    });

    it("detects change name from openspec new change with cd prefix", () => {
      const result = detectOpenSpecActivity("bash", {
        command: 'cd /Users/dev/project && openspec new change "my-feature"',
      });
      expect(result).toEqual({ changeName: "my-feature", isActive: true });
    });

    it("returns null for openspec list (no change name)", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec list --json",
      });
      expect(result).toBeNull();
    });
  });

  describe("change name detection from file reads", () => {
    it("detects change name from openspec change file read as passive", () => {
      const result = detectOpenSpecActivity("read", {
        path: "openspec/changes/session-sync/tasks.md",
      });
      expect(result).toEqual({ changeName: "session-sync", isActive: false });
    });

    it("detects change name from absolute path as passive", () => {
      const result = detectOpenSpecActivity("read", {
        path: "/Users/dev/project/openspec/changes/my-feature/proposal.md",
      });
      expect(result).toEqual({ changeName: "my-feature", isActive: false });
    });

    it("returns null for non-openspec file reads", () => {
      const result = detectOpenSpecActivity("read", {
        path: "src/server/server.ts",
      });
      expect(result).toBeNull();
    });
  });

  describe("change name detection from file writes", () => {
    it("detects change name from openspec change file write as active", () => {
      const result = detectOpenSpecActivity("write", {
        path: "openspec/changes/session-sync/proposal.md",
      });
      expect(result).toEqual({ changeName: "session-sync", isActive: true });
    });

    it("detects change name from absolute path write as active", () => {
      const result = detectOpenSpecActivity("write", {
        path: "/Users/dev/project/openspec/changes/my-feature/spec.md",
      });
      expect(result).toEqual({ changeName: "my-feature", isActive: true });
    });

    it("returns null for non-openspec file writes", () => {
      const result = detectOpenSpecActivity("write", {
        path: "src/server/server.ts",
      });
      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("handles capitalized tool names (backward compatibility)", () => {
      expect(detectOpenSpecActivity("Read", {
        path: "openspec/changes/my-feature/proposal.md",
      })).toEqual({ changeName: "my-feature", isActive: false });

      expect(detectOpenSpecActivity("Bash", {
        command: 'openspec status --change "add-auth" --json',
      })).toEqual({ changeName: "add-auth", isActive: true });

      expect(detectOpenSpecActivity("Write", {
        path: "openspec/changes/my-feature/design.md",
      })).toEqual({ changeName: "my-feature", isActive: true });
    });

    it("returns null for unknown tool names", () => {
      const result = detectOpenSpecActivity("unknown", { path: "foo.ts" });
      expect(result).toBeNull();
    });

    it("returns null when args are missing", () => {
      const result = detectOpenSpecActivity("read", undefined);
      expect(result).toBeNull();
    });

    it("returns null when args are empty", () => {
      const result = detectOpenSpecActivity("read", {});
      expect(result).toBeNull();
    });
  });

  describe("flag-shaped change names", () => {
    it("returns null for `openspec archive --help`", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec archive --help",
      });
      expect(result).toBeNull();
    });

    it("returns null for `openspec new change --help`", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec new change --help",
      });
      expect(result).toBeNull();
    });

    it("returns null when --change is followed by another flag", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec foo --change --help",
      });
      expect(result).toBeNull();
    });

    it("still extracts a real change name from `openspec archive add-auth`", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec archive add-auth",
      });
      expect(result).toEqual({ changeName: "add-auth", isActive: true });
    });

    it("still extracts a quoted change name from `openspec archive \"add-auth\"`", () => {
      const result = detectOpenSpecActivity("bash", {
        command: 'openspec archive "add-auth"',
      });
      expect(result).toEqual({ changeName: "add-auth", isActive: true });
    });
  });

  describe("non-slug-shaped change names (fix-uuid-rename-bug)", () => {
    const UUID = "019df0aa-1234-5678-9abc-def012345678";

    it("returns null for UUID-shaped path on Read", () => {
      const result = detectOpenSpecActivity("read", {
        path: `openspec/changes/${UUID}/proposal.md`,
      });
      expect(result).toBeNull();
    });

    it("returns null for UUID-shaped path on Write", () => {
      const result = detectOpenSpecActivity("write", {
        path: `openspec/changes/${UUID}/proposal.md`,
      });
      expect(result).toBeNull();
    });

    it("returns null for UUID-shaped CLI argument", () => {
      const result = detectOpenSpecActivity("bash", {
        command: `openspec archive ${UUID}`,
      });
      expect(result).toBeNull();
    });

    it("returns null for uppercase change name on Read", () => {
      const result = detectOpenSpecActivity("read", {
        path: "openspec/changes/AddAuth/proposal.md",
      });
      expect(result).toBeNull();
    });

    it("returns null for underscore-containing CLI argument", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec archive add_auth",
      });
      expect(result).toBeNull();
    });

    it("returns null for digit-prefixed CLI argument", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec archive 1bad",
      });
      expect(result).toBeNull();
    });

    it("returns null for token exceeding 64-character cap", () => {
      const longName = "a".repeat(65);
      const result = detectOpenSpecActivity("write", {
        path: `openspec/changes/${longName}/spec.md`,
      });
      expect(result).toBeNull();
    });

    it("still extracts valid digit-containing kebab slug", () => {
      const result = detectOpenSpecActivity("bash", {
        command: "openspec archive valid-name-123",
      });
      expect(result).toEqual({ changeName: "valid-name-123", isActive: true });
    });

    it("still extracts valid slug from Write path", () => {
      const result = detectOpenSpecActivity("write", {
        path: "openspec/changes/fix-mobile-attach/proposal.md",
      });
      expect(result).toEqual({ changeName: "fix-mobile-attach", isActive: true });
    });
  });
});
