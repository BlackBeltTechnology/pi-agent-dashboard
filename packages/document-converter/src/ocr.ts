/**
 * Canonical language name -> per-engine OCR code.
 *
 * The facade takes canonical names (`"hungarian"`) and maps to the code each
 * engine expects (EasyOCR `hu` vs Tesseract `hun`). An unsupported name/engine
 * combo raises a typed error rather than silently producing empty OCR.
 */
import { DocConverterError } from "./errors.js";
import type { OcrEngine } from "./types.js";

/** canonical name -> { engine -> code }. Extend as languages are needed. */
const LANG_CODES: Record<string, Partial<Record<OcrEngine, string>>> = {
  english: { easyocr: "en", tesseract: "eng", ocrmac: "en-US" },
  hungarian: { easyocr: "hu", tesseract: "hun", ocrmac: "hu-HU" },
  german: { easyocr: "de", tesseract: "deu", ocrmac: "de-DE" },
  french: { easyocr: "fr", tesseract: "fra", ocrmac: "fr-FR" },
  spanish: { easyocr: "es", tesseract: "spa", ocrmac: "es-ES" },
  italian: { easyocr: "it", tesseract: "ita", ocrmac: "it-IT" },
};

/**
 * Map canonical language names to per-engine codes for the given engine.
 * RapidOCR ignores language codes (returns `[]`). Throws `OCR_LANG_UNSUPPORTED`
 * for any name the engine cannot serve.
 */
export function mapOcrCodes(langs: string[], engine: OcrEngine): string[] {
  if (engine === "rapidocr") return [];
  return langs.map((raw) => {
    const name = raw.trim().toLowerCase();
    const entry = LANG_CODES[name];
    const code = entry?.[engine];
    if (!code) {
      throw new DocConverterError({
        code: "OCR_LANG_UNSUPPORTED",
        message: `language "${raw}" is not supported by OCR engine "${engine}"`,
      });
    }
    return code;
  });
}

/** Canonical names known to the mapper (for validation / docs). */
export const SUPPORTED_LANGUAGES = Object.keys(LANG_CODES);
