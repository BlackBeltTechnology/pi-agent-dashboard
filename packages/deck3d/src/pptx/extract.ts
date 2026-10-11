/**
 * pptx package → per-slide drafts (design D1). Ids are assigned afterwards by
 * `finalizeLayout`, so a `--force` re-import can reuse previous slide ids.
 */
import { backgroundOf, hidesMasterShapes, MasterChain } from "./master.js";
import { MediaRegistry, sha256Hex } from "./media.js";
import { Package, readPresentation } from "./package.js";
import { type Draft, walkTree } from "./shapes.js";
import { type ColorEnv, parseClrMap, parseTheme, resolveColor } from "./theme.js";
import type { FallbackItem, Layout, LayoutItem, LayoutSlide, ThemeInfo } from "./types.js";
import { IDENTITY } from "./xfrm.js";
import { child, kids, path, type XNode } from "./xml.js";

export const SLIDE_WIDTH = 1920;

export interface ExtractedSlide {
  title: string;
  fingerprint: string;
  background?: LayoutSlide["background"];
  drafts: Draft[];
  /** Plain text of the slide part's own items (baseline deck). */
  part: string;
}

export interface Extracted {
  size: { w: number; h: number };
  theme: ThemeInfo;
  slides: ExtractedSlide[];
  media: MediaRegistry;
}

const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

function readBackground(bg: XNode | undefined, env: ColorEnv, pkg: Package, part: string, media: MediaRegistry): LayoutSlide["background"] | undefined {
  if (!bg) return undefined;
  const pr = child(bg, "p:bgPr");
  if (pr) {
    const solid = child(pr, "a:solidFill");
    if (solid) {
      const c = resolveColor(solid, env);
      return c ? { color: c.hex } : undefined;
    }
    const grad = child(pr, "a:gradFill");
    if (grad) {
      const stop = kids(child(grad, "a:gsLst"), "a:gs")[0];
      const c = resolveColor(stop, env);
      return c ? { color: c.hex } : undefined;
    }
    const blip = path(pr, "a:blipFill", "a:blip");
    const rel = pkg.rels(part)[blip?.attrs["r:embed"] ?? ""];
    if (rel && !rel.external && pkg.has(rel.part)) {
      const file = media.addPart(rel.part, pkg.bytes(rel.part) as Uint8Array);
      return { media: file.name, asset: file.asset };
    }
    return undefined;
  }
  const ref = child(bg, "p:bgRef");
  const c = resolveColor(ref, env);
  return c ? { color: c.hex } : undefined;
}

export function extractPptx(files: Map<string, Uint8Array>): Extracted {
  const pkg = new Package(files);
  const pres = readPresentation(pkg);
  const scale = SLIDE_WIDTH / pres.width;
  const size = { w: SLIDE_WIDTH, h: Math.round((SLIDE_WIDTH * pres.height) / pres.width) };
  const media = new MediaRegistry();
  const firstTheme = pres.slides.find((s) => s.theme)?.theme;
  const deckTheme = parseTheme(firstTheme ? pkg.xml(firstTheme) : undefined);

  const slides: ExtractedSlide[] = pres.slides.map((chain) => {
    const theme = chain.theme ? parseTheme(pkg.xml(chain.theme)) : deckTheme;
    const masterXml = chain.master ? pkg.xml(chain.master) : undefined;
    const layoutXml = chain.layout ? pkg.xml(chain.layout) : undefined;
    const slideXml = pkg.xml(chain.slide);
    const env: ColorEnv = { theme, clrMap: parseClrMap(child(masterXml, "p:clrMap")) };
    const mc = new MasterChain(pkg, chain.layout, chain.master, pres.defaultTextStyle);
    const ctxBase = { pkg, scale, color: env, theme, chain: mc, media };

    const drafts: Draft[] = [];
    const hideAll = hidesMasterShapes(slideXml);
    if (!hideAll && !hidesMasterShapes(layoutXml) && chain.master) {
      drafts.push(...walkTree(mc.masterTree, { ...ctxBase, part: chain.master, origin: "master", skipPlaceholders: true }, IDENTITY));
    }
    if (!hideAll && chain.layout) {
      drafts.push(...walkTree(mc.layoutTree, { ...ctxBase, part: chain.layout, origin: "master", skipPlaceholders: true }, IDENTITY));
    }
    drafts.push(...walkTree(path(slideXml, "p:cSld", "p:spTree"), { ...ctxBase, part: chain.slide, skipPlaceholders: false }, IDENTITY));

    const bgSource: Array<[XNode | undefined, string | undefined]> = [
      [slideXml, chain.slide],
      [layoutXml, chain.layout],
      [masterXml, chain.master],
    ];
    let background: LayoutSlide["background"] | undefined;
    for (const [root, part] of bgSource) {
      const bg = backgroundOf(root);
      if (bg && part) {
        background = readBackground(bg, env, pkg, part, media);
        if (background) break;
      }
    }
    // A picture covering the whole slide at the bottom of the z-order IS the
    // background, whatever part it came from.
    const first = drafts[0]?.item;
    if (
      first?.kind === "img" &&
      first.rotation === 0 &&
      Math.abs(first.rect.x) <= 1 &&
      Math.abs(first.rect.y) <= 1 &&
      first.rect.w >= size.w - 2 &&
      first.rect.h >= size.h - 2
    ) {
      background = { ...(background?.color ? { color: background.color } : {}), media: first.media, asset: first.asset };
      drafts.shift();
    }

    const titleDraft = drafts.find((d) => d.isTitle && !d.item.origin);
    const title = normalise(titleDraft?.text ?? "");
    const others = drafts.filter((d) => d !== titleDraft && !d.item.origin && d.text.trim()).map((d) => normalise(d.text));
    const fingerprint = sha256Hex([title, ...others].join("\n"));
    return { title, fingerprint, ...(background ? { background } : {}), drafts, part: chain.slide };
  });

  return { size, theme: deckTheme, slides, media };
}

export interface FallbackRecord {
  slide: string;
  item: FallbackItem;
}

/** Assign `sNN` / `sNN-iMMM` ids and build `layout.json`. */
export function finalizeLayout(ex: Extracted, ids: string[]): { layout: Layout; fallbacks: FallbackRecord[] } {
  const fallbacks: FallbackRecord[] = [];
  const slides: LayoutSlide[] = ex.slides.map((s, i) => {
    const id = ids[i];
    const items: LayoutItem[] = s.drafts.map((d, k) => {
      const item = { id: `${id}-i${String(k + 1).padStart(3, "0")}`, ...d.item } as LayoutItem;
      if (item.kind === "fallback") fallbacks.push({ slide: id, item });
      return item;
    });
    return { id, index: i + 1, title: s.title, fingerprint: s.fingerprint, ...(s.background ? { background: s.background } : {}), items };
  });
  return { layout: { version: 1, size: ex.size, theme: ex.theme, slides }, fallbacks };
}

/** Recursively key-sorted JSON (byte-stable `layout.json`). */
export function stableStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sort((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}
