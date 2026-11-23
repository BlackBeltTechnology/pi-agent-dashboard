/**
 * classifyLink: pure, offline provider/icon/label classification for chat links.
 * See change: rich-chat-links (test-plan #E1–#E4).
 */
import { mdiGithub, mdiGitlab, mdiJira, mdiLaptop, mdiLink, mdiNpm, mdiStackOverflow, mdiYoutube } from "@mdi/js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyLink } from "../classify-link.js";

describe("classifyLink — known providers by host (#E1)", () => {
  const cases: Array<[string, string]> = [
    ["https://github.com/o/r", "github"],
    ["https://gitlab.com/o/r", "gitlab"],
    ["https://acme.atlassian.net/browse/P-9", "jira"],
    ["https://youtu.be/x", "youtube"],
    ["https://www.youtube.com/watch?v=x", "youtube"],
    ["https://npmjs.com/package/p", "npm"],
    ["https://www.npmjs.com/package/p", "npm"],
    ["https://stackoverflow.com/q/1", "stackoverflow"],
    ["https://docs.google.com/d/x", "google"],
    ["https://drive.google.com/file/d/x", "google"],
    ["http://localhost:5173", "local"],
    ["http://127.0.0.1:8000/x", "local"],
    ["http://[::1]:8000/x", "local"],
    ["https://example.com", "generic"],
  ];
  it.each(cases)("%s → %s", (url, provider) => {
    expect(classifyLink(url).provider).toBe(provider);
  });

  it("gives every provider a non-empty mdi icon path", () => {
    expect(classifyLink("https://github.com/o/r").icon).toBe(mdiGithub);
    expect(classifyLink("https://gitlab.com/o/r").icon).toBe(mdiGitlab);
    expect(classifyLink("https://acme.atlassian.net/browse/P-9").icon).toBe(mdiJira);
    expect(classifyLink("https://youtu.be/x").icon).toBe(mdiYoutube);
    expect(classifyLink("https://npmjs.com/package/p").icon).toBe(mdiNpm);
    expect(classifyLink("https://stackoverflow.com/q/1").icon).toBe(mdiStackOverflow);
    expect(classifyLink("http://localhost:5173").icon).toBe(mdiLaptop);
    expect(classifyLink("https://example.com").icon).toBe(mdiLink);
    expect(classifyLink("https://docs.google.com/d/x").icon.length).toBeGreaterThan(0);
  });

  it("matches a dot-boundary subdomain suffix", () => {
    expect(classifyLink("https://www.github.com/o/r").provider).toBe("github");
    expect(classifyLink("https://gist.github.com/o/r").provider).toBe("github");
  });

  it("a JIRA host without a /browse/<KEY>-<n> path is not JIRA", () => {
    expect(classifyLink("https://acme.atlassian.net/wiki/spaces/X").provider).toBe("generic");
  });
});

describe("classifyLink — look-alike and credentialed hosts (#E2)", () => {
  it.each([
    "https://github.com.evil.example/o/r",
    "https://evilgithub.com/o/r",
    "https://github.com@evil.com/o/r",
    "https://acme.atlassian.net.evil.io/browse/PROJ-1",
    "https://localhost.evil.com/x",
  ])("%s is generic", (url) => {
    const r = classifyLink(url);
    expect(r.provider).toBe("generic");
    expect(r.label).toBe(url);
  });
});

describe("classifyLink — recognised URL shapes get a short label (#E3)", () => {
  const cases: Array<[string, string]> = [
    ["https://github.com/o/r/pull/123", "o/r#123"],
    ["https://github.com/o/r/issues/7", "o/r#7"],
    ["https://github.com/o/r", "o/r"],
    ["https://github.com/o/r/blob/main/src/a.ts", "o/r: a.ts"],
    ["https://gitlab.com/o/r/-/merge_requests/5", "o/r#5"],
    ["https://acme.atlassian.net/browse/PROJ-9", "PROJ-9 (acme)"],
    ["https://npmjs.com/package/@s/p", "@s/p"],
    ["https://www.npmjs.com/package/left-pad", "left-pad"],
  ];
  it.each(cases)("%s → %s", (url, label) => {
    expect(classifyLink(url).label).toBe(label);
  });

  it.each([
    "https://example.com/docs/page",
    "http://localhost:50452/board.html",
    "https://github.com/o/r/actions",
  ])("%s keeps its full URL text", (url) => {
    expect(classifyLink(url).label).toBe(url);
  });
});

describe("classifyLink — pure and offline (#E4)", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    "https://[bad",
    "https://",
    "",
    `https://example.com/${"a".repeat(10_000)}`,
    "javascript:alert(1)",
  ])("never throws and falls back to generic with the original text (%#)", (input) => {
    const r = classifyLink(input);
    expect(r.provider).toBe("generic");
    expect(r.label).toBe(input);
  });

  it("returns deep-equal results for the same input and never fetches", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const a = classifyLink("https://github.com/o/r/pull/123");
      const b = classifyLink("https://github.com/o/r/pull/123");
      expect(a).toEqual(b);
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
