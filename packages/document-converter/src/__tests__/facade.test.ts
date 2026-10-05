import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, } from "vitest";
import type { EngineRunner } from "../engine.js";
import { createDocumentConverter } from "../index.js";

const tmps: string[] = [];
async function workdir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "docconv-"));
  tmps.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(tmps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** Fake runner that records the parsed request and returns a canned ok payload. */
function recordingRunner(payload: object): { runner: EngineRunner; reqs: any[]; argvs: string[][] } {
  const reqs: any[] = [];
  const argvs: string[][] = [];
  const runner: EngineRunner = async (argv, stdin) => {
    argvs.push(argv);
    reqs.push(JSON.parse(stdin));
    return { stdout: JSON.stringify({ ok: true, ...payload }), stderr: "", exitCode: 0 };
  };
  return { runner, reqs, argvs };
}

describe("facade: convertToMarkdown", () => {
  it("stamps provenance and writes markdown to the staging dir", async () => {
    const dir = await workdir();
    const staging = join(dir, "staging");
    const pdf = join(dir, "report.pdf");
    await writeFile(pdf, "fake-pdf-bytes");

    const { runner, reqs } = recordingRunner({ markdown: "# Report\n\ncontent" });
    const dc = createDocumentConverter({
      image: "pi-doc-engine:test",
      stagingDir: staging,
      workspaceRoot: dir,
      engine: { runner },
    });

    const res = await dc.convertToMarkdown(pdf, { ocr: { lang: ["hungarian"], engine: "tesseract" } });

    // OCR canonical name was mapped to the per-engine code before the engine saw it.
    expect(reqs[0].command).toBe("convertToMarkdown");
    expect(reqs[0].ocr).toEqual({ mode: "auto", engine: "tesseract", codes: ["hun"] });

    const written = await readFile(res.output, "utf-8");
    expect(written).toContain("provenance:");
    expect(written).toContain("doc_type: pdf");
    expect(written).toContain(`source_path: ${pdf}`);
    expect(written).toContain("# Report");
    expect(res.provenance.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.output).toBe(join(staging, "report.md"));
  });

  it("rejects unsupported input formats before calling the engine", async () => {
    const dir = await workdir();
    const { runner, reqs } = recordingRunner({ markdown: "x" });
    const dc = createDocumentConverter({
      image: "x",
      stagingDir: join(dir, "staging"),
      engine: { runner },
    });
    await expect(dc.convertToMarkdown(join(dir, "a.txt"))).rejects.toMatchObject({
      code: "UNSUPPORTED_FORMAT",
    });
    expect(reqs).toHaveLength(0);
  });

  it("rejects an unsupported OCR language before calling the engine", async () => {
    const dir = await workdir();
    const pdf = join(dir, "a.pdf");
    await writeFile(pdf, "x");
    const { runner, reqs } = recordingRunner({ markdown: "x" });
    const dc = createDocumentConverter({
      image: "x",
      stagingDir: join(dir, "staging"),
      workspaceRoot: dir,
      engine: { runner },
    });
    await expect(
      dc.convertToMarkdown(pdf, { ocr: { lang: ["klingon"], engine: "easyocr" } }),
    ).rejects.toMatchObject({ code: "OCR_LANG_UNSUPPORTED" });
    expect(reqs).toHaveLength(0);
  });
});

describe("facade: confinement (D1)", () => {
  it("E13 creates a non-existent staging dir first and mounts it rw", async () => {
    const dir = await workdir();
    const staging = join(dir, "staging");
    const pdf = join(dir, "a.pdf");
    await writeFile(pdf, "x");
    const { runner, argvs } = recordingRunner({ markdown: "# A" });
    const dc = createDocumentConverter({ image: "x", stagingDir: staging, workspaceRoot: dir, engine: { runner } });
    await dc.convertToMarkdown(pdf);
    expect(existsSync(staging)).toBe(true);
    const argv = argvs[0].join(" ");
    expect(argv).toMatch(new RegExp(`-v [^ ]+:${staging}(?: |$)`));
  });

  it("rejects a request outside the workspace with PATH_NOT_ALLOWED before the engine runs", async () => {
    const dir = await workdir();
    const { runner, reqs } = recordingRunner({ output: "x" });
    const dc = createDocumentConverter({ image: "x", stagingDir: join(dir, "staging"), workspaceRoot: dir, engine: { runner } });
    await expect(dc.renderPdf(join(dir, "in.md"), { output: "/root/.ssh/authorized_keys" })).rejects.toMatchObject({
      code: "PATH_NOT_ALLOWED",
    });
    expect(reqs).toHaveLength(0);
  });
});

describe("facade: produce", () => {
  it("forwards the nano_banana flag and template to the engine on renderDocx", async () => {
    const dir = await workdir();
    const { runner, reqs } = recordingRunner({ output: join(dir, "out.docx") });
    const dc = createDocumentConverter({
      image: "x",
      stagingDir: join(dir, "staging"),
      workspaceRoot: dir,
      engine: { runner },
    });
    await dc.renderDocx(join(dir, "in.md"), {
      output: join(dir, "out.docx"),
      template: "default",
      nanoBanana: { enabled: true, style: "ros-3d" },
    });
    expect(reqs[0]).toMatchObject({
      command: "renderDocx",
      input: join(dir, "in.md"),
      output: join(dir, "out.docx"),
      template: "default",
      nano_banana: { enabled: true, style: "ros-3d" },
    });
  });

  it("returns the extract result with a document_meta path", async () => {
    const dir = await workdir();
    const meta = join(dir, "document_meta.xml");
    const { runner } = recordingRunner({ output: join(dir, "edit.md"), meta });
    const dc = createDocumentConverter({
      image: "x",
      stagingDir: join(dir, "staging"),
      workspaceRoot: dir,
      engine: { runner },
    });
    const res = await dc.extractForEdit(join(dir, "in.docx"), join(dir, "edit.md"));
    expect(res).toEqual({ output: join(dir, "edit.md"), meta });
  });
});
