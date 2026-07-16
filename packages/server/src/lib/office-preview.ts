/**
 * Office-document preview helpers shared by the `/api/file/render` (docx),
 * `/api/file/rendered-pdf` (docx→PDF), and `/api/file/sheet` (xlsx/csv) routes.
 *
 * Two-tier docx (design D8): a `document-converter` PDF render when the engine
 * is available, else an in-process `mammoth` HTML baseline with a mandatory
 * hyperlink-guard (design D2) + DOMPurify sanitize + bounded-preview (design
 * D3). Spreadsheets parse in-process with SheetJS (no Docker) with csv
 * encoding detection (design D6). The unrenderable tail degrades to
 * `{ success:false, error }` (design D5). See change: render-office-previews.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

/** Bounded-preview + size caps (design D3). Overridable per-call for tests. */
export interface OfficeCaps {
  /** docx `stat.size` cap → 413 before read. */
  docxSizeCap: number;
  /** pptx `stat.size` cap → 413 before convert (design P5). */
  pptxSizeCap: number;
  /** xlsx/csv `stat.size` cap → 413 before read. */
  sheetSizeCap: number;
  /** html-mode: strip images if count exceeds this. */
  imageCap: number;
  /** html-mode: strip images if serialized html exceeds this byte length. */
  htmlByteCap: number;
  /** sheet: default inline row cap. */
  rowCap: number;
  /** sheet: max `limit`-overridable row cap. */
  rowCapMax: number;
  /** sheet: per-sheet column cap. */
  colCap: number;
}

export const OFFICE_CAPS: OfficeCaps = {
  docxSizeCap: 40 * 1024 * 1024,
  // Decks run large (corpus median 4.2 MB, tail 258 MB). Cap at 100 MB so the
  // extreme tail is size-gated (413) before conversion; download is the escape
  // hatch (design P5).
  pptxSizeCap: 100 * 1024 * 1024,
  sheetSizeCap: 50 * 1024 * 1024,
  imageCap: 20,
  htmlByteCap: 2 * 1024 * 1024,
  rowCap: 500,
  rowCapMax: 5000,
  colCap: 100,
};

// ── docx: hyperlink-guard (design D2) ────────────────────────────────────────

/**
 * mammoth `transformDocument` guard. Vanilla mammoth crashes
 * (`escapeHtmlAttribute(undefined)`) on a hyperlink node with null href AND
 * null anchor — 21% of the measured corpus. Setting `href=""` neutralizes it.
 * Mutates + returns the doc so it can be passed straight to mammoth.
 */
export function hyperlinkGuard<T>(doc: T): T {
  const walk = (n: any): void => {
    if (!n) return;
    if (n.type === "hyperlink" && n.href == null && n.anchor == null) n.href = "";
    if (Array.isArray(n.children)) n.children.forEach(walk);
  };
  walk(doc);
  return doc;
}

// ── docx: bounded-preview image cap (design D3) ───────────────────────────────

/**
 * html-mode bounded preview. If the mammoth HTML carries more than `imageCap`
 * inline (base64) images OR exceeds `htmlByteCap` serialized bytes, replace
 * every `<img …>` with a lightweight placeholder so the base64 payload never
 * reaches the browser. Text is always kept whole.
 */
export function applyImageCap(
  html: string,
  imageCount: number,
  caps: Pick<OfficeCaps, "imageCap" | "htmlByteCap">,
): { html: string; truncated: boolean } {
  const over = imageCount > caps.imageCap || Buffer.byteLength(html, "utf8") > caps.htmlByteCap;
  if (!over) return { html, truncated: false };
  const stripped = html.replace(
    /<img\b[^>]*>/gi,
    '<span class="preview-image-placeholder" data-preview-stripped="1">[image removed — download for full document]</span>',
  );
  return { html: stripped, truncated: true };
}

// ── docx: PDF engine seam (design D8) ─────────────────────────────────────────

/** Injectable docx→PDF engine. Prod impl wraps `document-converter`. */
export interface DocxPdfEngine {
  /** Cheap, memoized availability probe (e.g. `docker image inspect`). */
  available(): Promise<boolean>;
  /** Render `docxPath` to a PDF at `outPath`. Throws on any failure. */
  toPdf(docxPath: string, outPath: string): Promise<void>;
}

/** Server temp dir holding cached docx→PDF renders. */
export function pdfCacheDir(): string {
  return path.join(os.tmpdir(), "pi-dashboard-docx-pdf");
}

/** Cache path keyed by resolved path + mtime + size (design D8). */
export function pdfCachePath(resolved: string, mtimeMs: number, size: number): string {
  const key = createHash("sha256").update(`${resolved}\0${mtimeMs}\0${size}`).digest("hex");
  return path.join(pdfCacheDir(), `${key}.pdf`);
}

