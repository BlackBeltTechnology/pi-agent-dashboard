/**
 * Tests for packages/shared/src/platform/paths.ts.
 *
 * Every test explicitly passes a `platform: NodeJS.Platform` argument so
 * both Windows and Unix branches run on every CI host. No mutation of
 * `process.platform`, no `vi.mock`.
 *
 * See change: platform-path-normalization.
 */
import { describe, it, expect } from "vitest";
import {
  normalizePath,
  samePath,
  parsePathInput,
  withTrailingSep,
  joinForDisplay,
  isFilesystemRoot,
} from "../platform/paths.js";

// ── normalizePath ───────────────────────────────────────────────────────────

describe("normalizePath — Windows", () => {
  it("strips trailing separator from non-root path", () => {
    expect(normalizePath("C:\\Dev\\BB\\pi-agent-dashboard\\", "win32"))
      .toBe("C:\\Dev\\BB\\pi-agent-dashboard");
  });

  it("canonicalizes mixed separators to backslash", () => {
    expect(normalizePath("C:/Dev\\BB/pi-agent-dashboard", "win32"))
      .toBe("C:\\Dev\\BB\\pi-agent-dashboard");
  });

  it("preserves drive root trailing separator", () => {
    expect(normalizePath("C:\\", "win32")).toBe("C:\\");
  });

  it("preserves UNC root", () => {
    expect(normalizePath("\\\\server\\share\\path\\", "win32"))
      .toBe("\\\\server\\share\\path");
  });

  it("resolves .. and . segments within a drive", () => {
    expect(normalizePath("C:\\Dev\\BB\\..\\.\\pi-agent-dashboard", "win32"))
      .toBe("C:\\Dev\\pi-agent-dashboard");
  });

  it("preserves case (no lowercasing)", () => {
    expect(normalizePath("C:\\Dev\\BB", "win32")).toBe("C:\\Dev\\BB");
    expect(normalizePath("b:\\Dev\\BB", "win32")).toBe("b:\\Dev\\BB");
  });

  it("preserves different drive letters independently", () => {
    expect(normalizePath("A:\\Foo\\Bar", "win32")).toBe("A:\\Foo\\Bar");
    expect(normalizePath("B:\\Foo\\Bar", "win32")).toBe("B:\\Foo\\Bar");
    expect(normalizePath("Z:\\Something", "win32")).toBe("Z:\\Something");
  });

  it("treats bare drive letter as drive root, not cwd-relative", () => {
    // Must NOT fall through to path.win32.resolve which would return
    // <cwd-on-B-drive>, leaking process.cwd() into the result.
    expect(normalizePath("B:", "win32")).toBe("B:\\");
    expect(normalizePath("Z:", "win32")).toBe("Z:\\");
  });

  it("treats drive-relative typed form as drive-rooted", () => {
    // "B:Dev" → treat as "B:\Dev", NOT as <B-drive-cwd>\Dev
    expect(normalizePath("B:Dev", "win32")).toBe("B:\\Dev");
    expect(normalizePath("C:Users\\me", "win32")).toBe("C:\\Users\\me");
  });

  it("drops duplicate separators", () => {
    expect(normalizePath("D:\\\\", "win32")).toBe("D:\\");
    expect(normalizePath("C:\\\\Users\\\\me", "win32")).toBe("C:\\Users\\me");
  });
});

describe("normalizePath — POSIX", () => {
  it("strips trailing separator from non-root path", () => {
    expect(normalizePath("/Users/me/Projects/", "linux"))
      .toBe("/Users/me/Projects");
  });

  it("preserves root", () => {
    expect(normalizePath("/", "linux")).toBe("/");
    expect(normalizePath("/", "darwin")).toBe("/");
  });

  it("resolves .. and . segments", () => {
    expect(normalizePath("/Users/me/Dev/../Projects", "linux"))
      .toBe("/Users/me/Projects");
  });

  it("collapses duplicate slashes", () => {
    expect(normalizePath("/Users//me///Projects", "linux"))
      .toBe("/Users/me/Projects");
  });

  it("preserves case", () => {
    expect(normalizePath("/Users/Robson/Dev", "linux")).toBe("/Users/Robson/Dev");
  });
});

// ── samePath ────────────────────────────────────────────────────────────────

describe("samePath — Windows (case-insensitive)", () => {
  it("matches identical paths", () => {
    expect(samePath("C:\\Dev", "C:\\Dev", "win32")).toBe(true);
  });

  it("matches with different case", () => {
    expect(samePath("C:\\Dev\\BB", "c:\\dev\\bb", "win32")).toBe(true);
  });

  it("matches with different separator style", () => {
    expect(samePath("C:\\Dev\\BB", "C:/Dev/BB", "win32")).toBe(true);
  });

  it("matches with trailing-separator drift", () => {
    expect(samePath("C:\\Dev\\BB", "C:\\Dev\\BB\\", "win32")).toBe(true);
  });

  it("matches drive-letter case drift alone", () => {
    expect(samePath("B:\\Dev\\BB", "b:\\Dev\\BB", "win32")).toBe(true);
  });

  it("DOES NOT merge different drive letters", () => {
    expect(samePath("A:\\Foo", "B:\\Foo", "win32")).toBe(false);
    expect(samePath("C:\\Users\\me\\Dev", "D:\\Users\\me\\Dev", "win32")).toBe(false);
  });

  it("DOES NOT merge UNC path with drive-letter path", () => {
    expect(samePath("\\\\server\\share\\x", "B:\\x", "win32")).toBe(false);
  });

  it("returns false for genuinely different paths", () => {
    expect(samePath("C:\\a", "C:\\b", "win32")).toBe(false);
  });
});

