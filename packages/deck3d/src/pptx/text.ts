/**
 * Text bodies → paragraphs and runs (design D1 `text.ts`).
 *
 * Paragraph/run properties resolve through a priority chain of list styles:
 * the paragraph's own `a:pPr`/`a:rPr` → the shape's `a:lstStyle` → the
 * matching layout placeholder → the matching master placeholder → the
 * master's `p:txStyles` entry → the presentation `defaultTextStyle`. Sizes
 * apply the `normAutofit` `fontScale` and line spacing the `lnSpcReduction`
 * that the authoring application STORED — fit is never recomputed.
 */
import { type ColorEnv, resolveColor } from "./theme.js";
import type { Insets, LayoutParagraph, LayoutRun, ThemeInfo } from "./types.js";
import { child, kids, num, type XNode } from "./xml.js";

/** EMU per point. */
const EMU_PT = 12700;
const DEFAULT_SIZE_PT = 18;

export interface TextEnv {
  color: ColorEnv;
  theme: ThemeInfo;
  /** EMU → slide units. */
  scale: number;
  /** List-style nodes (children `a:lvlNpPr`, `a:defPPr`), highest priority first. */
  lists: XNode[];
  /** `a:bodyPr` nodes, highest priority first (shape, layout ph, master ph). */
  bodyPrs: XNode[];
  /** Colour from the shape's `p:style/a:fontRef`, a run's last colour fallback. */
  fontRefColor?: string;
}

export interface TextBody {
  paragraphs: LayoutParagraph[];
  anchor: "t" | "ctr" | "b";
  insets: Insets;
  vertical: boolean;
  autofit: "none" | "norm" | "shape";
  /** `a:prstTxWarp` other than `textNoShape` — WordArt, rendered as a fallback. */
  wordArt: boolean;
}

function levelNodes(lists: XNode[], lvl: number): XNode[] {
  const out: XNode[] = [];
  for (const list of lists) {
    const lv = child(list, `a:lvl${lvl + 1}pPr`);
    if (lv) out.push(lv);
    const def = child(list, "a:defPPr");
    if (def) out.push(def);
  }
  return out;
}

function firstAttr(nodes: Array<XNode | undefined>, name: string): string | undefined {
  for (const n of nodes) {
    const v = n?.attrs[name];
    if (v !== undefined) return v;
  }
  return undefined;
}

function firstChild(nodes: Array<XNode | undefined>, name: string): XNode | undefined {
  for (const n of nodes) {
    const c = child(n, name);
    if (c) return c;
  }
  return undefined;
}

