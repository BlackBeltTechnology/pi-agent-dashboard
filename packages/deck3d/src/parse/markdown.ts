/**
 * Markdown deck grammar (spec: deck3d-skill "Markdown slide grammar").
 *
 *   --- front matter ---      deck-level defaults
 *   # Title                   starts a slide (a doc with no `#` is ONE slide `slide`)
 *   first paragraph           subtitle
 *   - item                    bullet
 *   ```mermaid … ```          diagram source (harvested later)
 *   <!-- deck3d: {...} -->    per-slide inline override (wins over deck.json)
 */
import { assignSlideIds, parseHeading } from "../ir/ids.js";
import type { Defaults, SlideOverride } from "../ir/types.js";

export interface ParsedSlide {
  index: number;
  id: string;
  title: string;
  pin?: string;
  subtitle?: string;
  bullets: string[];
  mermaid?: string;
  inlineOverrides?: SlideOverride;
}

export interface ParsedDeck {
  defaults: Defaults;
  slides: ParsedSlide[];
}

export class MarkdownParseError extends Error {
  constructor(
    message: string,
    readonly slideId: string,
  ) {
    super(message);
    this.name = "MarkdownParseError";
  }
}

const OVERRIDE_RE = /^<!--\s*deck3d:\s*([\s\S]*?)\s*-->\s*$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;

interface RawSlide {
  heading: string;
  body: string[];
}

function splitFrontMatter(source: string): { frontMatter: string | undefined; body: string } {
  if (!source.startsWith("---")) return { frontMatter: undefined, body: source };
  const end = source.indexOf("\n---", 3);
  if (end === -1) return { frontMatter: undefined, body: source };
  const lineEnd = source.indexOf("\n", end + 1);
  const frontMatter = source.slice(source.indexOf("\n", 3) + 1, end);
  const body = lineEnd === -1 ? "" : source.slice(lineEnd + 1);
  return { frontMatter, body };
}

function parseScalar(raw: string): unknown {
  const t = raw.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null" || t === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function parseFrontMatter(frontMatter: string | undefined): Defaults {
  const defaults: Record<string, unknown> = {};
  if (!frontMatter) return defaults;
  for (const line of frontMatter.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    defaults[trimmed.slice(0, idx).trim()] = parseScalar(trimmed.slice(idx + 1));
  }
  return defaults as Defaults;
}

function splitSlides(body: string): RawSlide[] {
  const lines = body.split(/\r?\n/);
  const slides: RawSlide[] = [];
  let current: RawSlide | undefined;
  let pending: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) inFence = !inFence;
    if (!inFence && /^#\s+/.test(line)) {
      if (!current && pending.some((l) => l.trim())) slides.push({ heading: "", body: pending });
      pending = [];
      current = { heading: line.replace(/^#\s+/, ""), body: [] };
      slides.push(current);
      continue;
    }
    if (!current) {
      // Content before the first heading (or a zero-heading doc).
      pending.push(line);
      continue;
    }
    current.body.push(line);
  }
  if (slides.length === 0) slides.push({ heading: "", body: pending });
  return slides;
}

function extractMermaid(body: string[]): string | undefined {
  const blocks: string[] = [];
  let inMermaid = false;
  let buf: string[] = [];
  for (const line of body) {
    const fence = /^```(\w*)\s*$/.exec(line.trim());
    if (fence && fence[1] === "mermaid") {
      inMermaid = true;
      buf = [];
      continue;
    }
    if (inMermaid && line.trim().startsWith("```")) {
      inMermaid = false;
      blocks.push(buf.join("\n"));
      continue;
    }
    if (inMermaid) buf.push(line);
  }
  // A slide has at most one diagram (the first mermaid block).
  return blocks[0];
}

export function parseMarkdown(source: string): ParsedDeck {
  const { frontMatter, body } = splitFrontMatter(source);
  const defaults = parseFrontMatter(frontMatter);
  const raws = splitSlides(body);
  const ids = assignSlideIds(raws.map((r) => parseHeading(r.heading)));

  const slides: ParsedSlide[] = raws.map((raw, i) => {
    const heading = parseHeading(raw.heading);
    const id = ids[i];
    const content = stripNonContent(raw.body);
    const subtitle = extractSubtitle(content);
    const bullets = extractBullets(content);
    const inlineOverrides = extractInlineOverride(content, id);
    const mermaid = extractMermaid(raw.body);
    const slide: ParsedSlide = { index: i + 1, id, title: heading.title, bullets };
    if (heading.pin) slide.pin = heading.pin;
    if (subtitle) slide.subtitle = subtitle;
    if (mermaid) slide.mermaid = mermaid;
    if (inlineOverrides) slide.inlineOverrides = inlineOverrides;
    return slide;
  });

  return { defaults, slides };
}

/** Lines that contribute to subtitle/bullets (drops fences and comments). */
function stripNonContent(body: string[]): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of body) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.trim().startsWith("<!--") && !OVERRIDE_RE.test(line.trim())) continue;
    out.push(line);
  }
  return out;
}

function extractSubtitle(content: string[]): string | undefined {
  const para: string[] = [];
  for (const line of content) {
    const t = line.trim();
    if (!t) {
      if (para.length) break;
      continue;
    }
    if (BULLET_RE.test(line)) break;
    if (/^#/.test(t)) continue;
    para.push(t);
  }
  return para.length ? para.join(" ") : undefined;
}

function extractBullets(content: string[]): string[] {
  const bullets: string[] = [];
  for (const line of content) {
    const m = BULLET_RE.exec(line);
    if (m) bullets.push(m[1].trim());
  }
  return bullets;
}

function extractInlineOverride(content: string[], slideId: string): SlideOverride | undefined {
  for (const line of content) {
    const m = OVERRIDE_RE.exec(line.trim());
    if (!m) continue;
    try {
      return JSON.parse(m[1]) as SlideOverride;
    } catch (err) {
      throw new MarkdownParseError(
        `slide "${slideId}": invalid inline JSON in <!-- deck3d -->: ${(err as Error).message}`,
        slideId,
      );
    }
  }
  return undefined;
}
