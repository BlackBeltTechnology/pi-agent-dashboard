/**
 * Shape tree walker (design D1 `shapes.ts` + `pictures.ts`): `p:spTree` →
 * draw items in z-order. Supported: text boxes and placeholders, solid-filled
 * presets `rect | line | ellipse | roundRect`, pictures (PNG, JPEG, GIF, SVG)
 * with crop/rotation/flip, groups (flattened through `xfrm.ts`). Everything
 * else becomes a `fallback` item naming its construct.
 */
import type { MasterChain, PhInfo } from "./master.js";
import { isTitleType, placeholderOf } from "./master.js";
import { extOf, type MediaRegistry } from "./media.js";
import type { Package } from "./package.js";
import { bodyText, readTextBody } from "./text.js";
import { type ColorEnv, resolveColor } from "./theme.js";
import type { FallbackConstruct, LayoutItem, ThemeInfo } from "./types.js";
import { type Frame, groupFrame, normDeg, type Placed, readXfrm, toSlide } from "./xfrm.js";
import { child, descendant, num, path, type XNode } from "./xml.js";

/** An item before its `sNN-iMMM` id is assigned. */
export type DraftItem = LayoutItem extends infer T ? (T extends LayoutItem ? Omit<T, "id"> : never) : never;

export interface Draft {
  item: DraftItem;
  /** Plain text the item carries (fingerprint, baseline deck). */
  text: string;
  /** Title / centre-title placeholder. */
  isTitle: boolean;
  placeholder?: string;
}

export interface WalkCtx {
  pkg: Package;
  /** Part whose relationships resolve `r:embed` (slide, layout or master). */
  part: string;
  scale: number;
  color: ColorEnv;
  theme: ThemeInfo;
  chain: MasterChain;
  media: MediaRegistry;
  origin?: "master";
  /** Master/layout placeholders are prompts, never drawn. */
  skipPlaceholders: boolean;
}

const SUPPORTED_PRESETS = new Set(["rect", "line", "ellipse", "roundRect"]);
const RASTER = new Set(["png", "jpg", "jpeg", "gif"]);

const GRAPHIC_URI: Array<[string, FallbackConstruct]> = [
  ["/chart", "chart"],
  ["/diagram", "smartart"],
  ["/table", "table"],
  ["/ole", "ole"],
];

function base(p: Placed, ctx: WalkCtx) {
  return {
    rect: toSlide(p, ctx.scale),
    rotation: normDeg(p.rot),
    flipH: p.flipH,
    flipV: p.flipV,
    ...(ctx.origin ? { origin: ctx.origin } : {}),
  };
}

function fallback(p: Placed, ctx: WalkCtx, construct: FallbackConstruct, text = ""): Draft {
  return { item: { kind: "fallback", construct, ...base(p, ctx) }, text, isTitle: false };
}

function placedOf(shape: XNode, xfrmNode: XNode | undefined, ph: PhInfo | undefined, ctx: WalkCtx, frame: Frame): Placed | undefined {
  const own = readXfrm(xfrmNode);
  const inherited = own ? undefined : ph ? readXfrm(ctx.chain.resolve(ph).xfrm) : undefined;
  const p = own ?? inherited;
  return p ? frame(p) : undefined;
}

/** Fill of `p:spPr`, falling back to the shape style's `a:fillRef`. */
function shapeFill(spPr: XNode | undefined, style: XNode | undefined, ctx: WalkCtx): { hex?: string; alpha: number; unsupported?: true } {
  if (child(spPr, "a:noFill")) return { alpha: 0 };
  const solid = child(spPr, "a:solidFill");
  if (solid) {
    const c = resolveColor(solid, ctx.color);
    return c ? { hex: c.hex, alpha: c.alpha } : { alpha: 0 };
  }
  if (child(spPr, "a:gradFill") || child(spPr, "a:blipFill") || child(spPr, "a:pattFill") || child(spPr, "a:grpFill")) {
    return { alpha: 1, unsupported: true };
  }
  const ref = child(style, "a:fillRef");
  if (ref && num(ref.attrs.idx) > 0) {
    const c = resolveColor(ref, ctx.color);
    if (c) return { hex: c.hex, alpha: c.alpha };
  }
  return { alpha: 0 };
}

