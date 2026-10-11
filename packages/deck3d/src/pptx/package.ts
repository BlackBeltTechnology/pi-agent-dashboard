/**
 * OPC package navigation: relationships, the presentation's slide list and
 * size, and each slide's layout → master → theme chain.
 */
import { posix } from "node:path";
import { PptxImportError } from "./types.js";
import { child, kids, num, parseXml, path, type XNode } from "./xml.js";

export interface Rel {
  type: string;
  target: string;
  /** Resolved package part name (no leading `/`), or the raw target when external. */
  part: string;
  external: boolean;
}

export type Rels = Record<string, Rel>;

export class Package {
  private xmlCache = new Map<string, XNode>();
  private relCache = new Map<string, Rels>();

  constructor(readonly files: Map<string, Uint8Array>) {}

  has(part: string): boolean {
    return this.files.has(part);
  }

  bytes(part: string): Uint8Array | undefined {
    return this.files.get(part);
  }

  xml(part: string): XNode | undefined {
    const cached = this.xmlCache.get(part);
    if (cached) return cached;
    const data = this.files.get(part);
    if (!data) return undefined;
    let node: XNode;
    try {
      node = parseXml(data);
    } catch (err) {
      throw new PptxImportError(`malformed XML in '${part}': ${(err as Error).message}`);
    }
    this.xmlCache.set(part, node);
    return node;
  }

  rels(part: string): Rels {
    const cached = this.relCache.get(part);
    if (cached) return cached;
    const dir = posix.dirname(part);
    const relsPart = posix.join(dir, "_rels", `${posix.basename(part)}.rels`);
    const out: Rels = {};
    const root = this.xml(relsPart);
    for (const r of kids(root, "Relationship")) {
      const id = r.attrs.Id;
      const target = r.attrs.Target ?? "";
      if (!id) continue;
      const external = r.attrs.TargetMode === "External";
      const resolved = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join(dir, target));
      out[id] = { type: r.attrs.Type ?? "", target, part: external ? target : resolved, external };
    }
    this.relCache.set(part, out);
    return out;
  }

  /** First relationship of `part` whose type ends with `/<suffix>`. */
  relOfType(part: string, suffix: string): Rel | undefined {
    return Object.values(this.rels(part)).find((r) => r.type.endsWith(`/${suffix}`));
  }
}

export interface SlideChain {
  slide: string;
  layout?: string;
  master?: string;
  theme?: string;
}

export interface PresentationInfo {
  /** Slide size in EMU. */
  width: number;
  height: number;
  slides: SlideChain[];
  defaultTextStyle?: XNode;
}

export function readPresentation(pkg: Package): PresentationInfo {
  const presPart = "ppt/presentation.xml";
  const pres = pkg.xml(presPart);
  if (!pres) throw new PptxImportError("not a .pptx (OOXML) file");
  const size = child(pres, "p:sldSz");
  const width = num(size?.attrs.cx, 12192000);
  const height = num(size?.attrs.cy, 6858000);
  const rels = pkg.rels(presPart);
  const slides: SlideChain[] = [];
  for (const id of kids(path(pres, "p:sldIdLst"), "p:sldId")) {
    const rel = rels[id.attrs["r:id"] ?? ""];
    if (!rel || rel.external || !pkg.has(rel.part)) continue;
    const layout = pkg.relOfType(rel.part, "slideLayout")?.part;
    const master = layout ? pkg.relOfType(layout, "slideMaster")?.part : undefined;
    const theme = master ? pkg.relOfType(master, "theme")?.part : undefined;
    slides.push({ slide: rel.part, layout, master, theme });
  }
  return { width, height, slides, defaultTextStyle: child(pres, "p:defaultTextStyle") };
}
