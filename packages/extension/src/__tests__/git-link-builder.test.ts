import { describe, expect, it } from "vitest";
import { buildGitLinks, detectPlatform, parseRemoteUrl } from "../git-link-builder.js";

describe("parseRemoteUrl", () => {
  it("parses SSH URL", () => {
    expect(parseRemoteUrl("git@github.com:user/repo.git")).toEqual({
      host: "github.com", user: "user", repo: "repo",
    });
  });

  it("parses SSH URL without .git suffix", () => {
    expect(parseRemoteUrl("git@github.com:user/repo")).toEqual({
      host: "github.com", user: "user", repo: "repo",
    });
  });

  it("parses HTTPS URL", () => {
    expect(parseRemoteUrl("https://github.com/user/repo.git")).toEqual({
      host: "github.com", user: "user", repo: "repo",
    });
  });

  it("parses HTTPS URL without .git suffix", () => {
    expect(parseRemoteUrl("https://gitlab.com/user/repo")).toEqual({
      host: "gitlab.com", user: "user", repo: "repo",
    });
  });

  it("parses nested group paths", () => {
    expect(parseRemoteUrl("git@gitlab.com:group/subgroup/repo.git")).toEqual({
      host: "gitlab.com", user: "group/subgroup", repo: "repo",
    });
  });

  it("returns undefined for invalid URL", () => {
    expect(parseRemoteUrl("not-a-url")).toBeUndefined();
  });
});

describe("detectPlatform", () => {
  it("detects GitHub", () => expect(detectPlatform("github.com")).toBe("github"));
  it("detects GitLab", () => expect(detectPlatform("gitlab.com")).toBe("gitlab"));
  it("detects Bitbucket", () => expect(detectPlatform("bitbucket.org")).toBe("bitbucket"));
  it("detects Gitea", () => expect(detectPlatform("gitea.com")).toBe("gitea"));
  it("detects Codeberg", () => expect(detectPlatform("codeberg.org")).toBe("codeberg"));
  it("detects SourceHut", () => expect(detectPlatform("sr.ht")).toBe("sourcehut"));
  it("returns undefined for unknown host", () => expect(detectPlatform("self-hosted.example.com")).toBeUndefined());
});

describe("buildGitLinks", () => {
  it("builds GitHub branch and PR links", () => {
    const links = buildGitLinks("git@github.com:user/repo.git", "main", 42);
    expect(links.branchUrl).toBe("https://github.com/user/repo/tree/main");
    expect(links.prUrl).toBe("https://github.com/user/repo/pull/42");
  });

  it("builds GitLab branch and MR links", () => {
    const links = buildGitLinks("https://gitlab.com/user/repo.git", "main", 10);
    expect(links.branchUrl).toBe("https://gitlab.com/user/repo/-/tree/main");
    expect(links.prUrl).toBe("https://gitlab.com/user/repo/-/merge_requests/10");
  });

  it("builds Bitbucket links", () => {
    const links = buildGitLinks("git@bitbucket.org:user/repo.git", "develop", 5);
    expect(links.branchUrl).toBe("https://bitbucket.org/user/repo/src/develop");
    expect(links.prUrl).toBe("https://bitbucket.org/user/repo/pull-requests/5");
  });

  it("builds Codeberg links", () => {
    const links = buildGitLinks("https://codeberg.org/user/repo.git", "main", 3);
    expect(links.branchUrl).toBe("https://codeberg.org/user/repo/src/branch/main");
    expect(links.prUrl).toBe("https://codeberg.org/user/repo/pulls/3");
  });

  it("builds SourceHut links", () => {
    const links = buildGitLinks("git@sr.ht:user/repo.git", "main", 1);
    expect(links.branchUrl).toBe("https://sr.ht/user/repo/tree/main");
    expect(links.prUrl).toBe("https://sr.ht/user/repo/patches/1");
  });

  it("URL-encodes branch names with slashes", () => {
    const links = buildGitLinks("git@github.com:user/repo.git", "feat/my-feature");
    expect(links.branchUrl).toBe("https://github.com/user/repo/tree/feat%2Fmy-feature");
  });

  it("returns empty for unknown host", () => {
    const links = buildGitLinks("git@self-hosted.example.com:user/repo.git", "main");
    expect(links.branchUrl).toBeUndefined();
    expect(links.prUrl).toBeUndefined();
  });

  it("does not generate branch URL for detached HEAD", () => {
    const links = buildGitLinks("git@github.com:user/repo.git", "HEAD");
    expect(links.branchUrl).toBeUndefined();
  });

  it("builds branch URL without PR", () => {
    const links = buildGitLinks("git@github.com:user/repo.git", "main");
    expect(links.branchUrl).toBe("https://github.com/user/repo/tree/main");
    expect(links.prUrl).toBeUndefined();
  });
});

