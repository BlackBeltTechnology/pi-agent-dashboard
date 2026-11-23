/**
 * Tests for `dispatchPreview` and `RENDERER_BY_EXT`. See change:
 * render-file-previews.
 */
import {
  rendererKindForPath,
  RENDERER_BY_EXT as SHARED_RENDERER_BY_EXT,
} from "@blackbelt-technology/pi-dashboard-shared/renderer-by-ext.js";
import { describe, expect, it } from "vitest";
import { dispatchPreview, RENDERER_BY_EXT } from "../preview/preview-dispatch.js";

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

  it("maps pptx (test-plan #1, #2)", () => {
    expect(dispatchPreview(f("deck.pptx"))).toBe("pptx");
    expect(dispatchPreview(f("DECK.PPTX"))).toBe("pptx"); // ext lowercased
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

  // test-plan #E8 — .puml, .plantuml (case-insensitive) map to diagram
  it("maps .puml, .PUML, .plantuml to diagram (test-plan #E8)", () => {
    expect(dispatchPreview(f("x.puml"))).toBe("diagram");
    expect(dispatchPreview(f("X.PUML"))).toBe("diagram");
    expect(dispatchPreview(f("y.plantuml"))).toBe("diagram");
  });

  // test-plan #4 — unknown extension stays fallback (regression guard).
  it("maps .dat to fallback (test-plan #4)", () => {
    expect(dispatchPreview(f("blob.dat"))).toBe("fallback");
  });

  it("falls back on unknown file extension (test-plan #5)", () => {
    expect(dispatchPreview(f("x.dat"))).toBe("fallback");
    expect(dispatchPreview(f("noext"))).toBe("fallback");
  });

  it("a URL target ending .pptx is a web page (file-only kind; test-plan #6.3, #E25)", () => {
    // `pptx` renders file targets only, so a URL ending .pptx maps to `webpage` (rich-chat-links D11).
    expect(dispatchPreview(u("https://example.com/slides.pptx"))).toBe("webpage");
  });

  it("a URL target ending .docx is a web page (file-only kind; test-plan #6, #E25)", () => {
    // `docx` renders file targets only, so a URL ending .docx maps to `webpage` (rich-chat-links D11).
    expect(dispatchPreview(u("https://example.com/report.docx"))).toBe("webpage");
  });

  it("covers every entry of RENDERER_BY_EXT", () => {
    for (const [ext, kind] of Object.entries(RENDERER_BY_EXT)) {
      expect(dispatchPreview(f(`x${ext}`))).toBe(kind);
    }
  });
});

// S6 (test-plan): the client dispatch and the shared detector table are ONE
// source of truth — same table object, identical kind per extension, and the
// client consumes the shared module (no parallel copy, no cross-package import
// of client code into shared).
describe("S6 — shared RENDERER_BY_EXT is the single source of truth", () => {
  it("client re-exports the very same shared table object", () => {
    expect(RENDERER_BY_EXT).toBe(SHARED_RENDERER_BY_EXT);
  });

  it("client dispatchPreview and shared rendererKindForPath agree for every ext", () => {
    for (const [ext, kind] of Object.entries(SHARED_RENDERER_BY_EXT)) {
      const path = `report${ext}`;
      expect(rendererKindForPath(path)).toBe(kind);
      expect(dispatchPreview(f(path))).toBe(kind);
      expect(dispatchPreview(f(path))).toBe(rendererKindForPath(path));
    }
  });

  it("both classifiers fall back identically on an unknown extension", () => {
    expect(rendererKindForPath("x.dat")).toBe("fallback");
    expect(dispatchPreview(f("x.dat"))).toBe("fallback");
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

  it("maps an extensionless http(s) URL to webpage", () => {
    expect(dispatchPreview(u("https://example.com/foo"))).toBe("webpage");
  });

  it("falls back on a non-http(s) URL", () => {
    expect(dispatchPreview(u("ftp://example.com/foo"))).toBe("fallback");
  });

  // test-plan #E25 — dispatch is purely shape-based; framing is the renderer's decision.
  it("E25: URL targets map by shape; file-only kinds are webpage for URLs", () => {
    const cases: Array<[ReturnType<typeof f> | ReturnType<typeof u>, string]> = [
      [u("https://example.com/docs"), "webpage"],
      [u("https://example.com/index.html"), "webpage"],
      [u("https://example.com/README.md"), "webpage"],
      [u("https://example.com/clip.mp4"), "video"],
      [u("https://example.com/a.png"), "image"],
      [u("https://example.com/doc.pdf"), "pdf"],
      [u("https://example.com/song.mp3"), "audio"],
      [u("https://youtu.be/x"), "youtube"],
      [f("x.dat"), "fallback"],
    ];
    for (const [target, kind] of cases) expect(dispatchPreview(target)).toBe(kind);
  });

  it("falls back on malformed URL", () => {
    expect(dispatchPreview(u("not a url"))).toBe("fallback");
  });
});
