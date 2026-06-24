/**
 * document-converter facade — the ONLY call surface.
 *
 * Callers never touch Python, docling, pandoc, or the nano-banana CLI. Every
 * method orchestrates the Dockerized engine and returns a typed result or
 * rejects with a `DocConverterError`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { runEngine, type EngineConfig } from "./engine.js";
import { mapOcrCodes } from "./ocr.js";
import { ingestDocType } from "./routing.js";
import {
  buildProvenance,
  sha256File,
  stampProvenance,
} from "./provenance.js";
import type {
  ConvertToMarkdownOptions,
  ConvertToMarkdownResult,
  ExtractResult,
  FillFrontmatterOptions,
  MergeBackOptions,
  ProduceResult,
  ProfileTablesOptions,
  RenderDocxOptions,
  RenderPdfOptions,
} from "./types.js";

export interface DocumentConverterConfig {
  /** Image tag, e.g. `pi-doc-engine:0.1.0`. */
  image: string;
  /** Staging dir where ingest writes `.md` for kb. Created on demand. */
  stagingDir: string;
  /** Extra host dirs to bind-mount path-identically. */
  mounts?: string[];
  /** Test hook: inject the engine config (e.g. a fake runner). */
  engine?: Partial<EngineConfig>;
}

/** Build a facade bound to one image + staging dir. */
export function createDocumentConverter(config: DocumentConverterConfig) {
  const engineCfg = (extraMounts: string[] = []): EngineConfig => ({
    image: config.image,
    mounts: [config.stagingDir, ...(config.mounts ?? []), ...extraMounts],
    ...config.engine,
  });

  return {
    /** Ingest any supported format -> provenance-stamped Markdown for kb. */
    async convertToMarkdown(
      input: string,
      opts: ConvertToMarkdownOptions = {},
    ): Promise<ConvertToMarkdownResult> {
      const docType = ingestDocType(input);
      const ocr = opts.ocr ?? {};
      const engine = ocr.engine ?? "easyocr";
      const codes = ocr.lang ? mapOcrCodes(ocr.lang, engine) : [];

      const { markdown } = await runEngine<{ markdown: string }>(engineCfg(), {
        command: "convertToMarkdown",
        input,
        ocr: { mode: ocr.mode ?? "auto", engine, codes },
        tables: opts.tables ?? "on",
      });

      // Provenance is written on the TS side (task 3.3) so kb can trace chunks.
      const sha256 = await sha256File(input);
      const provenance = buildProvenance({ sourcePath: input, sha256, docType });
      const body = stampProvenance(markdown, provenance);

      await mkdir(config.stagingDir, { recursive: true });
      const output =
        opts.output ?? join(config.stagingDir, replaceExt(basename(input), ".md"));
      await writeFile(output, body, "utf-8");
      return { output, provenance };
    },

    /** Markdown -> templated DOCX (TOC, cover, diagrams from frontmatter). */
    async renderDocx(input: string, opts: RenderDocxOptions): Promise<ProduceResult> {
      return runEngine<ProduceResult>(engineCfg(), {
        command: "renderDocx",
        input,
        output: opts.output,
        template: opts.template,
        templatesDir: opts.templatesDir,
        language: opts.language,
        nano_banana: opts.nanoBanana,
        cacheDir: opts.cacheDir,
      });
    },

    /** Markdown|DOCX -> PDF (pandoc/Gotenberg path). */
    async renderPdf(input: string, opts: RenderPdfOptions): Promise<ProduceResult> {
      return runEngine<ProduceResult>(engineCfg(), {
        command: "renderPdf",
        input,
        output: opts.output,
        pageSize: opts.pageSize,
        template: opts.template,
      });
    },

    /** DOCX -> editable Markdown + `document_meta.xml` for round-trip. */
    async extractForEdit(input: string, output: string): Promise<ExtractResult> {
      return runEngine<ExtractResult>(engineCfg(), {
        command: "extractForEdit",
        input,
        output,
      });
    },

    /** Merge edited Markdown back into a DOCX, preserving formatting. */
    async mergeBack(
      original: string,
      edited: string,
      opts: MergeBackOptions,
    ): Promise<ProduceResult> {
      return runEngine<ProduceResult>(engineCfg(), {
        command: "mergeBack",
        original,
        edited,
        output: opts.output,
        meta: opts.meta,
      });
    },

    /** Fill/refresh YAML frontmatter across Markdown files. */
    async fillFrontmatter(
      paths: string[],
      opts: FillFrontmatterOptions = {},
    ): Promise<void> {
      await runEngine(engineCfg(), {
        command: "fillFrontmatter",
        paths,
        mode: opts.mode,
        config: opts.config,
        language: opts.language,
        set: opts.set,
        apply: opts.apply ?? true,
      });
    },

    /** Inject `table_profiles:` width ratios into frontmatter. */
    async profileTables(
      paths: string[],
      opts: ProfileTablesOptions = {},
    ): Promise<void> {
      await runEngine(engineCfg(), {
        command: "profileTables",
        paths,
        apply: opts.apply ?? true,
        percentile: opts.percentile,
        smoothing: opts.smoothing,
      });
    },
  };
}

/** The facade instance type. */
export type DocumentConverter = ReturnType<typeof createDocumentConverter>;

function replaceExt(name: string, ext: string): string {
  return name.replace(/\.[^.]+$/, "") + ext;
}

export { DocConverterError } from "./errors.js";
export type { DocConverterErrorCode } from "./errors.js";
export * from "./types.js";
export type {
  DocumentFrontmatter,
  Provenance,
  NanoBananaConfig,
  TableProfiles,
  TableProfile,
} from "./schema.js";
export { mapOcrCodes, SUPPORTED_LANGUAGES } from "./ocr.js";
export { docTypeOf, isIngestable, ingestDocType } from "./routing.js";
export { buildProvenance, stampProvenance, provenanceFrontmatter, sha256File } from "./provenance.js";
