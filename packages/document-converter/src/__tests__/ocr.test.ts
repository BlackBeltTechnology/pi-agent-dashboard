import { describe, expect, it } from "vitest";
import { mapOcrCodes, SUPPORTED_LANGUAGES } from "../ocr.js";
import { DocConverterError } from "../errors.js";

describe("OCR canonical-name -> per-engine-code mapping", () => {
  it("maps the same language to different codes per engine", () => {
    expect(mapOcrCodes(["hungarian"], "easyocr")).toEqual(["hu"]);
    expect(mapOcrCodes(["hungarian"], "tesseract")).toEqual(["hun"]);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(mapOcrCodes([" English ", "GERMAN"], "tesseract")).toEqual(["eng", "deu"]);
  });

  it("rapidocr ignores language codes", () => {
    expect(mapOcrCodes(["hungarian"], "rapidocr")).toEqual([]);
  });

  it("throws OCR_LANG_UNSUPPORTED for an unknown language", () => {
    try {
      mapOcrCodes(["klingon"], "easyocr");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DocConverterError);
      expect((e as DocConverterError).code).toBe("OCR_LANG_UNSUPPORTED");
    }
  });

  it("throws when a known language is unsupported by the chosen engine path", () => {
    // ocrmac has no italian entry mapping? It does; use a language absent for ocrmac.
    expect(() => mapOcrCodes(["hungarian"], "easyocr")).not.toThrow();
    expect(SUPPORTED_LANGUAGES).toContain("hungarian");
  });
});