// See change: harden-bridge-inbound-and-discovery (test-plan BE17, BX6).
describe("BE17: remote credentials never reach a link", () => {
  const SECRET_SUBSTRINGS = ["user", "pass", "p%40ss", "ss", "tok", "secret"];
  const remotes = [
    "https://user@github.com/o/r",
    "https://user:pass@github.com/o/r",
    "https://user:p%40ss@github.com/o/r",
    "https://user:p@ss@github.com/o/r",
    "https://tok@github.com:8443/o/r",
    "https://user:pass@[::1]:8443/o/r",
    "ssh://git:secret@github.com/o/r",
    "ssh://git@github.com/o/r",
    "git@github.com:o/r.git",
    "https://github.com/o/r",
  ];
  const expectedLinks: Record<string, boolean> = {
    "https://user@github.com/o/r": true,
    "https://user:pass@github.com/o/r": true,
    "https://user:p%40ss@github.com/o/r": true,
    "https://user:p@ss@github.com/o/r": true,
    "git@github.com:o/r.git": true,
    "https://github.com/o/r": true,
  };

  for (const remote of remotes) {
    it(`${remote}: parse + links carry no credential`, () => {
      const parsed = parseRemoteUrl(remote);
      const links = buildGitLinks(remote, "main", 7);
      // values only: `ParsedRemote.user` is the repo OWNER field name, not a credential
      const blob = JSON.stringify([...Object.values(parsed ?? {}), ...Object.values(links)]);
      for (const s of SECRET_SUBSTRINGS) expect(blob, s).not.toContain(s);
      if (expectedLinks[remote]) {
        expect(links.branchUrl).toBe("https://github.com/o/r/tree/main");
        expect(links.prUrl).toBe("https://github.com/o/r/pull/7");
      }
    });
  }

  it("host, port and IPv6 brackets are preserved", () => {
    expect(parseRemoteUrl("https://tok@github.com:8443/o/r")).toEqual({ host: "github.com:8443", user: "o", repo: "r" });
    expect(parseRemoteUrl("https://user:pass@[::1]:8443/o/r")).toEqual({ host: "[::1]:8443", user: "o", repo: "r" });
  });

  it("no-userinfo forms are byte-identical to before; ssh:// still builds no link", () => {
    expect(parseRemoteUrl("https://github.com/o/r")).toEqual({ host: "github.com", user: "o", repo: "r" });
    expect(parseRemoteUrl("git@github.com:o/r.git")).toEqual({ host: "github.com", user: "o", repo: "r" });
    expect(buildGitLinks("ssh://git@github.com/o/r", "main")).toEqual({});
    expect(buildGitLinks("ssh://git:secret@github.com/o/r", "main")).toEqual({});
  });

  it("BX6: userinfo-bearing unparseable remotes build no link; junk never throws", () => {
    for (const r of ["https://user:pass@", "https://user:pass@/o/r", "ssh://:secret@"]) {
      expect(parseRemoteUrl(r)).toBeUndefined();
      expect(buildGitLinks(r, "main", 1)).toEqual({});
    }
    for (const r of ["not a url", "", "git@:o/r"]) {
      expect(() => buildGitLinks(r, "main", 1)).not.toThrow();
      expect(buildGitLinks(r, "main", 1)).toEqual({});
    }
  });
});

describe("a query / fragment token never reaches a link", () => {
  it("drops ?… and #… from the remote before parsing", () => {
    expect(parseRemoteUrl("https://github.com/o/r?access_token=SECRET")).toEqual({ host: "github.com", user: "o", repo: "r" });
    expect(JSON.stringify(buildGitLinks("https://github.com/o/r.git?token=SECRET#frag", "main", 3))).not.toContain("SECRET");
    expect(buildGitLinks("https://github.com/o/r?token=SECRET", "main").branchUrl).toBe("https://github.com/o/r/tree/main");
  });
});
