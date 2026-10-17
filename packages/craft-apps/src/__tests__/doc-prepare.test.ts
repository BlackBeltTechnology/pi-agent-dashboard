/**
 * `pi-craft doc prepare` (spec craft-doc-prepare). Offline: fixture docx built with fflate; `mmdc` and
 * `pi-nano-banana` are stub scripts on a private PATH.
 * See change: add-craft-office-workflows (test-plan E1–E24).
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, type PrepareReport, prepareDoc } from "../doc-prepare.js";
import { buildDocx, para, partText, readDocx, standardTemplate, stubPath, type TemplateSpec, textbox, textsOf, writeTemplate } from "./helpers/docx.js";
import { cleanupTmp, sha256, tmpDir } from "./helpers/fixtures.js";

afterEach(cleanupTmp);

interface Run {
  code: number;
  out: string;
  err: string;
  dir: string;
  report: PrepareReport;
  docx: Buffer;
  body: string;
}

interface Setup {
  md: string;
  /** relative path → content (written under the work dir) */
  files?: Record<string, string | Buffer>;
  template?: TemplateSpec;
  templateName?: string;
  /** extra argv appended after the standard ones */
  args?: string[];
  /** omit the default `--templates-dir` */
  noTemplatesDir?: boolean;
  env?: NodeJS.ProcessEnv;
  stubs?: ReturnType<typeof stubPath>;
  now?: Date;
  /** runs after the fixture files are written, before prepare (symlinks etc.) */
  before?: (work: string) => void;
}

