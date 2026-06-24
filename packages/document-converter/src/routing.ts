/** Extension routing: file extension -> DocType, and ingest support check. */
import { extname } from "node:path";
import { DocConverterError } from "./errors.js";
import type { DocType } from "./schema.js";

const EXT_TO_DOCTYPE: Record<string, DocType> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".pptx": "pptx",
  ".xlsx": "xlsx",
  ".md": "md",
  ".markdown": "md",
  ".mdx": "md",
};

/** Formats the ingest direction (-> Markdown) accepts. */
const INGESTABLE: ReadonlySet<DocType> = new Set(["pdf", "docx", "pptx", "xlsx"]);

/** Resolve a file's DocType from its extension, or throw `UNSUPPORTED_FORMAT`. */
export function docTypeOf(path: string): DocType {
  const ext = extname(path).toLowerCase();
  const t = EXT_TO_DOCTYPE[ext];
  if (!t) {
    throw new DocConverterError({
      code: "UNSUPPORTED_FORMAT",
      message: `unsupported file extension: ${ext || "(none)"}`,
    });
  }
  return t;
}

/** True when the file can be ingested to Markdown. */
export function isIngestable(path: string): boolean {
  const ext = extname(path).toLowerCase();
  const t = EXT_TO_DOCTYPE[ext];
  return t !== undefined && INGESTABLE.has(t);
}

/** Resolve DocType for ingest; throw if the format is not ingestable. */
export function ingestDocType(path: string): DocType {
  const t = docTypeOf(path);
  if (!INGESTABLE.has(t)) {
    throw new DocConverterError({
      code: "UNSUPPORTED_FORMAT",
      message: `cannot ingest ${t} to Markdown`,
    });
  }
  return t;
}
