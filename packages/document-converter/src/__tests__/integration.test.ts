/**
 * Integration test — one real conversion per direction against the built image.
 * VERIFIED green against `pi-doc-engine:0.1.0` (ingest PDF→md→kb; produce
 * md→DOCX with template + mmdc diagram).
 *
 * Opt-in only (heavy image: docling ML models + LibreOffice + pandoc). Skipped
 * unless `docker` is on PATH and these env vars are set:
 *   DOC_ENGINE_IMAGE=pi-doc-engine:0.1.0   built + loadable image tag
 *   DOC_ENGINE_PDF=/abs/sample.pdf         a digital PDF fixture (ingest case)
 *   DOC_ENGINE_TEMPLATES=/abs/templates    dir with <template>/template.docx (produce case)
 *   DOC_ENGINE_PPTX=/abs/deck.pptx         a real .pptx deck (pptx→PDF case)
 * Never runs in the default `npm test`.
 *
 * Confinement (change: harden-untrusted-content-ingestion): every path lives
 * under the per-run `work` root (`workspaceRoot`) or an explicit `mounts` dir.
 * The `:ro` case uses the committed `fixtures/sample.{md,docx}` (M2).
 *
 *   DOC_ENGINE_IMAGE=pi-doc-engine:0.1.0 DOC_ENGINE_PDF=… DOC_ENGINE_TEMPLATES=… \
 *     npx vitest run integration
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDocumentConverter } from "../index.js";

const IMAGE = process.env.DOC_ENGINE_IMAGE;
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** name → size+mtime listing, to prove a `:ro` input dir is untouched. */
async function listing(dir: string): Promise<string[]> {
  const names = (await readdir(dir)).sort();
  return Promise.all(
    names.map(async (n) => {
      const s = await stat(join(dir, n));
      return `${n}:${s.size}:${s.mtimeMs}`;
    }),
  );
}

function dockerOk(): boolean {
  if (!IMAGE) return false;
  try {
    execFileSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const ENABLED = dockerOk();
let work: string;

beforeAll(async () => {
  if (!ENABLED) return;
  work = await mkdtemp(join(tmpdir(), "docconv-it-"));
});
afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

describe.skipIf(!ENABLED)("pi-doc-engine integration", () => {
  it("ingest: PDF -> Markdown with provenance, indexable by kb", async () => {
    const pdf0 = process.env.DOC_ENGINE_PDF;
    const dc = createDocumentConverter({
      image: IMAGE!,
      stagingDir: join(work, "staging"),
      workspaceRoot: work,
      mounts: pdf0 ? [dirname(pdf0)] : [],
    });
    // A trivial single-page PDF fixture must exist; integration fixtures are
    // provided alongside the built image. Point at it via DOC_ENGINE_PDF.
    const pdf = process.env.DOC_ENGINE_PDF;
    expect(pdf, "set DOC_ENGINE_PDF to a sample PDF").toBeTruthy();

    const { output, provenance } = await dc.convertToMarkdown(pdf!);
    const md = await readFile(output, "utf-8");
    expect(md).toContain("provenance:");
    expect(provenance.doc_type).toBe("pdf");
    expect(provenance.sha256).toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);

  it("produce: Markdown -> DOCX with template + diagram", async () => {
    // Templates are runtime-mounted, not baked into the image (design Q4). Point
    // DOC_ENGINE_TEMPLATES at a dir containing `<template>/template.docx`.
    const templatesDir = process.env.DOC_ENGINE_TEMPLATES;
    expect(templatesDir, "set DOC_ENGINE_TEMPLATES to a templates dir").toBeTruthy();

    const dc = createDocumentConverter({
      image: IMAGE!,
      stagingDir: join(work, "staging"),
      workspaceRoot: work,
      mounts: [templatesDir!],
    });
    const md = join(work, "spec.md");
    await writeFile(
      md,
      [
        "---",
        "template: default",
        "---",
        "",
        "# Spec",
        "",
        "Hello world.",
        "",
        "```mermaid",
        "graph TD; A-->B",
        "```",
        "",
      ].join("\n"),
      "utf-8",
    );
    const out = join(work, "spec.docx");
    const res = await dc.renderDocx(md, {
      output: out,
      template: "default",
      templatesDir: templatesDir!,
    });
    expect(res.output).toBe(out);
    const bytes = await readFile(out);
    expect(bytes.byteLength).toBeGreaterThan(1000); // non-trivial DOCX
  }, 180_000);

  it("produce: PPTX -> PDF via renderPdf (fidelity path; change: render-pptx-preview)", async () => {
    // Verifies the engine input-type widening: renderPdf accepts .pptx and the
    // LibreOffice Impress export filter produces a valid PDF. Point DOC_ENGINE_PPTX
    // at a real deck.
    const pptx = process.env.DOC_ENGINE_PPTX;
    expect(pptx, "set DOC_ENGINE_PPTX to a sample .pptx deck").toBeTruthy();

    const dc = createDocumentConverter({
      image: IMAGE!,
      stagingDir: join(work, "staging"),
      workspaceRoot: work,
      mounts: [join(pptx!, "..")],
    });
    const out = join(work, "deck.pdf");
    const res = await dc.renderPdf(pptx!, { output: out });
    expect(res.output).toBe(out);
    const bytes = await readFile(out);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-"); // valid PDF header
    expect(bytes.byteLength).toBeGreaterThan(1000);
  }, 180_000);

  it("M2: renderPdf + convertToMarkdown leave a `:ro` input dir byte-identical", async () => {
    const dc = createDocumentConverter({
      image: IMAGE!,
      stagingDir: join(work, "staging"),
      workspaceRoot: work,
      mounts: [FIXTURES],
    });
    const before = await listing(FIXTURES);
    const out = join(work, "sample.pdf");
    const res = await dc.renderPdf(join(FIXTURES, "sample.md"), { output: out });
    expect(res.output).toBe(out);
    expect((await readFile(out)).subarray(0, 5).toString()).toBe("%PDF-");
    const md = await dc.convertToMarkdown(join(FIXTURES, "sample.docx"));
    expect(await readFile(md.output, "utf-8")).toContain("provenance:");
    expect(await listing(FIXTURES)).toEqual(before);
  }, 180_000);
});
