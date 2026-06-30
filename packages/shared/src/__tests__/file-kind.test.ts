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
});
