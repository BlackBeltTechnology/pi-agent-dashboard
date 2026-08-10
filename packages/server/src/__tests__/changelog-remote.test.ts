/**
 * Tests for `changelog-remote.ts`.
 *
 * All tests use mocked fetch — never hit live raw.githubusercontent.com.
 *
 * See change: read-changelog-from-github.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  deriveChangelogRawUrl,
  fetchRemoteChangelog,
} from "../changelog/changelog-remote.js";

describe("deriveChangelogRawUrl", () => {
  it("derives raw URL from string repository", () => {
    expect(deriveChangelogRawUrl("https://github.com/badlogic/pi-mono.git")).toBe(
      "https://raw.githubusercontent.com/badlogic/pi-mono/main/CHANGELOG.md",
    );
  });

  it("honours monorepo `directory` subfield", () => {
    expect(
      deriveChangelogRawUrl({
        type: "git",
        url: "git+https://github.com/badlogic/pi-mono.git",
        directory: "packages/coding-agent",
      }),
    ).toBe(
      "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/CHANGELOG.md",
    );
  });

  it("strips leading/trailing slashes from directory", () => {
    expect(
      deriveChangelogRawUrl({
        url: "https://github.com/org/repo.git",
        directory: "/packages/foo/",
      }),
    ).toBe("https://raw.githubusercontent.com/org/repo/main/packages/foo/CHANGELOG.md");
  });

  it("supports github:org/repo shorthand", () => {
    expect(deriveChangelogRawUrl("github:org/repo")).toBe(
      "https://raw.githubusercontent.com/org/repo/main/CHANGELOG.md",
    );
  });

  it("supports ssh form git@github.com:org/repo.git", () => {
    expect(deriveChangelogRawUrl("git@github.com:org/repo.git")).toBe(
      "https://raw.githubusercontent.com/org/repo/main/CHANGELOG.md",
    );
  });

  it("returns null for non-GitHub repos", () => {
    expect(deriveChangelogRawUrl("https://gitlab.com/org/repo.git")).toBeNull();
    expect(deriveChangelogRawUrl({ url: "https://bitbucket.org/x/y" })).toBeNull();
  });

  it("returns null for missing/malformed input", () => {
    expect(deriveChangelogRawUrl(undefined)).toBeNull();
    expect(deriveChangelogRawUrl(null)).toBeNull();
    expect(deriveChangelogRawUrl({})).toBeNull();
    expect(deriveChangelogRawUrl({ url: "" })).toBeNull();
    expect(deriveChangelogRawUrl(42)).toBeNull();
  });
});

describe("fetchRemoteChangelog", () => {
  let originalOffline: string | undefined;

  beforeEach(() => {
    originalOffline = process.env.PI_OFFLINE;
    delete process.env.PI_OFFLINE;
  });
  afterEach(() => {
    if (originalOffline !== undefined) process.env.PI_OFFLINE = originalOffline;
    else delete process.env.PI_OFFLINE;
    vi.restoreAllMocks();
  });

  it("returns ok with text + etag on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ etag: '"abc123"' }),
      text: async () => "# Changelog\n\n## [1.0.0] - 2026-01-01\n",
    });
    const out = await fetchRemoteChangelog(
      "https://raw.githubusercontent.com/x/y/main/CHANGELOG.md",
      { fetchImpl },
    );
    expect(out).toEqual({
      status: "ok",
      text: expect.stringContaining("[1.0.0]"),
      etag: '"abc123"',
    });
  });

  it("returns not-modified on 304", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 304,
      headers: new Headers(),
      text: async () => "",
    });
    const out = await fetchRemoteChangelog(
      "https://raw.githubusercontent.com/x/y/main/CHANGELOG.md",
      { fetchImpl, etag: '"abc123"' },
    );
    expect(out).toEqual({ status: "not-modified" });
  });

  it("sends If-None-Match when etag provided", async () => {
    let captured: Record<string, string> | undefined;
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: any) => {
      captured = init.headers as Record<string, string>;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => "ok",
      });
    });
    await fetchRemoteChangelog("https://raw.githubusercontent.com/x/y/main/CHANGELOG.md", {
      fetchImpl,
      etag: '"abc123"',
    });
    expect(captured?.["If-None-Match"]).toBe('"abc123"');
  });

  it("returns null on non-2xx (excluding 304)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () => "Not Found",
    });
    const out = await fetchRemoteChangelog(
      "https://raw.githubusercontent.com/x/y/main/CHANGELOG.md",
      { fetchImpl },
    );
    expect(out).toBeNull();
  });

  it("returns null on network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const out = await fetchRemoteChangelog(
      "https://raw.githubusercontent.com/x/y/main/CHANGELOG.md",
      { fetchImpl },
    );
    expect(out).toBeNull();
  });

  it("returns null on empty text body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => "",
    });
    expect(
      await fetchRemoteChangelog(
        "https://raw.githubusercontent.com/x/y/main/CHANGELOG.md",
        { fetchImpl },
      ),
    ).toBeNull();
  });

  it("skips fetch entirely when PI_OFFLINE is set", async () => {
    process.env.PI_OFFLINE = "1";
    const fetchImpl = vi.fn();
    const out = await fetchRemoteChangelog(
      "https://raw.githubusercontent.com/x/y/main/CHANGELOG.md",
      { fetchImpl },
    );
    expect(out).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("propagates etag null when response has no ETag header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => "ok",
    });
    const out = await fetchRemoteChangelog(
      "https://raw.githubusercontent.com/x/y/main/CHANGELOG.md",
      { fetchImpl },
    );
    expect(out).toEqual({ status: "ok", text: "ok", etag: null });
  });
});
