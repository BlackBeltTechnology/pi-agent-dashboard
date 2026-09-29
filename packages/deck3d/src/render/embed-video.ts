/**
 * Inline video clips referenced by effect params into the deck IR as `data:`
 * URLs, so a deck with a video layer can still be ONE portable file.
 *
 * Why this exists at all: a clip must be SAME-ORIGIN or the browser taints the
 * canvas and `texImage2D` refuses it. `deck3d serve` solves that with an asset
 * route; a deck mailed as a single `.html` has no server, and a `file://`
 * sibling is cross-origin. A `data:` URL is same-origin by definition.
 *
 * The cost is honest and large: base64 is ~33% bigger than the source bytes,
 * so this is opt-in (`--embed-video`) rather than the default.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import type { DeckIR, EffectRef } from "../ir/types.js";

const MEDIA_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
};

/** A clip already inlined, or fetched at runtime — nothing to embed. */
function isInlineOrRemote(src: string): boolean {
  return /^(data:|https?:|blob:)/i.test(src);
}

export interface EmbedVideoResult {
  ir: DeckIR;
  /** `<slide>/<effect>` → embedded byte count, for the CLI's report. */
  embedded: Record<string, number>;
  warnings: string[];
}

/**
 * Rewrite every effect `src` that names a local clip into a `data:` URL.
 *
 * Returns a COPY: the on-disk IR keeps its readable relative paths, and only
 * the rendered HTML carries the bytes.
 */
export function embedVideo(ir: DeckIR, jsonPath: string): EmbedVideoResult {
  const deckDir = dirname(resolve(jsonPath));
  const embedded: Record<string, number> = {};
  const warnings: string[] = [];
  const copy = JSON.parse(JSON.stringify(ir)) as DeckIR;

  /** Resolve one clip to a `data:` URL, or explain why it cannot be embedded. */
  const inline = (src: string): { url: string; size: number } | { error: string } => {
    // Never read outside the deck directory: the same confinement the serve
    // asset route enforces.
    const target = isAbsolute(src) ? resolve(src) : resolve(deckDir, src);
    if (!target.startsWith(`${deckDir}/`)) return { error: `refusing to embed '${src}' from outside the deck directory` };
    if (!existsSync(target)) return { error: `clip not found: ${src}` };
    const type = MEDIA_TYPES[extname(target).toLowerCase()];
    if (!type) return { error: `not an embeddable clip: ${src}` };
    const bytes = readFileSync(target);
    return { url: `data:${type};base64,${bytes.toString("base64")}`, size: statSync(target).size };
  };

  const visit = (refs: EffectRef[] | undefined, where: string): void => {
    for (const ref of refs ?? []) {
      const src = ref.params?.src;
      if (typeof src !== "string" || !src || isInlineOrRemote(src)) continue;
      const result = inline(src);
      if ("error" in result) {
        warnings.push(`${where}: ${result.error}`);
        continue;
      }
      ref.params = { ...ref.params, src: result.url };
      embedded[where] = result.size;
    }
  };

  visit(copy.overrides?.effects, "overrides.effects");
  for (const slide of copy.slides) visit(slide.effects, `slides.${slide.id}`);
  for (const [id, ov] of Object.entries(copy.overrides?.slides ?? {})) {
    visit((ov as { effects?: EffectRef[] }).effects, `overrides.slides.${id}`);
  }
  return { ir: copy, embedded, warnings };
}