function shapeLine(spPr: XNode | undefined, style: XNode | undefined, ctx: WalkCtx): { color: string; width: number } | undefined {
  const ln = child(spPr, "a:ln");
  if (child(ln, "a:noFill")) return undefined;
  const width = num(ln?.attrs.w, 12700) * ctx.scale;
  const solid = child(ln, "a:solidFill");
  const c = solid ? resolveColor(solid, ctx.color) : undefined;
  if (c) return { color: c.hex, width: Math.round(width * 100) / 100 };
  const ref = child(style, "a:lnRef");
  if (!solid && ref && num(ref.attrs.idx) > 0) {
    const rc = resolveColor(ref, ctx.color);
    if (rc) return { color: rc.hex, width: Math.round(width * 100) / 100 };
  }
  return undefined;
}

function textDrafts(shape: XNode, p: Placed, ph: PhInfo | undefined, ctx: WalkCtx, style: XNode | undefined): Draft[] {
  const tx = child(shape, "p:txBody");
  if (!tx) return [];
  const text = bodyText(tx);
  if (!text.trim()) return [];
  const inh = ctx.chain.resolve(ph);
  const fontRef = child(style, "a:fontRef");
  const body = readTextBody(tx, {
    color: ctx.color,
    theme: ctx.theme,
    scale: ctx.scale,
    lists: inh.lists,
    bodyPrs: inh.bodyPrs,
    fontRefColor: fontRef ? resolveColor(fontRef, ctx.color)?.hex : undefined,
  });
  if (body.wordArt) return [fallback(p, ctx, "wordart", text)];
  const item: DraftItem = {
    kind: "text",
    ...base(p, ctx),
    ...(ph ? { placeholder: ph.type } : {}),
    anchor: body.anchor,
    insets: body.insets,
    vertical: body.vertical,
    ...(body.textRotation ? { textRotation: body.textRotation } : {}),
    autofit: body.autofit,
    paragraphs: body.paragraphs,
  };
  return [{ item, text, isTitle: !!ph && isTitleType(ph.type), placeholder: ph?.type }];
}

function walkSp(shape: XNode, ctx: WalkCtx, frame: Frame): Draft[] {
  const ph = placeholderOf(shape);
  if (ph && ctx.skipPlaceholders) return [];
  const spPr = child(shape, "p:spPr");
  const p = placedOf(shape, child(spPr, "a:xfrm"), ph, ctx, frame);
  if (!p) return [];
  const style = child(shape, "p:style");
  const geom = child(spPr, "a:prstGeom");
  const preset = geom?.attrs.prst;
  const fill = shapeFill(spPr, style, ctx);
  const line = shapeLine(spPr, style, ctx);
  const visible = fill.unsupported || (fill.hex && fill.alpha > 0) || !!line;
  const out: Draft[] = [];
  if (visible) {
    const custom = !!child(spPr, "a:custGeom");
    if (fill.unsupported) out.push(fallback(p, ctx, "fill"));
    else if (custom || (preset && !SUPPORTED_PRESETS.has(preset))) out.push(fallback(p, ctx, "shape"));
    else {
      out.push({
        item: {
          kind: "rect",
          ...base(p, ctx),
          preset: (preset ?? "rect") as "rect" | "line" | "ellipse" | "roundRect",
          ...(fill.hex && fill.alpha > 0 ? { fill: fill.hex } : {}),
          alpha: fill.hex ? fill.alpha : 0,
          ...(line ? { line } : {}),
        },
        text: "",
        isTitle: false,
      });
    }
  }
  return [...out, ...textDrafts(shape, p, ph, ctx, style)];
}

function walkCxn(shape: XNode, ctx: WalkCtx, frame: Frame): Draft[] {
  const spPr = child(shape, "p:spPr");
  const p = placedOf(shape, child(spPr, "a:xfrm"), undefined, ctx, frame);
  if (!p) return [];
  const line = shapeLine(spPr, child(shape, "p:style"), ctx);
  if (!line) return [];
  const preset = child(spPr, "a:prstGeom")?.attrs.prst;
  if (preset && preset !== "line" && preset !== "straightConnector1") return [fallback(p, ctx, "shape")];
  return [{ item: { kind: "rect", ...base(p, ctx), preset: "line", alpha: 0, line }, text: "", isTitle: false }];
}

