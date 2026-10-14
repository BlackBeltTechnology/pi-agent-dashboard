/** Shared helpers for the skill lint, drift and recipe-run tests. */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_IDS } from "../../registry.js";

export const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const SKILLS_DIR = path.join(PKG_DIR, ".pi", "skills");
export const FIXTURES_DIR = path.join(PKG_DIR, "src", "__tests__", "fixtures", "commands");

export const SKILL_NAMES = ["craft-studio", ...APP_IDS] as const;

export interface Skill {
  name: string;
  dir: string;
  text: string;
  frontmatter: Record<string, string>;
  body: string;
}

export function loadSkill(name: string): Skill {
  const dir = path.join(SKILLS_DIR, name);
  const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const frontmatter: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const kv = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (kv) frontmatter[kv[1]] = kv[2].trim();
  }
  return { name, dir, text, frontmatter, body: m?.[2] ?? text };
}

export interface Fence {
  /** Info string after the opening backticks, e.g. `bash recipe: trim`. */
  info: string;
  code: string;
  /** Recipe id when the info string carries `recipe:<id>` / `recipe: <id>`. */
  recipe?: string;
}

/** Fenced code blocks (``` or ~~~, any indentation). */
export function fences(text: string): Fence[] {
  const out: Fence[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*(`{3,}|~{3,})\s*(.*)$/.exec(lines[i]);
    if (!open) continue;
    const marker = open[1];
    const body: string[] = [];
    for (i++; i < lines.length && !new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(lines[i]); i++) body.push(lines[i]);
    const info = open[2].trim();
    const rec = /\brecipe:?\s*([\w-]+)/.exec(info);
    out.push({ info, code: body.join("\n"), recipe: rec?.[1] });
  }
  return out;
}

/** Meaningful command lines of a fence: non-empty, not a comment; shell continuations joined. */
export function commandLines(code: string): string[] {
  const out: string[] = [];
  let acc = "";
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.endsWith("\\")) {
      acc += `${line.slice(0, -1).trim()} `;
      continue;
    }
    out.push(acc + line);
    acc = "";
  }
  if (acc) out.push(acc.trim());
  return out;
}

export interface CommandFixture {
  app: string;
  version: string;
  commandIds: string[];
  mcpTools: string[];
}

export function loadFixture(app: string): CommandFixture {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, `${app}.json`), "utf8")) as CommandFixture;
}

const FILE_EXT = new Set([
  "txt", "json", "jsonl", "md", "png", "jpg", "jpeg", "tif", "tiff", "webp", "gif", "svg", "pdf", "psd", "mp4", "mov", "mkv", "avi", "wav", "aiff", "mp3", "flac", "ogg",
  "docx", "doc", "odt", "rtf", "html", "xlsx", "csv", "pptx", "dxf", "dwg", "scraft", "ecproj", "fcproj", "vcraft", "wcraft", "dcraft", "gcraft", "dkcraft", "fig", "ts", "js", "mjs", "sh",
  "jsx", "tex", "xml", "ron", "toml", "yaml", "yml", "log", "bin", "exe", "zip", "tar", "gz", "dng", "cr2", "nef", "arw", "heic", "avif", "jxl", "pam", "bmp", "ico", "eps", "ai",
]);

/**
 * Command-id-shaped tokens in a code fence: `namespace.name[.more]` whose first
 * segment is a command namespace of the app and which is not a file name. Used by
 * the drift check — a token whose namespace is real but whose id is not in the
 * fixture is a renamed or invented command (e.g. `timeline.setPlayhead`).
 */
export function quotedIds(code: string, namespaces: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/(?<![\w./-])([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+)(?![\w(/-])/g)) {
    const token = m[1];
    const segs = token.split(".");
    if (!namespaces.has(segs[0])) continue;
    if (FILE_EXT.has(segs[segs.length - 1].toLowerCase())) continue;
    out.add(token);
  }
  return [...out];
}
