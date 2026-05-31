/**
 * Tests for `dispatchPreview` and `RENDERER_BY_EXT`. See change:
 * render-file-previews.
 */
import { describe, it, expect } from "vitest";
import { dispatchPreview, RENDERER_BY_EXT } from "../preview-dispatch.js";

const f = (path: string) => ({ kind: "file" as const, cwd: "/x", path });
const u = (url: string) => ({ kind: "url" as const, url });

describe("dispatchPreview — file targets", () => {
  it("maps markdown extensions", () => {
    expect(dispatchPreview(f("a.md"))).toBe("markdown");
    expect(dispatchPreview(f("a.markdown"))).toBe("markdown");
    expect(dispatchPreview(f("A.MD"))).toBe("markdown");
  });

  it("maps asciidoc extensions", () => {
    expect(dispatchPreview(f("doc.adoc"))).toBe("asciidoc");
    expect(dispatchPreview(f("doc.asciidoc"))).toBe("asciidoc");
    expect(dispatchPreview(f("DOC.AsciiDoc"))).toBe("asciidoc");
  });

  it("maps PDF", () => {
    expect(dispatchPreview(f("paper.pdf"))).toBe("pdf");
  });

  it("maps video extensions", () => {
    expect(dispatchPreview(f("c.mp4"))).toBe("video");
    expect(dispatchPreview(f("c.webm"))).toBe("video");
    expect(dispatchPreview(f("c.mov"))).toBe("video");
  });

  it("maps image extensions", () => {
    for (const e of [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]) {
      expect(dispatchPreview(f(`img${e}`))).toBe("image");
    }
  });

  it("maps html extensions", () => {
    expect(dispatchPreview(f("x.html"))).toBe("html");
    expect(dispatchPreview(f("x.htm"))).toBe("html");
  });

  it("falls back on unknown file extension", () => {
    expect(dispatchPreview(f("x.dat"))).toBe("fallback");
    expect(dispatchPreview(f("noext"))).toBe("fallback");
  });

  it("covers every entry of RENDERER_BY_EXT", () => {
    for (const [ext, kind] of Object.entries(RENDERER_BY_EXT)) {
      expect(dispatchPreview(f(`x${ext}`))).toBe(kind);
    }
  });
});

describe("dispatchPreview — URL targets", () => {
  it("maps YouTube hosts to youtube", () => {
    for (const url of [
      "https://youtube.com/watch?v=abc",
      "https://www.youtube.com/watch?v=abc",
      "https://m.youtube.com/watch?v=abc",
      "https://youtu.be/abc",
    ]) {
      expect(dispatchPreview(u(url))).toBe("youtube");
    }
  });

  it("dispatches by URL extension when host is unknown", () => {
    expect(dispatchPreview(u("https://example.com/spec.pdf"))).toBe("pdf");
    expect(dispatchPreview(u("https://example.com/clip.mp4"))).toBe("video");
    expect(dispatchPreview(u("https://example.com/img.png?x=1"))).toBe("image");
  });

  it("falls back on unknown URL with no known extension", () => {
    expect(dispatchPreview(u("https://example.com/foo"))).toBe("fallback");
  });

  it("falls back on malformed URL", () => {
    expect(dispatchPreview(u("not a url"))).toBe("fallback");
  });
});
