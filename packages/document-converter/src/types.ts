/** Facade option + result types. */
import type { DocType, NanoBananaConfig, Provenance } from "./schema.js";

/** OCR engines bundled in the image. */
export type OcrEngine = "easyocr" | "tesseract" | "rapidocr" | "ocrmac";

/** OCR run mode. `auto` = native-first; `force` = full-page OCR; `off` = none. */
export type OcrMode = "auto" | "force" | "off";

/**
 * Per-convert OCR config. `lang` carries CANONICAL language names
 * (e.g. `"hungarian"`); the facade maps them to per-engine codes before the
 * engine sees them, so a wrong code can never silently produce empty output.
 */
export interface OcrOptions {
  mode?: OcrMode;
  lang?: string[];
  engine?: OcrEngine;
}

/** Options for ingest (any format -> Markdown). */
export interface ConvertToMarkdownOptions {
  /** Where the staging `.md` is written. Defaults under the staging dir. */
  output?: string;
  ocr?: OcrOptions;
  /** `off` disables TableFormer (huge-PDF hang escape hatch). Default `on`. */
  tables?: "on" | "off";
}

/** Result of an ingest run. */
export interface ConvertToMarkdownResult {
  /** Path to the staging `.md` with provenance frontmatter. */
  output: string;
  provenance: Provenance;
}

/** Options for Markdown -> DOCX. */
export interface RenderDocxOptions {
  output: string;
  template?: string;
  templatesDir?: string;
  language?: string;
  nanoBanana?: NanoBananaConfig;
  /** Diagram cache dir (`.mermaid-cache`); defaults beside the input. */
  cacheDir?: string;
}

/** Options for Markdown|DOCX -> PDF. */
export interface RenderPdfOptions {
  output: string;
  pageSize?: "a4" | "letter" | "legal" | "a3" | "a5";
  template?: string;
}

/** Result carrying the produced artifact path. */
export interface ProduceResult {
  output: string;
}

/** Result of extracting a DOCX for editing. */
export interface ExtractResult {
  output: string;
  /** Path to `document_meta.xml` used to merge edits back. */
  meta: string;
}

/** Options for merging edited Markdown back into a DOCX. */
export interface MergeBackOptions {
  output: string;
  /** `document_meta.xml` from the prior extract; preserves formatting. */
  meta?: string;
}

/** Frontmatter-fill options (subset of the engine fill.py surface). */
export interface FillFrontmatterOptions {
  mode?: "fill" | "update" | "replace";
  config?: string;
  language?: string;
  set?: string[];
  apply?: boolean;
}

/** Table-profile options. */
export interface ProfileTablesOptions {
  apply?: boolean;
  percentile?: number;
  smoothing?: "linear" | "sqrt" | "log";
}

export type { DocType };
