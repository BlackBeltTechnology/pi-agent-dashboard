/**
 * Synthetic pptx fixtures, generated at test time from XML templates with
 * fflate — no committed binary decks (change deck3d-pptx-import, task 2.1).
 *
 * `buildPptx` writes a minimal but well-formed OOXML package (content types,
 * presentation, one master + layout + theme, N slides with rels and media).
 * `rawZip` writes arbitrary entries with caller-controlled compressed bytes
 * and declared sizes, for the hostile-input scenarios.
 */
import { zipSync } from "fflate";
import { encodePng } from "../../art/png.js";

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export const EMU_16x9 = { cx: 12192000, cy: 6858000 };
export const EMU_4x3 = { cx: 9144000, cy: 6858000 };

export interface SlideSpec {
  /** Inner XML of `p:spTree` (after the group props). */
  shapes: string;
  /** Extra relationships: rId → `[type suffix, target]`. */
  rels?: Record<string, [string, string]>;
  /** `p:bg` XML. */
  bg?: string;
}

export interface PptxSpec {
  size?: { cx: number; cy: number };
  slides: SlideSpec[];
  /** `ppt/media/<name>` → bytes. */
  media?: Record<string, Uint8Array>;
  accent2?: string;
  masterShapes?: string;
  masterBg?: string;
  /** Extra files merged into the package last (may override). */
  extra?: Record<string, Uint8Array | string>;
}

const enc = (s: string) => new TextEncoder().encode(s);

function rels(entries: Array<[string, string, string]>): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`)
    .join("")}</Relationships>`;
}

function theme(accent2: string): string {
  const c = (n: string, v: string) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme ${NS} name="T"><a:themeElements><a:clrScheme name="T">${c("dk1", "000000")}${c("lt1", "FFFFFF")}${c("dk2", "1F2937")}${c("lt2", "E7E6E6")}${c("accent1", "4472C4")}${c("accent2", accent2)}${c("accent3", "A5A5A5")}${c("accent4", "FFC000")}${c("accent5", "5B9BD5")}${c("accent6", "70AD47")}${c("hlink", "0563C1")}${c("folHlink", "954F72")}</a:clrScheme><a:fontScheme name="T"><a:majorFont><a:latin typeface="Poppins"/></a:majorFont><a:minorFont><a:latin typeface="Poppins"/></a:minorFont></a:fontScheme><a:fmtScheme name="T"/></a:themeElements></a:theme>`;
}

const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';

export function buildPptx(spec: PptxSpec): Uint8Array {
  const size = spec.size ?? EMU_16x9;
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, s: string | Uint8Array) => {
    files[path] = typeof s === "string" ? enc(s) : s;
  };
  const slideOverrides = spec.slides
    .map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
    .join("");
  put(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="emf" ContentType="image/x-emf"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slideOverrides}</Types>`,
  );
  put("_rels/.rels", rels([["rId1", "officeDocument", "ppt/presentation.xml"]]));
  put(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst><p:sldIdLst>${spec.slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`)
      .join("")}</p:sldIdLst><p:sldSz cx="${size.cx}" cy="${size.cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  put(
    "ppt/_rels/presentation.xml.rels",
    rels([["rIdM", "slideMaster", "slideMasters/slideMaster1.xml"], ...spec.slides.map((_, i) => [`rId${i + 1}`, "slide", `slides/slide${i + 1}.xml`] as [string, string, string])]),
  );
  put(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${NS}><p:cSld>${spec.masterBg ?? '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg>'}<p:spTree>${GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:r><a:t>Master title</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Body</a:t></a:r></a:p></p:txBody></p:sp>${spec.masterShapes ?? ""}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
  );
  put(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    rels([
      ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
      ["rId2", "theme", "../theme/theme1.xml"],
      ...Object.keys(spec.media ?? {}).map((n, i) => [`rIdMM${i}`, "image", `../media/${n}`] as [string, string, string]),
    ]),
  );
  put(
    "ppt/slideLayouts/slideLayout1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${NS}><p:cSld><p:spTree>${GRP}</p:spTree></p:cSld></p:sldLayout>`,
  );
  put("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]));
  put("ppt/theme/theme1.xml", theme(spec.accent2 ?? "ED7D31"));
  spec.slides.forEach((s, i) => {
    put(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld>${s.bg ?? ""}<p:spTree>${GRP}${s.shapes}</p:spTree></p:cSld></p:sld>`,
    );
    put(
      `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ...Object.entries(s.rels ?? {}).map(([id, [t, target]]) => [id, t, target] as [string, string, string])]),
    );
  });
  for (const [name, bytes] of Object.entries(spec.media ?? {})) put(`ppt/media/${name}`, bytes);
  for (const [path, data] of Object.entries(spec.extra ?? {})) put(path, data);
  return zipSync(files, { level: 6 });
}

// ── shape snippets ───────────────────────────────────────────────────────────

let nextId = 10;
const nv = (name: string, ph = "") => `<p:nvSpPr><p:cNvPr id="${nextId++}" name="${name}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>`;
const xfrm = (x: number, y: number, w: number, h: number, extra = "") => `<a:xfrm${extra}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function titleShape(text: string): string {
  return `<p:sp>${nv("Title", '<p:ph type="title"/>')}<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

