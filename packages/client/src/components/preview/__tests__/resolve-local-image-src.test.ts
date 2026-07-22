/**
 * Unit coverage for the browser-safe local-image resolver.
 * See change: fix-markdown-preview-relative-images (test-plan #E1–E5, #E8, #X1).
 */
import { describe, expect, it } from "vitest";
import { dirname, resolveLocalImageSrc } from "../resolve-local-image-src.js";

/** Decode the `path` query param out of a `/api/file/raw` URL. */
function pathParam(url: string): string {
  const p = new URL(url, "http://x").searchParams.get("path");
  return p ?? "";
}
function cwdParam(url: string): string {
  const c = new URL(url, "http://x").searchParams.get("cwd");
  return c ?? "";
}

describe("resolveLocalImageSrc", () => {
  it("#E1 resolves a relative sibling against dir", () => {
    const url = resolveLocalImageSrc("hero-landing.png", { cwd: "/w", dir: "/w/docs" });
    expect(url).toBe("/api/file/raw?cwd=%2Fw&path=%2Fw%2Fdocs%2Fhero-landing.png");
  });

  it("#E2 collapses ../ against dir", () => {
    const url = resolveLocalImageSrc("../assets/x.png", { cwd: "/w", dir: "/w/docs/design" });
    expect(pathParam(url!)).toBe("/w/docs/assets/x.png");
  });

  it("#E3 uses a POSIX-absolute src verbatim (not re-joined to dir)", () => {
    const url = resolveLocalImageSrc("/w/media/x.svg", { cwd: "/w", dir: "/w/docs" });
    expect(pathParam(url!)).toBe("/w/media/x.svg");
  });

  it("#E4 percent-encodes unicode + spaces, decoding back to the resolved path", () => {
    const url = resolveLocalImageSrc("kép áttekintés.png", { cwd: "/w", dir: "/w/docs" });
    expect(url).toContain("%"); // encoded in the URL
    expect(pathParam(url!)).toBe("/w/docs/kép áttekintés.png");
  });

  it("#E5 returns null for every non-local scheme / shape", () => {
    const base = { cwd: "/w", dir: "/w/docs" };
    for (const src of [
      "http://cdn/x.png",
      "https://cdn/x.png",
      "data:image/png;base64,AAA",
      "blob:https://x/abc",
      "pi-asset:deadbeef",
      "file:///x.png",
      "cid:part1",
      "mailto:a@b.c",
      "//cdn/x.png",
      "#frag",
    ]) {
      expect(resolveLocalImageSrc(src, base)).toBeNull();
    }
  });

  it("#X1 does NOT client-sanitize a traversal src — still returns a rawUrl (server 403 is the defense)", () => {
    const url = resolveLocalImageSrc("../../../etc/passwd.png", { cwd: "/w", dir: "/w/docs" });
    expect(url).not.toBeNull();
    expect(url!.startsWith("/api/file/raw?")).toBe(true);
    expect(cwdParam(url!)).toBe("/w");
  });
});

describe("dirname", () => {
  it('#E8 returns "" for a bare filename and the parent for a nested path', () => {
    expect(dirname("readme.md")).toBe("");
    expect(dirname("a/b/n.md")).toBe("a/b");
  });
});
