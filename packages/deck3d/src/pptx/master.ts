/**
 * Slide layout / master inheritance (design D1 `master.ts`): placeholder
 * geometry and text styles, and the master's text style families.
 */
import type { Package } from "./package.js";
import { child, path, type XNode } from "./xml.js";

export interface PhInfo {
  type: string;
  idx?: string;
}

interface PhEntry extends PhInfo {
  sp: XNode;
}

/** `p:ph` of a shape (`p:sp`, `p:pic`, `p:graphicFrame`), when it is a placeholder. */
export function placeholderOf(shape: XNode): PhInfo | undefined {
  const nv = shape.children.find((c) => c.name.startsWith("p:nv"));
  const ph = path(nv, "p:nvPr", "p:ph");
  if (!ph) return undefined;
  return { type: ph.attrs.type ?? "body", idx: ph.attrs.idx };
}

export function isTitleType(type: string | undefined): boolean {
  return type === "title" || type === "ctrTitle";
}

/** Master placeholder family a slide/layout placeholder type falls back to. */
function masterType(type: string): string {
  if (isTitleType(type)) return "title";
  if (type === "dt" || type === "ftr" || type === "sldNum") return type;
  return "body";
}

function indexPlaceholders(spTree: XNode | undefined): PhEntry[] {
  const out: PhEntry[] = [];
  const walk = (n: XNode | undefined): void => {
    for (const c of n?.children ?? []) {
      if (c.name === "p:grpSp") walk(c);
      const ph = placeholderOf(c);
      if (ph) out.push({ ...ph, sp: c });
    }
  };
  walk(spTree);
  return out;
}

export interface Inheritance {
  /** Text list styles, highest priority first (layout ph, master ph, family, default). */
  lists: XNode[];
  /** `a:bodyPr` chain (layout ph, master ph). */
  bodyPrs: XNode[];
  /** First inherited `a:xfrm` when the shape has none of its own. */
  xfrm?: XNode;
}

/** Per-slide resolver for placeholder and text-style inheritance. */
export class MasterChain {
  private readonly defaultTextStyle: XNode | undefined;
  readonly layoutTree?: XNode;
  readonly masterTree?: XNode;
  private layoutPh: PhEntry[];
  private masterPh: PhEntry[];
  private txStyles?: XNode;

  constructor(
    pkg: Package,
    layoutPart: string | undefined,
    masterPart: string | undefined,
    defaultTextStyle: XNode | undefined,
  ) {
    this.defaultTextStyle = defaultTextStyle;
    const layout = layoutPart ? pkg.xml(layoutPart) : undefined;
    const master = masterPart ? pkg.xml(masterPart) : undefined;
    this.layoutTree = path(layout, "p:cSld", "p:spTree");
    this.masterTree = path(master, "p:cSld", "p:spTree");
    this.layoutPh = indexPlaceholders(this.layoutTree);
    this.masterPh = indexPlaceholders(this.masterTree);
    this.txStyles = child(master, "p:txStyles");
  }

  private matchLayout(ph: PhInfo): PhEntry | undefined {
    if (ph.idx !== undefined) {
      const byIdx = this.layoutPh.find((e) => e.idx === ph.idx);
      if (byIdx) return byIdx;
    }
    return (
      this.layoutPh.find((e) => e.type === ph.type) ??
      (isTitleType(ph.type) ? this.layoutPh.find((e) => isTitleType(e.type)) : undefined)
    );
  }

  private matchMaster(ph: PhInfo): PhEntry | undefined {
    const want = masterType(ph.type);
    return this.masterPh.find((e) => masterType(e.type) === want);
  }

  /** Inheritance for a placeholder (`ph`) or a plain shape (`undefined`). */
  resolve(ph: PhInfo | undefined): Inheritance {
    const family = ph
      ? child(this.txStyles, isTitleType(ph.type) ? "p:titleStyle" : masterType(ph.type) === "body" ? "p:bodyStyle" : "p:otherStyle")
      : child(this.txStyles, "p:otherStyle");
    if (!ph) {
      return { lists: [this.defaultTextStyle, family].filter((n): n is XNode => !!n), bodyPrs: [] };
    }
    const chain = [this.matchLayout(ph), this.matchMaster(ph)].filter((e): e is PhEntry => !!e);
    const lists: XNode[] = [];
    const bodyPrs: XNode[] = [];
    let xfrm: XNode | undefined;
    for (const e of chain) {
      const tx = child(e.sp, "p:txBody");
      const ls = child(tx, "a:lstStyle");
      if (ls) lists.push(ls);
      const bp = child(tx, "a:bodyPr");
      if (bp) bodyPrs.push(bp);
      xfrm ??= path(e.sp, "p:spPr", "a:xfrm") ?? child(e.sp, "p:xfrm");
    }
    if (family) lists.push(family);
    if (this.defaultTextStyle) lists.push(this.defaultTextStyle);
    return { lists, bodyPrs, xfrm };
  }
}

/** True when a `p:sld`/`p:sldLayout` hides master shapes (`showMasterSp="0"`). */
export function hidesMasterShapes(root: XNode | undefined): boolean {
  const v = root?.attrs.showMasterSp;
  return v === "0" || v === "false";
}

/** Background node (`p:bg`) of a slide/layout/master part. */
export function backgroundOf(root: XNode | undefined): XNode | undefined {
  return path(root, "p:cSld", "p:bg");
}