describe("samePath — macOS (case-insensitive, HFS+ default)", () => {
  it("matches with different case", () => {
    expect(samePath("/Users/me/Dev", "/Users/me/dev", "darwin")).toBe(true);
  });

  it("matches with trailing-separator drift", () => {
    expect(samePath("/Users/me/Dev", "/Users/me/Dev/", "darwin")).toBe(true);
  });
});

describe("samePath — Linux (case-sensitive)", () => {
  it("does NOT match on case drift", () => {
    expect(samePath("/Users/me/Dev", "/users/me/dev", "linux")).toBe(false);
  });

  it("matches identical paths", () => {
    expect(samePath("/Users/me/Dev", "/Users/me/Dev", "linux")).toBe(true);
  });

  it("matches with trailing-separator drift", () => {
    expect(samePath("/Users/me/Dev", "/Users/me/Dev/", "linux")).toBe(true);
  });

  it("returns false for different paths", () => {
    expect(samePath("/a/b", "/a/c", "linux")).toBe(false);
  });
});

// ── parsePathInput ──────────────────────────────────────────────────────────

describe("parsePathInput — Windows", () => {
  it("splits path ending in separator", () => {
    expect(parsePathInput("C:\\Users\\mboto\\", "win32"))
      .toEqual({ parent: "C:\\Users\\mboto", partial: "" });
  });

  it("splits path with partial trailing segment", () => {
    expect(parsePathInput("C:\\Users\\mboto\\Dev", "win32"))
      .toEqual({ parent: "C:\\Users\\mboto", partial: "Dev" });
  });

  it("treats drive root with trailing separator as root", () => {
    expect(parsePathInput("C:\\", "win32"))
      .toEqual({ parent: "C:\\", partial: "" });
  });

  it("treats bare drive letter as drive root", () => {
    // Critical: must NOT leak cwd via path.win32.resolve fallback.
    expect(parsePathInput("B:", "win32"))
      .toEqual({ parent: "B:\\", partial: "" });
    expect(parsePathInput("Z:", "win32"))
      .toEqual({ parent: "Z:\\", partial: "" });
  });

  it("treats drive-relative typed form as drive root + partial", () => {
    expect(parsePathInput("B:Dev", "win32"))
      .toEqual({ parent: "B:\\", partial: "Dev" });
    expect(parsePathInput("C:Users", "win32"))
      .toEqual({ parent: "C:\\", partial: "Users" });
  });

  it("splits drive root + partial when separator present", () => {
    expect(parsePathInput("C:\\Us", "win32"))
      .toEqual({ parent: "C:\\", partial: "Us" });
  });

  it("handles UNC path with trailing separator", () => {
    expect(parsePathInput("\\\\server\\share\\dir\\", "win32"))
      .toEqual({ parent: "\\\\server\\share\\dir", partial: "" });
  });

  it("tolerates mixed separators", () => {
    expect(parsePathInput("C:\\Users\\mboto/Dev", "win32"))
      .toEqual({ parent: "C:\\Users\\mboto", partial: "Dev" });
  });

  it("is drive-letter symmetric", () => {
    // Same shape regardless of drive letter.
    for (const d of ["A", "B", "C", "D", "Z"]) {
      expect(parsePathInput(`${d}:\\Foo\\B`, "win32"))
        .toEqual({ parent: `${d}:\\Foo`, partial: "B" });
    }
  });
});

describe("parsePathInput — POSIX", () => {
  it("splits absolute path with trailing separator", () => {
    expect(parsePathInput("/Users/me/", "linux"))
      .toEqual({ parent: "/Users/me", partial: "" });
  });

  it("splits absolute path with partial", () => {
    expect(parsePathInput("/Users/me/Dev", "linux"))
      .toEqual({ parent: "/Users/me", partial: "Dev" });
  });

  it("treats root alone as root", () => {
    expect(parsePathInput("/", "linux"))
      .toEqual({ parent: "/", partial: "" });
  });

  it("treats partial-under-root as such", () => {
    expect(parsePathInput("/U", "linux"))
      .toEqual({ parent: "/", partial: "U" });
  });
});

// ── withTrailingSep & joinForDisplay ────────────────────────────────────────

describe("withTrailingSep", () => {
  it("appends \\ on Windows", () => {
    expect(withTrailingSep("C:\\Users\\me", "win32")).toBe("C:\\Users\\me\\");
  });
  it("appends / on POSIX", () => {
    expect(withTrailingSep("/Users/me", "linux")).toBe("/Users/me/");
  });
  it("does not double-append when already terminated", () => {
    expect(withTrailingSep("C:\\Users\\me\\", "win32")).toBe("C:\\Users\\me\\");
    expect(withTrailingSep("/Users/me/", "linux")).toBe("/Users/me/");
  });
});

describe("joinForDisplay", () => {
  it("joins Windows paths with backslash", () => {
    expect(joinForDisplay("C:\\Users", "me", "win32")).toBe("C:\\Users\\me");
  });
  it("joins POSIX paths with forward slash", () => {
    expect(joinForDisplay("/Users", "me", "linux")).toBe("/Users/me");
  });
});

// ── isFilesystemRoot ────────────────────────────────────────────────────────

describe("isFilesystemRoot", () => {
  it("recognises Windows drive roots", () => {
    expect(isFilesystemRoot("C:\\", "win32")).toBe(true);
    expect(isFilesystemRoot("B:\\", "win32")).toBe(true);
    expect(isFilesystemRoot("C:\\Users", "win32")).toBe(false);
  });

  it("recognises Unix root", () => {
    expect(isFilesystemRoot("/", "linux")).toBe(true);
    expect(isFilesystemRoot("/Users", "linux")).toBe(false);
  });
});
