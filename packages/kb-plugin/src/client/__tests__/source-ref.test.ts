/**
 * Pure source-ref helpers (E1, E2, E4 + detection/refusal predicates).
 * See change: improve-kb-settings-sources-and-search.
 */
import { describe, expect, it } from "vitest";
import { detectGitRef, looksLikeRemoteRef, refuseSource, toSourceRef } from "../source-ref.js";

describe("toSourceRef", () => {
  it("E1 a folder inside cwd is stored relative", () => {
    expect(toSourceRef("/r/p", "/r/p/docs/api")).toEqual({ ref: "docs/api", outside: false });
  });
  it("E2 cwd itself is `.`", () => {
    expect(toSourceRef("/r/p", "/r/p/")).toEqual({ ref: ".", outside: false });
  });
  it("E4 a folder outside is stored absolute and flagged (drive letter case-normalized)", () => {
    expect(toSourceRef("C:\\r\\p", "c:\\other")).toEqual({ ref: "c:\\other", outside: true });
    expect(toSourceRef("/a/b", "/a/bc")).toEqual({ ref: "/a/bc", outside: true });
  });
});

describe("detectGitRef / looksLikeRemoteRef", () => {
  it("auto-detects GitHub/GitLab/ssh/git: refs but not arbitrary https", () => {
    for (const r of ["https://github.com/o/r", "https://gitlab.com/o/r", "git@h:r", "git:h/r"]) expect(detectGitRef(r), r).toBe(true);
    expect(detectGitRef("https://example.org/x.md")).toBe(false);
    expect(detectGitRef("docs")).toBe(false);
  });
  it("flags every ref the engine would not treat as a filesystem path", () => {
    for (const r of ["https://x/y", "ssh://h/r", "git@h:r", "git:h/r", "npm:pkg"]) expect(looksLikeRemoteRef(r), r).toBe(true);
    for (const r of ["docs", "./docs", "/abs/docs", "C:\\docs"]) expect(looksLikeRemoteRef(r), r).toBe(false);
  });
});

describe("refuseSource", () => {
  it("Folder refuses remote-shaped refs (npm gets its own reason), URL needs https://, one source per ref", () => {
    expect(refuseSource("https://x/y", "filesystem", [])).toBe("remote-in-folder");
    expect(refuseSource("git@h:r", "filesystem", [])).toBe("remote-in-folder");
    expect(refuseSource("npm:pkg", "filesystem", [])).toBe("npm");
    expect(refuseSource("http://h/a.md", "https", [])).toBe("https-only");
    expect(refuseSource("docs", "filesystem", ["docs"])).toBe("duplicate");
    expect(refuseSource("notes", "filesystem", ["docs"])).toBeNull();
    expect(refuseSource("https://h/r.git", "git", [])).toBeNull();
  });
});
