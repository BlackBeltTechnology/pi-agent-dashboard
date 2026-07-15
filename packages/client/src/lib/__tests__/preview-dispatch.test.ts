/**
 * Tests for `dispatchPreview` and `RENDERER_BY_EXT`. See change:
 * render-file-previews.
 */
import { describe, expect, it } from "vitest";
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

  it("maps docx (test-plan #1, #2)", () => {
    expect(dispatchPreview(f("spec.docx"))).toBe("docx");
    expect(dispatchPreview(f("SPEC.DOCX"))).toBe("docx"); // ext lowercased
  });

  it("maps spreadsheets: xlsx + csv (test-plan #3, #4)", () => {
    expect(dispatchPreview(f("data.xlsx"))).toBe("spreadsheet");
    expect(dispatchPreview(f("export.csv"))).toBe("spreadsheet");
  });

  it("maps video extensions", () => {
    expect(dispatchPreview(f("c.mp4"))).toBe("video");
    expect(dispatchPreview(f("c.webm"))).toBe("video");
    expect(dispatchPreview(f("c.mov"))).toBe("video");
  });

  it("maps audio extensions", () => {
    for (const e of [".mp3", ".wav", ".ogg", ".m4a", ".flac"]) {
      expect(dispatchPreview(f(`a${e}`)), e).toBe("audio");
    }
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

  // test-plan #1 / #2 — .eml dispatches to the email renderer, ext lowercased.
  it("maps .eml to email (test-plan #1)", () => {
    expect(dispatchPreview(f("mail.eml"))).toBe("email");
  });

  it("maps upper-case .EML to email via lowercased ext (test-plan #2)", () => {
    expect(dispatchPreview(f("Mail.EML"))).toBe("email");
  });

  // test-plan #4 — unknown extension stays fallback (regression guard).
  it("maps .dat to fallback (test-plan #4)", () => {
    expect(dispatchPreview(f("blob.dat"))).toBe("fallback");
  });

  it("falls back on unknown file extension (test-plan #5)", () => {
    expect(dispatchPreview(f("x.dat"))).toBe("fallback");
    expect(dispatchPreview(f("noext"))).toBe("fallback");
  });

  it("a URL target ending .docx dispatches by extension (test-plan #6)", () => {
    // dispatch itself is shape-based; a URL .docx maps to "docx", but PreviewBody
    // guards kind on target.kind !== "file" and falls back (covered there).
    expect(dispatchPreview(u("https://example.com/report.docx"))).toBe("docx");
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
