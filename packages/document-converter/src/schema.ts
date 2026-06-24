/**
 * Unified document-frontmatter schema — the shared bus.
 *
 * ONE YAML frontmatter contract read/written by every stage:
 *  - frontmatter-filler WRITES template vars (project_name, author, toc_heading, language, logos, document_id, ...)
 *  - markdown-table-profiler WRITES `table_profiles`
 *  - document_converter (produce) READS vars + `nano_banana` + `table_profiles` + toc/cover flags
 *  - ingest WRITES `provenance` (source_path, sha256, doc_type, converted_at, page/slide)
 *  - kb READS `provenance` to trace chunks back to origin
 *
 * Defined first because it is expensive to change later. The JSON Schema mirror
 * lives at `src/schema.json`; keep both in sync.
 */

/** Diagram raster format the produce engine emits for rendered diagrams. */
export type DiagramFormat = "png" | "svg";

/** Logo placeholders resolved by the produce engine, keyed by slot name. */
export type LogoMap = Record<string, string>;

/**
 * Opt-in styled-diagram rendering. When `enabled`, each Mermaid block is
 * replaced by a cached `.mermaid-cache/<md5>.png` generated via the nano-banana
 * CLI using the named `style`. Any failure falls back to mmdc.
 */
export interface NanoBananaConfig {
  enabled: boolean;
  /** Named style from `nano-banana-styles.yaml`. */
  style?: string;
}

/**
 * One profiled table: deterministic id -> column headers + relative width
 * multipliers (mean ~ 1.0). Written by markdown-table-profiler.
 */
export interface TableProfile {
  columns: string[];
  widths: number[];
}

/** `table_profiles` block: profile-id -> profile. Id form: `tbl_<hash>_<lang>`. */
export type TableProfiles = Record<string, TableProfile>;

/** Document type for provenance — drives ingest routing + kb tracing. */
export type DocType = "pdf" | "docx" | "pptx" | "xlsx" | "md";

/**
 * Ingest-written provenance. Lets kb chunks trace back to the originating file.
 * `page`/`slide` present only where the source format has them.
 */
export interface Provenance {
  source_path: string;
  sha256: string;
  doc_type: DocType;
  /** ISO-8601 timestamp of the conversion run. */
  converted_at: string;
  page?: number;
  slide?: number;
}

/**
 * Template/branding variables consumed by the produce engine. Written by
 * frontmatter-filler (defaults -> language pack -> glob override -> CLI).
 * Open set: the engine tolerates extra string vars, so this is non-exhaustive.
 */
export interface TemplateVars {
  template?: string;
  document_id?: string;
  document_type?: string;
  document_title?: string;
  document_name?: string;
  project_name?: string;
  project_description?: string;
  author?: string;
  client_name?: string;
  company_info?: string;
  contact_info?: string;
  version?: string;
  /** Canonical language code (`en`, `hu`, `de`, ...). Drives language pack. */
  language?: string;
  toc_heading?: string;
  enable_cover_page?: boolean;
  enable_toc?: boolean;
  logos?: LogoMap;
  diagram_format?: DiagramFormat;
  diagram_width?: number;
  diagram_scale?: number;
}

/**
 * The unified frontmatter document. Every field is optional because each stage
 * fills only its slice; downstream stages read what they need.
 */
export interface DocumentFrontmatter extends TemplateVars {
  nano_banana?: NanoBananaConfig;
  table_profiles?: TableProfiles;
  provenance?: Provenance;
}

/** Frontmatter keys the ingest stage owns. */
export const PROVENANCE_KEY = "provenance" as const;

/** Frontmatter keys the table profiler owns. */
export const TABLE_PROFILES_KEY = "table_profiles" as const;

/** Frontmatter key the styled-diagram path reads. */
export const NANO_BANANA_KEY = "nano_banana" as const;
