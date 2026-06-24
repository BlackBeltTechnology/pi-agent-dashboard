/**
 * Provenance frontmatter writer.
 *
 * Stamps each ingested `.md` with origin metadata so kb chunks trace back to the
 * source file. Re-ingesting an unchanged file yields an identical `sha256`, so
 * the staging output is byte-stable (idempotent by hash).
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { DocType, Provenance } from "./schema.js";

/** Compute the sha256 of a file's bytes. */
export async function sha256File(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

export interface BuildProvenanceInput {
  sourcePath: string;
  sha256: string;
  docType: DocType;
  /** Defaults to now (ISO-8601). Pass a fixed value for deterministic tests. */
  convertedAt?: string;
  page?: number;
  slide?: number;
}

/** Assemble a `Provenance` record. */
export function buildProvenance(input: BuildProvenanceInput): Provenance {
  const prov: Provenance = {
    source_path: input.sourcePath,
    sha256: input.sha256,
    doc_type: input.docType,
    converted_at: input.convertedAt ?? new Date().toISOString(),
  };
  if (input.page !== undefined) prov.page = input.page;
  if (input.slide !== undefined) prov.slide = input.slide;
  return prov;
}

/** The `provenance:` YAML key block (no fences), deterministic key order. */
function provenanceKeys(prov: Provenance): string {
  const lines = ["provenance:"];
  lines.push(`  source_path: ${yamlScalar(prov.source_path)}`);
  lines.push(`  sha256: ${prov.sha256}`);
  lines.push(`  doc_type: ${prov.doc_type}`);
  lines.push(`  converted_at: ${yamlScalar(prov.converted_at)}`);
  if (prov.page !== undefined) lines.push(`  page: ${prov.page}`);
  if (prov.slide !== undefined) lines.push(`  slide: ${prov.slide}`);
  return lines.join("\n");
}

/** Serialize a standalone `provenance:` YAML frontmatter block. */
export function provenanceFrontmatter(prov: Provenance): string {
  return `---\n${provenanceKeys(prov)}\n---\n`;
}

/**
 * Prepend a provenance frontmatter block to a Markdown body. If the body already
 * opens with a `---` frontmatter block, the provenance keys are injected just
 * after the opening fence so existing keys are preserved.
 */
export function stampProvenance(markdown: string, prov: Provenance): string {
  if (!markdown.startsWith("---\n")) {
    return `${provenanceFrontmatter(prov)}${markdown}`;
  }
  // Inject provenance keys right after the opening `---\n`.
  return `---\n${provenanceKeys(prov)}\n${markdown.slice(4)}`;
}

/**
 * Quote a YAML scalar when it could be misparsed; otherwise pass through.
 * Safe plain set excludes spaces (a path with spaces is quoted); colons are
 * allowed so ISO timestamps stay unquoted.
 */
function yamlScalar(value: string): string {
  if (/^[\w./@:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}
