import { describe, expect, it } from "vitest";
import { fileKind, IMAGE_EXTENSIONS, TEXT_EXTENSIONS } from "../file-kind.js";

const CWD = "/Users/u/proj";
const abs = (rel: string) => `${CWD}/${rel}`;

describe("fileKind", () => {
  it("routes text/code allowlist extensions to monaco", () => {
    for (const ext of TEXT_EXTENSIONS) {
      const r = fileKind(abs(`file${ext}`));
      expect(r.viewer, ext).toBe("monaco");
      expect(r.kind, ext).toBe("text");
      expect(r.editable).toBe(false);
    }
  });

  it("routes image allowlist extensions to the image viewer", () => {
    for (const ext of IMAGE_EXTENSIONS) {
      const r = fileKind(abs(`pic${ext}`));
      expect(r.viewer, ext).toBe("image");
      expect(r.kind, ext).toBe("image");
    }
  });

  it("routes .pdf to the pdf viewer", () => {
    const r = fileKind(abs("doc.pdf"));
    expect(r).toMatchObject({ kind: "pdf", viewer: "pdf", mimeType: "application/pdf" });
  });

  it("routes .html/.htm to the html viewer (not monaco source)", () => {
    for (const ext of [".html", ".htm"]) {
      const r = fileKind(abs(`page${ext}`));
      expect(r.viewer, ext).toBe("html");
      expect(r.kind, ext).toBe("html");
      expect(r.mimeType, ext).toBe("text/html");
    }
  });

  it("routes .mmd/.mermaid to the mermaid viewer", () => {
    for (const ext of [".mmd", ".mermaid"]) {
      const r = fileKind(abs(`chart${ext}`));
      expect(r.viewer, ext).toBe("mermaid");
      expect(r.kind, ext).toBe("mermaid");
    }
  });

  it("routes audio extensions to the audio viewer", () => {
    for (const ext of [".mp3", ".wav", ".ogg", ".m4a", ".flac"]) {
      const r = fileKind(abs(`sound${ext}`));
      expect(r.viewer, ext).toBe("audio");
      expect(r.kind, ext).toBe("audio");
    }
  });

  it("routes video extensions to the video viewer", () => {
    for (const ext of [".mp4", ".webm", ".mov"]) {
      const r = fileKind(abs(`clip${ext}`));
      expect(r.viewer, ext).toBe("video");
      expect(r.kind, ext).toBe("video");
    }
  });

  it("overrides monaco with markdown for .md / .mdx", () => {
    expect(fileKind(abs("README.md")).viewer).toBe("markdown");
    expect(fileKind(abs("doc.mdx")).viewer).toBe("markdown");
    expect(fileKind(abs("README.md")).kind).toBe("markdown");
  });

  it("marks the writable markdown subset (.md/.mdx) editable, others read-only", () => {
    expect(fileKind(abs("README.md")).editable).toBe(true);
    expect(fileKind(abs("doc.mdx")).editable).toBe(true);
    // .markdown renders but stays read-only (mirrors the write guard).
    expect(fileKind(abs("notes.markdown")).editable).toBe(false);
    // Non-markdown viewers remain read-only.
    expect(fileKind(abs("src/foo.ts")).editable).toBe(false);
    expect(fileKind(abs("pic.png")).editable).toBe(false);
  });

  it("classifies a known TS file with the expected mimeType", () => {
    const r = fileKind(abs("src/foo.ts"));
    expect(r).toEqual({
      kind: "text",
      viewer: "monaco",
      mimeType: "text/x.typescript",
      editable: false,
    });
  });

  it("promotes an unknown extension to binary when sniff has a NUL byte", () => {
    const sniff = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]);
    const r = fileKind(abs("bin/myhelper"), sniff);
    expect(r).toMatchObject({ kind: "binary", viewer: "binary-warn", editable: false });
  });

  it("defaults an unknown extension without sniff to monaco/unknown", () => {
    const r = fileKind(abs("bin/myhelper"));
    expect(r).toMatchObject({ kind: "unknown", viewer: "monaco" });
  });

  it("extension match wins over a binary-looking sniff", () => {
    // A .ts file whose sniff happens to contain a NUL still classifies as text.
    const r = fileKind(abs("foo.ts"), "abc\0def");
    expect(r.viewer).toBe("monaco");
    expect(r.kind).toBe("text");
  });

  it("treats dotfiles as having no extension", () => {
    expect(fileKind(abs(".gitignore")).kind).toBe("unknown");
  });

  it("accepts a string sniff and detects NUL", () => {
    expect(fileKind(abs("data.xyz"), "ab\0cd").kind).toBe("binary");
    expect(fileKind(abs("data.xyz"), "plain text").kind).toBe("unknown");
  });

  it("throws when given a relative path", () => {
    expect(() => fileKind("src/foo.ts")).toThrow(/absolute path/);
  });

  it("accepts Windows absolute paths", () => {
    expect(fileKind("C:\\Users\\u\\proj\\foo.ts").viewer).toBe("monaco");
  });

  it("is pure — identical inputs give identical output", () => {
    expect(fileKind(abs("a.json"))).toEqual(fileKind(abs("a.json")));
  });

  // --- Rich office / document / email kinds (change: open-view-command-in-editor-pane) ---

  it("E1 classifies .docx as the docx viewer with the office MIME", () => {
    const r = fileKind(abs("report.docx"));
    expect(r).toMatchObject({
      kind: "docx",
      viewer: "docx",
      editable: false,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  });

  it("E2 classifies .pptx as the pptx viewer", () => {
    expect(fileKind(abs("deck.pptx"))).toMatchObject({
      kind: "pptx",
      viewer: "pptx",
      editable: false,
    });
  });

  it("E3 classifies .xlsx as spreadsheet, NOT editable", () => {
    expect(fileKind(abs("book.xlsx"))).toMatchObject({
      kind: "spreadsheet",
      viewer: "spreadsheet",
      editable: false,
    });
    // .xls too
    expect(fileKind(abs("legacy.xls"))).toMatchObject({ kind: "spreadsheet", editable: false });
  });

  it("E4 classifies .csv as spreadsheet, editable", () => {
    expect(fileKind(abs("data.csv"))).toMatchObject({
      kind: "spreadsheet",
      viewer: "spreadsheet",
      editable: true,
    });
  });

  it("E5 classifies .adoc and .asciidoc as the asciidoc viewer", () => {
    for (const ext of [".adoc", ".asciidoc"]) {
      expect(fileKind(abs(`doc${ext}`)), ext).toMatchObject({
        kind: "asciidoc",
        viewer: "asciidoc",
        editable: false,
      });
    }
  });

  it("E6 classifies .eml as the email viewer with the rfc822 MIME", () => {
    expect(fileKind(abs("mail.eml"))).toMatchObject({
      kind: "email",
      viewer: "email",
      editable: false,
      mimeType: "message/rfc822",
    });
  });

  it("E7 is case-insensitive on the rich extensions", () => {
    expect(fileKind(abs("MAIL.EML"))).toEqual(fileKind(abs("mail.eml")));
    expect(fileKind(abs("REPORT.DOCX"))).toEqual(fileKind(abs("report.docx")));
  });

  it("E8 classifies .eml by extension even when sniff has a NUL byte", () => {
    const r = fileKind(abs("mail.eml"), Buffer.from([0x00, 0x01, 0x02]));
    expect(r).toMatchObject({ kind: "email", viewer: "email" });
  });

  it("E9 .csv left TEXT_EXTENSIONS — spreadsheet, not monaco", () => {
    expect(TEXT_EXTENSIONS.has(".csv")).toBe(false);
    expect(fileKind(abs("data.csv")).viewer).toBe("spreadsheet");
  });
});
