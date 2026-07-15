/**
 * Shot-package parsing.
 *
 * Port of the `shots/*.md` parser from the original veo-generator skill. Each
 * shot markdown file (produced by the veo-showreel-production-kit) carries the
 * Full Veo prompt, negative prompt, seed, aspect/resolution, reference images
 * and first-frame sketch. This module extracts them into structured `Shot`s.
 *
 * No SDK dependency here — safe to import for a dry-run.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export const MODEL_ALIASES: Record<string, string> = {
  standard: "veo-3.1-generate-preview",
  fast: "veo-3.1-fast-generate-preview",
  "veo3.1": "veo-3.1-generate-preview",
  "veo-3.1": "veo-3.1-generate-preview",
};

export type Resolution = "720p" | "1080p" | "4k";

export interface Shot {
  /** e.g. "shot_03A" */
  name: string;
  path: string;
  title: string;
  prompt: string;
  negative: string;
  seed: number | null;
  aspectRatio: string;
  resolution: Resolution;
  enhancePrompt: boolean;
  /** Resolved absolute paths of reference images. */
  referenceImages: string[];
  /** Resolved absolute path of the first-frame sketch, if any. */
  firstFrame: string | null;
  continuity: string;
  /** This shot flows SEAMLESS into the next. */
  seamlessNext: boolean;
}

/** Short id, e.g. "03A" for "shot_03A". */
export function shotShort(shot: Shot): string {
  return shot.name.replace(/^shot_/, "");
}

const IMG_RE = /`([^`]+?\.(?:png|jpg|jpeg|webp))`/gi;

/** Return the first fenced ``` block after a heading containing `headingSubstr`. */
function fencedBlockAfter(text: string, headingSubstr: string): string {
  const idx = text.toLowerCase().indexOf(headingSubstr.toLowerCase());
  if (idx === -1) return "";
  const rest = text.slice(idx);
  const m = rest.match(/```[^\n]*\n([\s\S]*?)```/);
  return m ? m[1].trim() : "";
}

function allBacktickPaths(line: string): string[] {
  return Array.from(line.matchAll(IMG_RE), (m) => m[1]);
}

function firstBacktickPath(line: string): string | null {
  const m = line.match(/`([^`]+?\.(?:png|jpg|jpeg|webp))`/i);
  return m ? m[1] : null;
}

/** Resolve an image path referenced in a shot file relative to the package root. */
export function resolveImage(rel: string, baseDir: string): string | null {
  const trimmed = rel.trim();
  const cand = path.resolve(baseDir, trimmed);
  if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  const sb = path.resolve(baseDir, "storyboard", path.basename(trimmed));
  if (fs.existsSync(sb) && fs.statSync(sb).isFile()) return sb;
  return null; // referenced but missing on disk
}

/** Parse one shot markdown file into a `Shot`. */
export function parseShotFile(filePath: string, baseDir: string): Shot {
  const text = fs.readFileSync(filePath, "utf8");
  const name = path.basename(filePath, path.extname(filePath));

  const shot: Shot = {
    name,
    path: filePath,
    title: "",
    prompt: "",
    negative: "",
    seed: null,
    aspectRatio: "16:9",
    resolution: "1080p",
    enhancePrompt: false,
    referenceImages: [],
    firstFrame: null,
    continuity: "",
    seamlessNext: false,
  };

  const mt = text.match(/^#\s+(.*)$/m);
  if (mt) shot.title = mt[1].trim();

  shot.prompt = fencedBlockAfter(text, "Full Veo prompt");
  shot.negative = fencedBlockAfter(text, "Negative prompt");

  const ms = text.match(/Seed[:*\s]*[`*]*\s*(\d{3,})/);
  if (ms) shot.seed = Number.parseInt(ms[1], 10);

  const ma = text.match(/Aspect[:*\s]*[`*]*\s*([0-9]+:[0-9]+)/);
  if (ma) shot.aspectRatio = ma[1];

  if (/\b4k\b/i.test(text)) shot.resolution = "4k";
  else if (/\b1080p\b/i.test(text)) shot.resolution = "1080p";
  else if (/\b720p\b/i.test(text)) shot.resolution = "720p";

  const me = text.match(/enhance_prompt[`*:\s]*\s*(true|false)/i);
  if (me) shot.enhancePrompt = me[1].toLowerCase() === "true";

  for (const line of text.split(/\r?\n/)) {
    const low = line.toLowerCase();
    if (low.includes("reference image")) {
      for (const p of allBacktickPaths(line)) {
        const resolved = resolveImage(p, baseDir);
        if (resolved && !shot.referenceImages.includes(resolved)) shot.referenceImages.push(resolved);
      }
    }
    if (low.includes("first-frame") || low.includes("first frame")) {
      const p = firstBacktickPath(line);
      if (p) shot.firstFrame = resolveImage(p, baseDir);
    }
    if (low.includes("continuity")) {
      shot.continuity = line.split(":").slice(1).join(":").replace(/^[\s*]+|[\s*]+$/g, "");
      // only flag an OUTGOING seamless transition ("SEAMLESS to 03B").
      if (/seamless\s*(to|→|->)/.test(low)) shot.seamlessNext = true;
    }
  }

  return shot;
}
