import { describe, expect, it } from "vitest";
import { docTypeOf, ingestDocType, isIngestable } from "../routing.js";
import { DocConverterError } from "../errors.js";

describe("routing", () => {
  it("maps known extensions to doc types", () => {
    expect(docTypeOf("/a/b.pdf")).toBe("pdf");
    expect(docTypeOf("/a/b.DOCX")).toBe("docx");
    expect(docTypeOf("report.pptx")).toBe("pptx");
    expect(docTypeOf("sheet.xlsx")).toBe("xlsx");
    expect(docTypeOf("notes.md")).toBe("md");
    expect(docTypeOf("notes.markdown")).toBe("md");
  });

  it("throws UNSUPPORTED_FORMAT for unknown extensions", () => {
    expect(() => docTypeOf("/a/b.txt")).toThrowError(DocConverterError);
    try {
      docTypeOf("/a/b");
    } catch (e) {
      expect((e as DocConverterError).code).toBe("UNSUPPORTED_FORMAT");
    }
  });

  it("classifies ingestable formats", () => {
    expect(isIngestable("a.pdf")).toBe(true);
    expect(isIngestable("a.docx")).toBe(true);
    expect(isIngestable("a.md")).toBe(false); // md is not ingested, it IS the target
    expect(isIngestable("a.txt")).toBe(false);
  });

  it("ingestDocType rejects markdown", () => {
    expect(ingestDocType("a.pdf")).toBe("pdf");
    try {
      ingestDocType("a.md");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as DocConverterError).code).toBe("UNSUPPORTED_FORMAT");
    }
  });
});