/**
 * Default production engine. Availability is a memoized `docker image inspect`
 * (short TTL); `toPdf` uses the existing `document-converter` `renderPdf`
 * facade (Markdown|DOCX → PDF — no new engine command). Any failure throws,
 * so callers fall through to html mode.
 */
export function createDefaultDocxPdfEngine(opts?: {
  image?: string;
  ttlMs?: number;
}): DocxPdfEngine {
  const image = opts?.image ?? process.env.PI_DOC_ENGINE_IMAGE ?? "pi-doc-engine";
  const ttlMs = opts?.ttlMs ?? 30_000;
  let cached: { at: number; ok: boolean } | null = null;

  return {
    async available(): Promise<boolean> {
      const now = Date.now();
      if (cached && now - cached.at < ttlMs) return cached.ok;
      let ok = false;
      try {
        await execFileAsync("docker", ["image", "inspect", image], { timeout: 5000 });
        ok = true;
      } catch {
        ok = false;
      }
      cached = { at: now, ok };
      return ok;
    },
    async toPdf(docxPath: string, outPath: string): Promise<void> {
      const { createDocumentConverter } = await import(
        "@blackbelt-technology/pi-dashboard-document-converter"
      );
      const dc = createDocumentConverter({
        image,
        stagingDir: pdfCacheDir(),
        mounts: [path.dirname(docxPath)],
      });
      const { output } = await dc.renderPdf(docxPath, { output: outPath });
      if (output !== outPath) await fs.copyFile(output, outPath);
    },
  };
}

// ── docx: render (design D8) ─────────────────────────────────────────────────

export type DocxRenderResult =
  | { success: true; mode: "pdf" }
  | {
      success: true;
      mode: "html";
      html: string;
      truncated: boolean;
      imageCount: number;
      note?: string;
    }
  | { success: false; error: string };

/** `docxRender` config: fidelity-first `"auto"` default (design D8, resolved). */
export type DocxRenderMode = "pdf" | "html" | "auto";

/**
 * Render a docx to the discriminated preview result. Prefers `mode:"pdf"` when
 * the engine is available and `docxRender !== "html"`; on ANY engine error it
 * falls through to `mode:"html"` — the request never fails because the engine
 * is missing or slow. The html path applies the hyperlink-guard, sanitizes with
 * DOMPurify, and applies the image cap.
 */
export async function renderDocx(
  resolved: string,
  stat: { mtimeMs: number; size: number },
  opts: { mode: DocxRenderMode; engine: DocxPdfEngine; caps: OfficeCaps },
): Promise<DocxRenderResult> {
  const { mode, engine, caps } = opts;

  if (mode !== "html") {
    try {
      if (await engine.available()) {
        const out = pdfCachePath(resolved, stat.mtimeMs, stat.size);
        await fs.mkdir(pdfCacheDir(), { recursive: true });
        try {
          await fs.access(out);
        } catch {
          await engine.toPdf(resolved, out);
        }
        return { success: true, mode: "pdf" };
      }
    } catch {
      // fall through to html
    }
  }

  try {
    const buffer = await fs.readFile(resolved);
    const mammoth = (await import("mammoth")).default ?? (await import("mammoth"));
    let imageCount = 0;
    const convertImage = mammoth.images.imgElement((img: any) =>
      img.read("base64").then((data: string) => {
        imageCount += 1;
        return { src: `data:${img.contentType};base64,${data}` };
      }),
    );
    const result = await mammoth.convertToHtml(
      { buffer },
      { transformDocument: hyperlinkGuard, convertImage },
    );
    const { default: DOMPurify } = await import("isomorphic-dompurify");
    const clean = DOMPurify.sanitize(result.value ?? "", {
      FORBID_TAGS: ["script", "style"],
    });
    const { html, truncated } = applyImageCap(clean, imageCount, caps);
    return {
      success: true,
      mode: "html",
      html,
      truncated,
      imageCount,
      ...(truncated ? { note: "Images trimmed — download for the full document." } : {}),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "failed to render docx" };
  }
}

// ── pptx: PDF render (design P1/P4) ──────────────────────────────────────────

export type PptxRenderResult =
  | { success: true; mode: "pdf" }
  | { success: false; error: string };

/**
 * Render a pptx to PDF via the `document-converter` engine, caching the output
 * (path+mtime+size, reusing the docx PDF cache). Unlike docx there is NO
 * in-process fallback renderer for pptx (design P4) — engine absent /
 * `DOCKER_UNAVAILABLE` / convert failure → `{ success:false }`. Never throws.
 */
export async function renderPptx(
  resolved: string,
  stat: { mtimeMs: number; size: number },
  opts: { engine: DocxPdfEngine },
): Promise<PptxRenderResult> {
  try {
    if (await opts.engine.available()) {
      const out = pdfCachePath(resolved, stat.mtimeMs, stat.size);
      await fs.mkdir(pdfCacheDir(), { recursive: true });
      try {
        await fs.access(out);
      } catch {
        await opts.engine.toPdf(resolved, out);
      }
      return { success: true, mode: "pdf" };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "failed to render pptx" };
  }
  return { success: false, error: "presentation rendering requires the document engine" };
}