export function bodyShape(paragraphs: string[]): string {
  return `<p:sp>${nv("Body", '<p:ph idx="1"/>')}<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs
    .map((p) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(p)}</a:t></a:r></a:p>`)
    .join("")}</p:txBody></p:sp>`;
}

export interface TextBoxOpts {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Rest of the `<a:rPr` tag, including its close (default `/>`). */
  runXml?: string;
  bodyPr?: string;
}

export function textBox(text: string, o: TextBoxOpts = {}): string {
  return `<p:sp>${nv("TextBox")}<p:spPr>${xfrm(o.x ?? 914400, o.y ?? 914400, o.w ?? 3657600, o.h ?? 914400)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody>${o.bodyPr ?? "<a:bodyPr/>"}<a:lstStyle/><a:p><a:r><a:rPr lang="en-US"${o.runXml ?? "/>"}<a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

/** A shape with an UNSUPPORTED gradient fill that also carries text (imports as a fallback + a text item). */
export function gradTextShape(text: string, x: number, y: number, w: number, h: number, sizeHundredths = 8000): string {
  return `<p:sp>${nv("Grad")}<p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="2040C0"/></a:gs><a:gs pos="100000"><a:srgbClr val="6080FF"/></a:gs></a:gsLst></a:gradFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="${sizeHundredths}"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

export function rectShape(x: number, y: number, w: number, h: number, hex: string, prst = "rect"): string {
  return `<p:sp>${nv("Rect")}<p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
}

export function picShape(rId: string, x: number, y: number, w: number, h: number, opts: { svgRId?: string; xfrmExtra?: string; blipExtra?: string } = {}): string {
  const svg = opts.svgRId
    ? `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${opts.svgRId}"/></a:ext></a:extLst>`
    : "";
  return `<p:pic><p:nvPicPr><p:cNvPr id="${nextId++}" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rId}">${opts.blipExtra ?? ""}${svg}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(x, y, w, h, opts.xfrmExtra ?? "")}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

export function groupShape(inner: string, g: { x: number; y: number; w: number; h: number; chX: number; chY: number; chW: number; chH: number; rot?: number }): string {
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${nextId++}" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm${g.rot ? ` rot="${g.rot}"` : ""}><a:off x="${g.x}" y="${g.y}"/><a:ext cx="${g.w}" cy="${g.h}"/><a:chOff x="${g.chX}" y="${g.chY}"/><a:chExt cx="${g.chW}" cy="${g.chH}"/></a:xfrm></p:grpSpPr>${inner}</p:grpSp>`;
}

export function graphicFrame(uri: string, x: number, y: number, w: number, h: number): string {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${nextId++}" name="Frame"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></p:xfrm><a:graphic><a:graphicData uri="${uri}"/></a:graphic></p:graphicFrame>`;
}

export const URI = {
  chart: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  table: "http://schemas.openxmlformats.org/drawingml/2006/table",
};

/** Solid-colour PNG (w × h), optionally with a coloured box drawn in. */
export function solidPng(w: number, h: number, rgba: [number, number, number, number], box?: { x: number; y: number; w: number; h: number; rgba: [number, number, number, number] }): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  if (box) {
    for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) data.set(box.rgba, (y * w + x) * 4);
  }
  return encodePng({ width: w, height: h, data });
}

/** A slide deck of `n` titled slides with body bullets (and one picture on slide 2). */
export function basicDeck(n: number, opts: { titles?: string[]; size?: { cx: number; cy: number } } = {}): PptxSpec {
  const png = solidPng(8, 8, [200, 30, 30, 255]);
  return {
    size: opts.size,
    media: { "image1.png": png },
    slides: Array.from({ length: n }, (_, i) => ({
      shapes:
        titleShape(opts.titles?.[i] ?? `Slide ${i + 1} title`) +
        bodyShape([`Point ${i + 1}a`, `Point ${i + 1}b`]) +
        (i === 1 ? picShape("rId2", 7000000, 2000000, 2000000, 2000000) : ""),
      rels: i === 1 ? { rId2: ["image", "../media/image1.png"] } : undefined,
    })),
  };
}

// ── raw zip writer (hostile inputs) ──────────────────────────────────────────

export interface RawEntry {
  name: string;
  /** Bytes as stored (already compressed for method 8). */
  stored: Uint8Array;
  method: 0 | 8;
  /** Declared uncompressed size. */
  size: number;
  crc?: number;
}

export function rawZip(entries: RawEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc(e.name);
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, e.method, true);
    lv.setUint32(14, e.crc ?? 0, true);
    lv.setUint32(18, e.stored.length, true);
    lv.setUint32(22, e.size, true);
    lv.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, e.method, true);
    cv.setUint32(16, e.crc ?? 0, true);
    cv.setUint32(20, e.stored.length, true);
    cv.setUint32(24, e.size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    ch.set(name, 46);
    locals.push(lh, e.stored);
    centrals.push(ch);
    offset += lh.length + e.stored.length;
  }
  const cdSize = centrals.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...locals, ...centrals, eocd];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of all) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