function bool(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

function resolveFont(typeface: string | undefined, theme: ThemeInfo): string {
  if (!typeface || typeface === "+mn-lt" || typeface === "+mn-ea" || typeface === "+mn-cs") return theme.fonts.minor;
  if (typeface === "+mj-lt" || typeface === "+mj-ea" || typeface === "+mj-cs") return theme.fonts.major;
  return typeface;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

interface Autofit {
  mode: "none" | "norm" | "shape";
  fontScale: number;
  lnSpcReduction: number;
}

function readAutofit(bodyPrs: XNode[]): Autofit {
  for (const b of bodyPrs) {
    const norm = child(b, "a:normAutofit");
    if (norm) {
      return {
        mode: "norm",
        fontScale: num(norm.attrs.fontScale, 100000) / 100000,
        lnSpcReduction: num(norm.attrs.lnSpcReduction, 0) / 100000,
      };
    }
    if (child(b, "a:spAutoFit")) return { mode: "shape", fontScale: 1, lnSpcReduction: 0 };
    if (child(b, "a:noAutofit")) return { mode: "none", fontScale: 1, lnSpcReduction: 0 };
  }
  return { mode: "none", fontScale: 1, lnSpcReduction: 0 };
}

/** Space value of `a:spcBef`/`a:spcAft`/`a:lnSpc`: `{pts}` (points) or `{pct}` (fraction). */
function spacing(node: XNode | undefined): { pts?: number; pct?: number } | undefined {
  if (!node) return undefined;
  const pts = child(node, "a:spcPts");
  if (pts) return { pts: num(pts.attrs.val) / 100 };
  const pct = child(node, "a:spcPct");
  if (pct) return { pct: num(pct.attrs.val) / 100000 };
  return undefined;
}

function paragraphText(p: XNode): string {
  let s = "";
  for (const c of p.children) {
    if (c.name === "a:r" || c.name === "a:fld") s += child(c, "a:t")?.text ?? "";
    else if (c.name === "a:br") s += "\n";
  }
  return s;
}

/** Plain text of a `p:txBody`, paragraphs joined by `\n`. */
export function bodyText(txBody: XNode | undefined): string {
  return kids(txBody, "a:p").map(paragraphText).join("\n");
}

export function readTextBody(txBody: XNode, env: TextEnv): TextBody {
  const bodyPrs = [child(txBody, "a:bodyPr"), ...env.bodyPrs].filter((n): n is XNode => !!n);
  const lists = [child(txBody, "a:lstStyle"), ...env.lists].filter((n): n is XNode => !!n);
  const fit = readAutofit(bodyPrs);
  const anchorRaw = firstAttr(bodyPrs, "anchor");
  const anchor: TextBody["anchor"] = anchorRaw === "ctr" ? "ctr" : anchorRaw === "b" ? "b" : "t";
  const ins = (name: string, d: number) => round2(num(firstAttr(bodyPrs, name), d) * env.scale);
  const vert = firstAttr(bodyPrs, "vert");
  const warp = firstChild(bodyPrs, "a:prstTxWarp");

  const paragraphs: LayoutParagraph[] = [];
  for (const p of kids(txBody, "a:p")) {
    const pPr = child(p, "a:pPr");
    const lvl = Math.min(8, Math.max(0, num(pPr?.attrs.lvl, 0)));
    const pNodes = [pPr, ...levelNodes(lists, lvl)];
    const defRPrs = pNodes.map((n) => child(n, "a:defRPr"));

    const runs: LayoutRun[] = [];
    let firstSizePt: number | undefined;
    for (const r of p.children) {
      if (r.name !== "a:r" && r.name !== "a:fld" && r.name !== "a:br") continue;
      const rPr = child(r, "a:rPr");
      const rNodes = [rPr, ...defRPrs];
      const sizePt = num(firstAttr(rNodes, "sz"), DEFAULT_SIZE_PT * 100) / 100;
      firstSizePt ??= sizePt;
      const fill = firstChild(rNodes, "a:solidFill");
      const color = resolveColor(fill, env.color)?.hex ?? env.fontRefColor ?? env.color.theme.colors.dk1;
      const latin = firstChild(rNodes, "a:latin");
      const u = firstAttr(rNodes, "u");
      const text = r.name === "a:br" ? "\n" : (child(r, "a:t")?.text ?? "");
      runs.push({
        text,
        size: round2(sizePt * fit.fontScale * EMU_PT * env.scale),
        bold: bool(firstAttr(rNodes, "b")),
        italic: bool(firstAttr(rNodes, "i")),
        underline: u !== undefined && u !== "none",
        color,
        font: resolveFont(latin?.attrs.typeface, env.theme),
      });
    }

    const sizePt = (firstSizePt ?? num(firstAttr(defRPrs, "sz"), DEFAULT_SIZE_PT * 100) / 100) * fit.fontScale;
    const ln = spacing(firstChild(pNodes, "a:lnSpc"));
    const baseLine = ln?.pct ?? (ln?.pts !== undefined ? ln.pts / (sizePt * 1.2) : 1);
    const lineSpacing = round3(Math.max(0.1, baseLine - fit.lnSpcReduction));
    const toUnits = (s: { pts?: number; pct?: number } | undefined) =>
      round2(s ? (s.pts !== undefined ? s.pts : (s.pct ?? 0) * sizePt) * EMU_PT * env.scale : 0);
    const algn = firstAttr(pNodes, "algn");
    // The highest-priority node that says anything about bullets decides.
    const buNode = pNodes.find((n) => child(n, "a:buNone") || child(n, "a:buChar") || child(n, "a:buAutoNum"));
    const buChar = child(buNode, "a:buChar");
    const para: LayoutParagraph = {
      align: algn === "ctr" ? "ctr" : algn === "r" ? "r" : algn === "just" || algn === "dist" ? "just" : "l",
      lineSpacing,
      spaceBefore: toUnits(spacing(firstChild(pNodes, "a:spcBef"))),
      spaceAfter: toUnits(spacing(firstChild(pNodes, "a:spcAft"))),
      level: lvl,
      runs,
    };
    if (buChar?.attrs.char) para.bullet = buChar.attrs.char;
    paragraphs.push(para);
  }

  return {
    paragraphs,
    anchor,
    insets: { l: ins("lIns", 91440), t: ins("tIns", 45720), r: ins("rIns", 91440), b: ins("bIns", 45720) },
    vertical: vert !== undefined && vert !== "horz",
    autofit: fit.mode,
    wordArt: !!warp && warp.attrs.prst !== undefined && warp.attrs.prst !== "textNoShape",
  };
}