function walkPic(shape: XNode, ctx: WalkCtx, frame: Frame): Draft[] {
  const ph = placeholderOf(shape);
  if (ph && ctx.skipPlaceholders) return [];
  const spPr = child(shape, "p:spPr");
  const p = placedOf(shape, child(spPr, "a:xfrm"), ph, ctx, frame);
  if (!p) return [];
  const nvPr = path(shape, "p:nvPicPr", "p:nvPr");
  if (child(nvPr, "a:videoFile") || child(nvPr, "a:audioFile") || descendant(nvPr, "p14:media")) return [fallback(p, ctx, "media")];
  const blipFill = child(shape, "p:blipFill");
  const blip = child(blipFill, "a:blip");
  const rels = ctx.pkg.rels(ctx.part);
  const rel = rels[blip?.attrs["r:embed"] ?? ""];
  if (!rel || rel.external || !ctx.pkg.has(rel.part)) return [fallback(p, ctx, "media")];
  const ext = extOf(rel.part);
  if (ext === "emf" || ext === "wmf") return [fallback(p, ctx, ext)];
  if (!RASTER.has(ext) && ext !== "svg") return [fallback(p, ctx, "media")];
  // Any blip child other than its extension list is a picture effect.
  if (blip?.children.some((c) => c.name !== "a:extLst")) return [fallback(p, ctx, "picture-effect")];
  const raster = ctx.media.addPart(rel.part, ctx.pkg.bytes(rel.part) as Uint8Array);
  const svgEmbed = descendant(blip, "asvg:svgBlip")?.attrs["r:embed"];
  const svgRel = svgEmbed ? rels[svgEmbed] : undefined;
  const svg = svgRel && !svgRel.external && ctx.pkg.has(svgRel.part) ? ctx.media.addPart(svgRel.part, ctx.pkg.bytes(svgRel.part) as Uint8Array) : undefined;
  const src = child(blipFill, "a:srcRect");
  const frac = (v: string | undefined) => Math.round((num(v) / 100000) * 10000) / 10000;
  return [
    {
      item: {
        kind: "img",
        ...base(p, ctx),
        media: raster.name,
        asset: raster.asset,
        crop: { l: frac(src?.attrs.l), t: frac(src?.attrs.t), r: frac(src?.attrs.r), b: frac(src?.attrs.b) },
        ...(svg ? { svg: svg.name, svgAsset: svg.asset } : {}),
      },
      text: "",
      isTitle: false,
    },
  ];
}

function walkGraphicFrame(shape: XNode, ctx: WalkCtx, frame: Frame): Draft[] {
  const ph = placeholderOf(shape);
  if (ph && ctx.skipPlaceholders) return [];
  const p = placedOf(shape, child(shape, "p:xfrm"), ph, ctx, frame);
  if (!p) return [];
  const uri = path(shape, "a:graphic", "a:graphicData")?.attrs.uri ?? "";
  const construct = GRAPHIC_URI.find(([suffix]) => uri.endsWith(suffix))?.[1] ?? "ole";
  return [fallback(p, ctx, construct)];
}

/** Walk the children of a shape tree or group in z-order. */
export function walkTree(tree: XNode | undefined, ctx: WalkCtx, frame: Frame): Draft[] {
  const out: Draft[] = [];
  for (const node of tree?.children ?? []) {
    // AlternateContent: the fallback branch is the one every reader understands.
    const n = node.name === "mc:AlternateContent" ? (child(node, "mc:Fallback") ?? child(node, "mc:Choice")) : node;
    if (!n) continue;
    const items = n === node ? [n] : n.children;
    for (const shape of items) {
      switch (shape.name) {
        case "p:sp":
          out.push(...walkSp(shape, ctx, frame));
          break;
        case "p:cxnSp":
          out.push(...walkCxn(shape, ctx, frame));
          break;
        case "p:pic":
          out.push(...walkPic(shape, ctx, frame));
          break;
        case "p:graphicFrame":
          out.push(...walkGraphicFrame(shape, ctx, frame));
          break;
        case "p:grpSp":
          out.push(...walkTree(shape, ctx, groupFrame(path(shape, "p:grpSpPr", "a:xfrm"), frame)));
          break;
        case "p:contentPart": {
          const p = readXfrm(child(shape, "p:xfrm"));
          if (p) out.push(fallback(frame(p), ctx, "shape"));
          break;
        }
        default:
          break;
      }
    }
  }
  return out;
}
