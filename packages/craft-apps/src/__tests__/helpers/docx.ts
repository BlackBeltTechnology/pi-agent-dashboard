/**
 * Fixture builders for `pi-craft doc prepare`: a minimal docx (fflate), the doc-engine template layout
 * (`<templates>/<name>/template.docx` + `variables.xml` + `manifest.xml`), and stub `mmdc` / `pi-nano-banana`.
 * See change: add-craft-office-workflows.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { tmpDir } from "./fixtures.js";
import { encodePng, scene } from "./png.js";

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** One run per string. */
export const para = (...runs: string[]): string => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${runs.map((r) => `<w:r><w:rPr><w:b/></w:rPr><w:t>${esc(r)}</w:t></w:r>`).join("")}</w:p>`;
/** A wps textbox shape anchored on the page (the structure Word writes for a cover textbox). */
export const textbox = (...paras: string[]): string =>
  `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>2000000</wp:posOffset></wp:positionV><wp:extent cx="4720590" cy="1988820"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="Cover"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4720590" cy="1988820"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></wps:spPr><wps:txbx><w:txbxContent>${paras.join("")}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice></mc:AlternateContent></w:r></w:p>`;

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
export const wrapXml = (root: "w:document" | "w:hdr" | "w:ftr", inner: string): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${root} ${NS}>${root === "w:document" ? `<w:body>${inner}</w:body>` : inner}</${root}>`;

export interface DocxSpec {
  document: string[];
  /** part file name (e.g. `header2.xml`) → paragraphs */
  headers?: Record<string, string[]>;
  footers?: Record<string, string[]>;
  /** extra raw entries (name → text) */
  extra?: Record<string, string>;
}

export const CONTENT_TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';

export function buildDocx(spec: DocxSpec): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "word/_rels/document.xml.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'),
    "word/document.xml": strToU8(wrapXml("w:document", spec.document.join(""))),
  };
  for (const [n, ps] of Object.entries(spec.headers ?? {})) files[`word/${n}`] = strToU8(wrapXml("w:hdr", ps.join("")));
  for (const [n, ps] of Object.entries(spec.footers ?? {})) files[`word/${n}`] = strToU8(wrapXml("w:ftr", ps.join("")));
  for (const [n, t] of Object.entries(spec.extra ?? {})) files[n] = strToU8(t);
  return zipSync(files);
}

/** Decoded entries of a docx (text for xml parts). */
export function readDocx(buf: Uint8Array | Buffer): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(buf));
}
export const partText = (docx: Uint8Array | Buffer, name: string): string => strFromU8(readDocx(docx)[name]);
/** Raw (still escaped) text of every `w:t` node of a part, in order. */
export const textsOf = (xml: string): string[] => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]);

export interface TemplateSpec extends DocxSpec {
  /** name → default value */
  defaults?: Record<string, string>;
  /** name → syntax (`both`/`mustache`) declared in manifest.xml */
  syntax?: Record<string, string>;
  stylesYaml?: string;
}

/** Write `<root>/<name>/template.docx` (+ variables.xml / manifest.xml / styles). Returns the templates root. */
export function writeTemplate(root: string, name: string, spec: TemplateSpec): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "template.docx"), buildDocx(spec));
  if (spec.defaults) {
    fs.writeFileSync(
      path.join(dir, "variables.xml"),
      `<?xml version="1.0"?><variables version="1.0">${Object.entries(spec.defaults)
        .map(([k, v]) => `<!-- c --><variable name="${k}"><default>${esc(v)}</default><location>x</location></variable>`)
        .join("")}</variables>`,
    );
  }
  if (spec.syntax) {
    fs.writeFileSync(
      path.join(dir, "manifest.xml"),
      `<?xml version="1.0"?><template name="${name}"><features><textbox enabled="true">${Object.entries(spec.syntax)
        .map(([k, v]) => `<variable\n name="${k}" location="x"\n syntax="${v}" />`)
        .join("")}</textbox></features></template>`,
    );
  }
  if (spec.stylesYaml) fs.writeFileSync(path.join(dir, "nano-banana-styles.yaml"), spec.stylesYaml);
  return root;
}

/** The standard fixture: textbox cover (client_name), body paragraph + split run, first-page header (document_id), footer. */
export function standardTemplate(): TemplateSpec {
  return {
    document: [
      textbox(para("{{ client_name }}"), para("Verzió ", "{{ version }}")),
      para("Version: ", "{{ ", "version", " }}"),
    ],
    headers: { "header1.xml": [para("{{ project_name }}")], "header2.xml": [para("{{ document_id }}")] },
    footers: { "footer1.xml": [para("Plain footer")] },
    defaults: { client_name: "DEFAULT CLIENT", version: "0.1", project_name: "DEFAULT PROJECT", document_id: "DOC-0" },
    syntax: { client_name: "both", version: "both", project_name: "both", document_id: "both" },
  };
}

// ── stubs on PATH ───────────────────────────────────────────────────────────

export const ONE_PX_PNG = encodePng(scene(2, 2, [255, 255, 255]));

/** A fresh PATH dir holding only `node` (symlink) plus the requested stubs. Returns { dir, env, log }. */
export function stubPath(opts: { mmdc?: boolean; nano?: "ok" | "fail" } = {}): { dir: string; env: NodeJS.ProcessEnv; calls: (name: string) => string[][] } {
  const dir = tmpDir("craft-stubs-");
  fs.symlinkSync(process.execPath, path.join(dir, "node"));
  const png = JSON.stringify(ONE_PX_PNG.toString("base64"));
  const write = (name: string, body: string) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, `#!/usr/bin/env node\nconst fs=require("fs");const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(path.join(dir, `${name}.calls`))},JSON.stringify(a)+"\\n");\n${body}\n`);
    fs.chmodSync(f, 0o755);
  };
  if (opts.mmdc) write("mmdc", `const o=a[a.indexOf("-o")+1];fs.writeFileSync(o,Buffer.from(${png},"base64"));`);
  if (opts.nano === "ok") write("pi-nano-banana", `const o=a[a.indexOf("--output")+1];fs.writeFileSync(o,Buffer.from(${png},"base64"));`);
  if (opts.nano === "fail") write("pi-nano-banana", `process.stderr.write("no credentials\\n");process.exit(1);`);
  const calls = (name: string): string[][] => {
    try {
      return fs.readFileSync(path.join(dir, `${name}.calls`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]);
    } catch {
      return [];
    }
  };
  return { dir, env: { PATH: dir, HOME: dir }, calls };
}

/**
 * A docx WordCraft really opens: styles, a textbox cover (`{{ client_name }}`), a first-page header (`{{ document_id }}`),
 * a default header and a footer, wired through the section properties, relationships and content types.
 */
export function realisticDocx(): Uint8Array {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`;
  const spec: DocxSpec = {
    document: [
      textbox(para("{{ client_name }}"), para("{{ project_name }}")),
      `<w:sectPr><w:headerReference w:type="default" r:id="rId11"/><w:headerReference w:type="first" r:id="rId12"/><w:footerReference w:type="default" r:id="rId13"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:titlePg/></w:sectPr>`,
    ],
    headers: { "header1.xml": [para("Default header {{ project_name }}")], "header2.xml": [para("First page {{ document_id }}")] },
    footers: { "footer1.xml": [para("Footer")] },
    extra: {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId1", "officeDocument", "word/document.xml")}</Relationships>`,
      "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId10", "styles", "styles.xml")}${rel("rId11", "header", "header1.xml")}${rel("rId12", "header", "header2.xml")}${rel("rId13", "footer", "footer1.xml")}</Relationships>`,
      "word/styles.xml": `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W}/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style></w:styles>`,
    },
  };
  return buildDocx(spec);
}