async function prep(s: Setup): Promise<Run & { work: string; templates: string }> {
  const work = tmpDir("craft-doc-");
  const templates = path.join(work, "tpl");
  writeTemplate(templates, s.templateName ?? "default", s.template ?? standardTemplate());
  fs.writeFileSync(path.join(work, "in.md"), s.md);
  for (const [rel, content] of Object.entries(s.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
    fs.writeFileSync(path.join(work, rel), content);
  }
  s.before?.(work);
  const outDir = path.join(work, "out");
  const stubs = s.stubs ?? stubPath();
  const out: string[] = [];
  const err: string[] = [];
  const argv = ["in.md", "--out", "out", ...(s.noTemplatesDir ? [] : ["--templates-dir", "tpl"]), ...(s.args ?? [])];
  const code = await prepareDoc(argv, {
    cwd: work,
    homedir: path.join(work, "home"),
    env: { ...stubs.env, ...s.env },
    now: () => s.now ?? new Date(2026, 2, 5),
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
  });
  const read = (f: string) => (fs.existsSync(path.join(outDir, f)) ? fs.readFileSync(path.join(outDir, f)) : Buffer.alloc(0));
  const reportText = read("prepare.json").toString();
  return {
    code,
    out: out.join(""),
    err: err.join(""),
    dir: outDir,
    report: (reportText ? JSON.parse(reportText) : {}) as PrepareReport,
    docx: read("template.filled.docx"),
    body: read("body.md").toString(),
    work,
    templates,
  };
}

/** Run prepare again in an existing work dir (the second run of a cache test). */
async function rerun(work: string, env: NodeJS.ProcessEnv, extra: string[] = []): Promise<PrepareReport> {
  const out: string[] = [];
  await prepareDoc(["in.md", "--out", "out", "--templates-dir", "tpl", "--json", ...extra], { cwd: work, homedir: work, env, stdout: (t) => out.push(t), stderr: () => {} });
  return JSON.parse(out.join("")) as PrepareReport;
}

const FM = (kv: string) => `---\n${kv}\n---\n`;

type ChainSource = "flag" | "fm" | "env" | "local" | "home";

/** `prepare` with the given templates-dir sources present; returns the resolved template path and the work dir. */
async function chainRun(roots: { flag: string; env: string; home: string }, sources: ChainSource[]) {
  const has = (x: ChainSource) => sources.includes(x);
  const work = tmpDir("craft-chain-work-");
  fs.writeFileSync(path.join(work, "in.md"), has("fm") ? `${FM("templates_dir: ./fmtpl")}x\n` : "x\n");
  if (has("fm")) writeTemplate(path.join(work, "fmtpl"), "default", standardTemplate());
  if (has("local")) writeTemplate(path.join(work, "templates"), "default", standardTemplate());
  if (has("home")) fs.cpSync(roots.home, path.join(work, "home", "Documents", "templates"), { recursive: true });
  const out: string[] = [];
  await prepareDoc(["in.md", "--out", "out", "--json", ...(has("flag") ? ["--templates-dir", roots.flag] : [])], {
    cwd: work,
    homedir: path.join(work, "home"),
    env: { ...stubPath().env, ...(has("env") ? { PI_DOC_TEMPLATES_DIR: roots.env } : {}) },
    stdout: (t) => out.push(t),
    stderr: () => {},
  });
  return { templatePath: (JSON.parse(out.join("") || "{}") as PrepareReport).templatePath, work };
}

describe("variables and template resolution", () => {
  it("E1 precedence: template default < frontmatter < --var, with sources", async () => {
    const a = await prep({ md: "# T\n" });
    const b = await prep({ md: `${FM('version: "1.0"')}# T\n` });
    const c = await prep({ md: `${FM('version: "1.0"')}# T\n`, args: ["--var", "version=1.1"] });
    for (const [r, text, src] of [[a, "0.1", "default"], [b, "1.0", "frontmatter"], [c, "1.1", "cli"]] as const) {
      expect(partText(r.docx, "word/document.xml"), src).toContain(`Version: </w:t>`);
      expect(textsOf(partText(r.docx, "word/document.xml")).join("|"), src).toContain(text);
      expect(r.report.vars.version).toBe(src);
    }
  });

  it("E2 template name traversal is refused with exit 2 and no outputs", async () => {
    const r = await prep({ md: `${FM("template: ../../evil")}# T\n` });
    expect(r.code).toBe(2);
    expect(r.err).toContain("../../evil");
    expect(fs.existsSync(r.dir)).toBe(false);
  });

  it("E3 frontmatter templates_dir is confined to the input's tree or --allow-path", async () => {
    const outside = tmpDir("craft-outside-");
    writeTemplate(outside, "default", standardTemplate());
    // `./tpl` exists inside the input's tree (the fixture templates dir): accepted
    const inside = await prep({ md: `${FM("templates_dir: ./tpl")}# T\n`, noTemplatesDir: true });
    expect(inside.code).toBe(0);
    const refused = await prep({ md: `${FM(`templates_dir: ${outside}`)}# T\n`, noTemplatesDir: true });
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(outside);
    expect(refused.err).not.toContain("template not found");
    expect(fs.existsSync(refused.dir)).toBe(false);
    const allowed = await prep({ md: `${FM(`templates_dir: ${outside}`)}# T\n`, noTemplatesDir: true, args: ["--allow-path", outside] });
    expect(allowed.code).toBe(0);
    expect(allowed.report.templatePath).toBe(path.join(outside, "default", "template.docx"));
  });

  it("E4 the templates-dir chain: flag > frontmatter > $PI_DOC_TEMPLATES_DIR > ./templates > ~/Documents/templates", async () => {
    const roots = { flag: tmpDir("craft-chain-flag-"), env: tmpDir("craft-chain-env-"), home: tmpDir("craft-chain-home-") };
    for (const r of Object.values(roots)) writeTemplate(r, "default", standardTemplate());
    const expected = (work: string): Record<string, string> => ({
      flag: path.join(roots.flag, "default", "template.docx"),
      fm: path.join(work, "fmtpl", "default", "template.docx"),
      env: path.join(roots.env, "default", "template.docx"),
      local: path.join(work, "templates", "default", "template.docx"),
      home: path.join(work, "home", "Documents", "templates", "default", "template.docx"),
    });
    const order: ChainSource[] = ["flag", "fm", "env", "local", "home"];
    for (let i = 0; i < order.length; i++) {
      const r = await chainRun(roots, order.slice(i));
      expect(r.templatePath, `highest source ${order[i]}`).toBe(expected(r.work)[order[i]]);
    }
  });

  it("E13 template-default variables are reported under defaulted with source default", async () => {
    const r = await prep({ md: "x\n" });
    expect(r.report.defaulted).toContain("client_name");
    expect(r.report.vars.client_name).toBe("default");
    const o = await prep({ md: `${FM("client_name: ACME")}x\n` });
    expect(o.report.defaulted).not.toContain("client_name");
  });

  it("E14 $date matches doc-engine's month tables for en/hu/de/fr", async () => {
    const tpl: TemplateSpec = { document: [para("{{ $date }}")], syntax: {} };
    const expected = { en: "March 5, 2026", hu: "2026. marcius 5.", de: "5. Marz 2026", fr: "5 mars 2026" };
    for (const [lang, text] of Object.entries(expected)) {
      const r = await prep({ md: `${FM(`language: ${lang}`)}x\n`, template: tpl });
      expect(textsOf(partText(r.docx, "word/document.xml")), lang).toEqual([text]);
    }
  });

  it("E24 doc-engine frontmatter keys: toc, title, ignored structured keys", async () => {
    const r = await prep({ md: `${FM("enable_toc: true\ntoc_heading: Tartalom\ndocument_title: Q3\ntable_style:\n  border: 1\nnested:\n  a: 1")}x\n` });
    expect(r.report.toc).toEqual({ enabled: true, heading: "Tartalom", levels: 3 });
    expect(r.report.title).toBe("Q3");
    expect(r.report.ignored).toEqual(expect.arrayContaining(["table_style", "nested"]));
    expect(r.report.vars.table_style).toBeUndefined();
  });
});

describe("placeholder fill", () => {
  it("E5 textbox and first-page header are filled", async () => {
    const r = await prep({ md: `${FM("client_name: ACME Kft.\ndocument_id: BB-1")}x\n` });
    const doc = partText(r.docx, "word/document.xml");
    const hdr = partText(r.docx, "word/header2.xml");
    expect(doc).not.toContain("{{");
    expect(hdr).not.toContain("{{");
    expect(doc).toContain("ACME Kft.");
    expect(hdr).toContain("BB-1");
  });

  it("E6 a placeholder split over three runs is replaced", async () => {
    const r = await prep({ md: "x\n", args: ["--var", "version=2.0"] });
    const doc = partText(r.docx, "word/document.xml");
    expect(textsOf(doc).join("")).toContain("Version: 2.0");
    expect(r.report.unresolved).toEqual([]);
  });

  it("E7 values are XML-escaped and every changed part stays well-formed", async () => {
    const r = await prep({ md: "x\n", args: ["--var", "client_name=A & B <C>"] });
    const doc = partText(r.docx, "word/document.xml");
    expect(doc).toContain("A &amp; B &lt;C&gt;");
    for (const name of Object.keys(readDocx(r.docx)).filter((n) => /^word\/(document|header|footer)/.test(n))) {
      const xml = partText(r.docx, name);
      // no raw `<C>`-style element injected: every `<` starts a known tag
      expect(xml.match(/<[^>]*>/g)?.every((t) => /^<\/?(\?xml|w:|mc:|wp:|a:|wps:)/.test(t)), name).toBe(true);
    }
  });

  it("E8 <name> only for manifest `both` (or undeclared-syntax variables.xml) names", async () => {
    const tpl: TemplateSpec = {
      document: [para("<client_name>"), para("<$date>"), para("<draft>")],
      defaults: { client_name: "ACME", draft_unused: "z" },
      syntax: { client_name: "both", $date: "mustache" },
    };
    const r = await prep({ md: "x\n", template: tpl });
    const t = textsOf(partText(r.docx, "word/document.xml"));
    expect(t).toEqual(["ACME", "&lt;$date&gt;", "&lt;draft&gt;"]);
    expect(r.report.unresolved).toEqual([]);
    // markup untouched: only w:t text changed
    expect(partText(r.docx, "word/document.xml").replace(/<w:t[^>]*>[^<]*<\/w:t>/g, "")).toBe(partText(buildDocx(tpl), "word/document.xml").replace(/<w:t[^>]*>[^<]*<\/w:t>/g, ""));
  });

  it("E9 an unresolved placeholder fails with exit 1 unless --allow-missing; the report lists it either way", async () => {
    const tpl: TemplateSpec = { document: [para("{{ document_id }}")] };
    const a = await prep({ md: "x\n", template: tpl });
    expect(a.code).toBe(1);
    expect(a.report.unresolved).toEqual(["document_id"]);
    const b = await prep({ md: "x\n", template: tpl, args: ["--allow-missing"] });
    expect(b.code).toBe(0);
    expect(b.report.unresolved).toEqual(["document_id"]);
  });

  it("E10 a placeholder spanning two paragraphs is left and reported", async () => {
    const tpl: TemplateSpec = { document: [para("{{ ver"), para("sion }}")] };
    const r = await prep({ md: "x\n", template: tpl, args: ["--var", "version=1"] });
    expect(r.code).toBe(1);
    expect(textsOf(partText(r.docx, "word/document.xml"))).toEqual(["{{ ver", "sion }}"]);
    expect(r.report.unresolved.length).toBeGreaterThan(0);
  });

  it("E11 logo: slots are ignored and left in place", async () => {
    const tpl: TemplateSpec = { document: [para("x")], headers: { "header1.xml": [para("{{logo:company}}")] } };
    const r = await prep({ md: "x\n", template: tpl });
    expect(r.code).toBe(0);
    expect(textsOf(partText(r.docx, "word/header1.xml"))).toEqual(["{{logo:company}}"]);
    expect(r.report.ignored).toContain("logo:company");
  });

  it("E12 parts without a placeholder are byte-identical", async () => {
    const tpl = standardTemplate();
    tpl.extra = { "word/media/image1.png": "PNGDATA", "customXml/item1.xml": "<a/>" };
    const r = await prep({ md: "x\n", template: tpl });
    const before = readDocx(buildDocx(tpl));
    const after = readDocx(r.docx);
    for (const n of ["word/footer1.xml", "[Content_Types].xml", "word/_rels/document.xml.rels", "word/media/image1.png", "customXml/item1.xml"]) {
      expect(sha256(Buffer.from(after[n])), n).toBe(sha256(Buffer.from(before[n])));
    }
    expect(Object.keys(after)).toEqual(Object.keys(before));
  });
});

describe("body preparation", () => {
  it("E15 strips frontmatter, substitutes {{ name }} in prose, leaves <name> literal", async () => {
    const r = await prep({ md: `${FM("client_name: ACME")}Hi {{ client_name }} <client_name>\n` });
    expect(r.body).not.toContain("---");
    expect(r.body).toContain("Hi ACME <client_name>");
  });

  it("E16 images: inside and --allow-path are inlined; outside/absolute/symlink skipped; http listed", async () => {
    const png = Buffer.from("iVBORw0KGgo=", "base64");
    const outsideDir = tmpDir("craft-img-out-");
    fs.writeFileSync(path.join(outsideDir, "o.png"), png);
    const allowDir = tmpDir("craft-img-allow-");
    fs.writeFileSync(path.join(allowDir, "a.png"), png);
    const md = ["![in](img/a.png)", "![up](../secret.png)", `![abs](${path.join(outsideDir, "o.png")})`, "![link](img/link.png)", `![allow](${path.join(allowDir, "a.png")})`, "![web](https://example.com/x.png)"].join("\n\n");
    const r = await prep({
      md,
      files: { "img/a.png": png },
      args: ["--allow-path", allowDir],
      before: (work) => fs.symlinkSync(path.join(outsideDir, "o.png"), path.join(work, "img", "link.png")),
    });
    expect(r.code).toBe(0);
    expect(r.body.match(/data:image\/png;base64,/g)).toHaveLength(2);
    expect(r.report.images.inlined).toBe(2);
    expect(r.report.images.skipped.map((x) => x.path).sort()).toEqual(["../secret.png", path.join(outsideDir, "o.png"), "img/link.png"].sort());
    expect(r.report.images.skipped.every((x) => x.reason.length > 0)).toBe(true);
    expect(r.report.images.remote).toEqual(["https://example.com/x.png"]);
    expect(r.body).toContain("![up](../secret.png)");
    expect(r.body).toContain("https://example.com/x.png");
  });

  it("a template that owns images gets picture markers instead of data URIs (WordCraft image-import drift)", async () => {
    const png = Buffer.from("iVBORw0KGgo=", "base64");
    const withImage: TemplateSpec = { ...standardTemplate(), extra: { "word/_rels/document.xml.rels": '<Relationships xmlns="x"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>' } };
    const stubs = stubPath({ mmdc: true });
    const hit = await prep({ md: "![a](a.png)\n\n```mermaid\ngraph TD; A-->B\n```\n", files: { "a.png": png }, template: withImage, stubs });
    expect(hit.body).not.toContain("data:image");
    expect(hit.report.pictures).toEqual([
      { marker: "CRAFTIMG0001", file: "images/0001.png", alt: "a" },
      { marker: "CRAFTIMG0002", file: "images/0002.png", alt: "diagram" },
    ]);
    expect(hit.body).toContain("CRAFTIMG0001");
    expect(hit.body).toContain("CRAFTIMG0002");
    for (const pic of hit.report.pictures ?? []) expect(fs.existsSync(path.join(hit.dir, pic.file)), pic.file).toBe(true);
    expect(hit.report.images.inlined).toBe(1);
    expect(hit.report.mermaid.rendered).toBe(1);
    const plain = await prep({ md: "![a](a.png)\n", files: { "a.png": png } });
    expect(plain.report.pictures).toBeUndefined();
    expect(plain.body).toContain("data:image/png;base64,");
  });

  it("an image above the size cap, and a file type that is not an image, are skipped", async () => {
    const r = await prep({
      md: "![big](big.png)\n\n![env](secret.env)\n",
      files: { "big.png": Buffer.alloc(MAX_IMAGE_BYTES + 1), "secret.env": "TOKEN=1" },
    });
    expect(r.report.images.inlined).toBe(0);
    expect(r.report.images.skipped.map((x) => `${x.path}:${x.reason}`).sort()).toEqual(["big.png:image too large", "secret.env:unsupported image type"]);
  });

  it("E17 a variable cannot smuggle image or diagram syntax", async () => {
    const stubs = stubPath({ mmdc: true });
    const r = await prep({ md: "Note: {{ note }}\n", stubs, args: ["--var", "note=![x](/etc/passwd)", "--var", "diag=```mermaid\ngraph TD;A-->B\n```"] });
    expect(r.body).toContain("![x](/etc/passwd)");
    expect(r.body).not.toContain("data:image");
    const r2 = await prep({ md: "Diagram: {{ diag }}\n", stubs, args: ["--var", "diag=```mermaid\ngraph TD;A-->B\n```"] });
    expect(r2.body).toContain("```mermaid");
    expect(stubs.calls("mmdc")).toHaveLength(0);
    expect(r.report.warnings.length).toBeGreaterThan(0);
    expect(r2.report.warnings.length).toBeGreaterThan(0);
  });

  it("E18 Mermaid renders through host mmdc with argv only — no shell", async () => {
    const stubs = stubPath({ mmdc: true });
    const r = await prep({ md: "```mermaid\ngraph TD; A[$(touch PWNED)]-->B\n```\n", stubs });
    expect(r.code).toBe(0);
    expect(r.body).toMatch(/^!\[diagram\]\(data:image\/png;base64,/);
    expect(r.report.mermaid.rendered).toBe(1);
    expect(fs.existsSync(path.join(r.work, "PWNED"))).toBe(false);
    const [argv] = stubs.calls("mmdc");
    expect(argv[0]).toBe("-i");
    expect(fs.existsSync(argv[1])).toBe(false); // temp input is cleaned up
  });

  it("E19 without mmdc the block stays code and counts as unrendered (exit 0)", async () => {
    const r = await prep({ md: "```mermaid\ngraph TD; A-->B\n```\n", stubs: stubPath() });
    expect(r.code).toBe(0);
    expect(r.body).toContain("```mermaid");
    expect(r.report.mermaid.unrendered).toBe(1);
    expect(r.report.warnings.join(" ")).toContain("mmdc");
  });

  const NB = `${FM("nano_banana:\n  enabled: true\n  style: ros-3d")}\`\`\`mermaid\ngraph TD; A-->B\n\`\`\`\n`;
  const STYLES = "default: ros-3d\nstyles:\n  ros-3d:\n    prompt: STYLE ROS\n    negative: no cartoon\n  flat:\n    prompt: STYLE FLAT\n";

  it("E20 nano-banana results are cached by md5(style + source); a new style re-generates", async () => {
    const stubs = stubPath({ nano: "ok", mmdc: true });
    const tpl = { ...standardTemplate(), stylesYaml: STYLES };
    const a = await prep({ md: NB, stubs, template: tpl });
    expect(stubs.calls("pi-nano-banana")).toHaveLength(1);
    expect(a.report.mermaid).toMatchObject({ rendered: 1, cached: 0, style: "ros-3d" });
    const prompt = stubs.calls("pi-nano-banana")[0][0];
    expect(prompt).toContain("graph TD; A-->B");
    expect(prompt).toContain("STYLE ROS");
    expect(prompt).toContain("AVOID: no cartoon");
    const second = await rerun(a.work, stubs.env);
    expect(stubs.calls("pi-nano-banana")).toHaveLength(1);
    expect(second.mermaid.cached).toBe(1);
    fs.writeFileSync(path.join(a.work, "in.md"), NB.replace("ros-3d", "flat"));
    await rerun(a.work, stubs.env);
    expect(stubs.calls("pi-nano-banana")).toHaveLength(2);
    const key = (style: string) => createHash("md5").update(`${style}graph TD; A-->B`).digest("hex");
    for (const style of ["ros-3d", "flat"]) expect(fs.existsSync(path.join(a.work, ".mermaid-cache", `${key(style)}.png`)), style).toBe(true);
  });

  it("E21 a failing nano-banana falls back to mmdc", async () => {
    const stubs = stubPath({ nano: "fail", mmdc: true });
    const r = await prep({ md: NB, stubs });
    expect(r.code).toBe(0);
    expect(r.report.mermaid).toMatchObject({ rendered: 1, fallback: 1, unrendered: 0 });
  });

  it("E22 PlantUML stays code with a warning", async () => {
    const r = await prep({ md: "```plantuml\n@startuml\nA->B\n@enduml\n```\n" });
    expect(r.body).toContain("```plantuml");
    expect(r.report.warnings.join(" ")).toMatch(/plantuml/i);
  });

  it("E23 --json prints the report; a rerun overwrites only the three outputs", async () => {
    const stubs = stubPath({ mmdc: true });
    const first = await prep({ md: "x\n", stubs, args: ["--json"], files: { "out/keep.txt": "keep", "out/.mermaid-cache/x.png": "png" } });
    expect(JSON.parse(first.out)).toEqual(first.report);
    const before = ["template.filled.docx", "body.md", "prepare.json"].map((f) => fs.statSync(path.join(first.dir, f)).mtimeMs);
    await new Promise((r) => setTimeout(r, 20));
    expect(await rerun(first.work, stubs.env)).toEqual(first.report);
    const after = ["template.filled.docx", "body.md", "prepare.json"].map((f) => fs.statSync(path.join(first.dir, f)).mtimeMs);
    after.forEach((t, i) => expect(t).toBeGreaterThan(before[i]));
    expect(fs.readFileSync(path.join(first.dir, "keep.txt"), "utf8")).toBe("keep");
    expect(fs.readFileSync(path.join(first.dir, ".mermaid-cache", "x.png"), "utf8")).toBe("png");
  });
});

describe("argument errors", () => {
  it("exit 2 for a missing --out, an unknown option and a bad --var", async () => {
    for (const argv of [["in.md"], ["in.md", "--out", "o", "--bogus"], ["in.md", "--out", "o", "--var", "novalue"], []]) {
      const err: string[] = [];
      expect(await prepareDoc(argv, { stderr: (t) => err.push(t), stdout: () => {} })).toBe(2);
      expect(err.join("")).toContain("usage: pi-craft doc prepare");
    }
  });

  it("--help exits 0", async () => {
    const err: string[] = [];
    expect(await prepareDoc(["--help"], { stderr: (t) => err.push(t), stdout: () => {} })).toBe(0);
    expect(err.join("")).toContain("doc prepare");
  });

  it("a bundled textbox helper builds a docx with nested paragraphs", () => {
    expect(partText(buildDocx({ document: [textbox(para("a"))] }), "word/document.xml")).toContain("<w:txbxContent>");
  });
});