// ── xlsx/csv: sheet parse (design D3/D6) ─────────────────────────────────────

export interface SheetData {
  name: string;
  header: string[];
  rows: string[][];
  totalRows: number;
  totalCols: number;
  truncated: boolean;
}

export type SheetParseResult =
  | { success: true; sheets: SheetData[]; activeSheet: number; encoding?: string }
  | { success: false; error: string };

/**
 * Pick the csv source encoding from a chardet ranking. chardet cannot reliably
 * separate Latin-1 (ISO-8859-1 / windows-1252) from Latin-2 (ISO-8859-2 /
 * windows-1250) on short samples, yet the split is exactly where Central-
 * European double-acute vowels (Hungarian ő/ű) live: decoding CP1250 bytes as
 * Latin-1 corrupts them to õ/û. When chardet's top pick is Latin-1 but a
 * competitive Latin-2 candidate exists (within `margin` confidence), prefer the
 * Latin-2 one — it decodes the shared Western letters identically while fixing
 * the double-acute vowels. Clearly-Western files rank Latin-1 far higher, so the
 * margin leaves them untouched. (design D6, corpus-grounded.)
 */
export function pickCsvEncoding(
  ranking: { name: string; confidence: number }[],
  margin = 3,
): string {
  if (ranking.length === 0) return "UTF-8";
  const top = ranking[0];
  const LATIN1 = new Set(["ISO-8859-1", "windows-1252"]);
  const LATIN2 = new Set(["ISO-8859-2", "windows-1250"]);
  if (LATIN1.has(top.name)) {
    const alt = ranking.find(
      (c) => LATIN2.has(c.name) && c.confidence >= top.confidence - margin,
    );
    if (alt) return alt.name;
  }
  return top.name;
}

/** Clamp a requested `limit` into `[1, rowCapMax]`, defaulting to `rowCap`. */
export function resolveRowLimit(limit: number | undefined, caps: OfficeCaps): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return caps.rowCap;
  return Math.min(Math.floor(limit), caps.rowCapMax);
}

function toCells(matrix: unknown[][], rowLimit: number, colCap: number): SheetData {
  const totalRows = Math.max(0, matrix.length - 1); // minus header
  let totalCols = 0;
  for (const r of matrix) totalCols = Math.max(totalCols, r.length);
  const cap = Math.min(totalCols, colCap);
  const norm = (r: unknown[]): string[] => {
    const out: string[] = [];
    for (let i = 0; i < cap; i++) out.push(r[i] == null ? "" : String(r[i]));
    return out;
  };
  const header = matrix.length > 0 ? norm(matrix[0]) : [];
  const bodyAll = matrix.slice(1);
  const rows = bodyAll.slice(0, rowLimit).map(norm);
  return {
    name: "",
    header,
    rows,
    totalRows,
    totalCols,
    truncated: bodyAll.length > rowLimit,
  };
}

/**
 * Parse an xlsx/csv buffer to bounded structured JSON. For `.csv`, detect the
 * source encoding (chardet) and decode to UTF-8 (iconv-lite) before parsing so
 * CP1250 accented text renders correctly; the decoded charset is reported.
 * Password-protected / corrupt inputs → `{ success:false }` (no throw).
 */
export async function parseSheet(
  buffer: Buffer,
  ext: string,
  opts: { rowLimit: number; colCap: number },
): Promise<SheetParseResult> {
  try {
    const XLSX = (await import("xlsx")).default ?? (await import("xlsx"));
    let encoding: string | undefined;
    let wb: any;
    if (ext === ".csv") {
      const chardet = (await import("chardet")).default ?? (await import("chardet"));
      const ranking = chardet.analyse(buffer) as { name: string; confidence: number }[];
      const detected = pickCsvEncoding(ranking);
      encoding = detected;
      const iconv = (await import("iconv-lite")).default ?? (await import("iconv-lite"));
      const decoded = iconv.decode(buffer, detected);
      wb = XLSX.read(decoded, { type: "string" });
    } else {
      wb = XLSX.read(buffer, { type: "buffer" });
    }
    const sheets: SheetData[] = wb.SheetNames.map((name: string) => {
      const ws = wb.Sheets[name];
      const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][];
      const data = toCells(matrix, opts.rowLimit, opts.colCap);
      data.name = name;
      return data;
    });
    if (sheets.length === 0) return { success: false, error: "no sheets found" };
    return { success: true, sheets, activeSheet: 0, ...(encoding ? { encoding } : {}) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "failed to parse spreadsheet" };
  }
}
