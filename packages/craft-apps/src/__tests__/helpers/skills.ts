/** Shared helpers for the skill lint, drift and recipe-run tests. */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_IDS } from "../../registry.js";

export const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const SKILLS_DIR = path.join(PKG_DIR, ".pi", "skills");
export const FIXTURES_DIR = path.join(PKG_DIR, "src", "__tests__", "fixtures", "commands");

export const SKILL_NAMES = ["craft-studio", ...APP_IDS] as const;

/** Workflow skills (Layer 2 over the router + app skills). Linted as workflows, never as app skills. */
export const WORKFLOW_SKILL_NAMES = ["craft-video-post", "craft-beat-cut", "craft-podcast-master", "craft-motion-titles"] as const;
export type WorkflowName = (typeof WORKFLOW_SKILL_NAMES)[number];

/** Apps each workflow drives: its command ids are checked against the union of these apps' command lists. */
export const WORKFLOW_APPS: Record<WorkflowName, readonly string[]> = {
  "craft-video-post": ["filmcraft", "soundcraft", "effectcraft"],
  "craft-beat-cut": ["filmcraft", "soundcraft", "effectcraft"],
  "craft-podcast-master": ["soundcraft", "filmcraft"],
  "craft-motion-titles": ["effectcraft", "filmcraft"],
};

/** Sibling skills / CLIs / packages each workflow's step 0 must name (soft references). */
export const WORKFLOW_SIBLINGS: Record<WorkflowName, { skills: string[]; packages: string[]; clis: string[] }> = {
  "craft-video-post": {
    skills: ["veo-generator", "footage-redaction", "video-transcription", "hyperframes-showreel"],
    packages: ["video-production", "video-transcription"],
    clis: ["pi-transcribe"],
  },
  "craft-beat-cut": { skills: ["music-analysis", "music-edit-to-length", "beat-sync-video"], packages: ["music-production"], clis: [] },
  "craft-podcast-master": { skills: ["video-transcription", "speaker-id"], packages: ["video-transcription"], clis: ["pi-transcribe", "pi-voiceid"] },
  "craft-motion-titles": { skills: ["video-transcription", "speaker-id"], packages: ["video-transcription"], clis: [] },
};

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
  "jsx", "tex", "srt", "vtt", "tsv", "xml", "ron", "toml", "yaml", "yml", "log", "bin", "exe", "zip", "tar", "gz", "dng", "cr2", "nef", "arw", "heic", "avif", "jxl", "pam", "bmp", "ico", "eps", "ai",
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

/** `### Step N — title` sections of a workflow skill body. */
export interface StepSection {
  n: number;
  title: string;
  text: string;
  fences: Fence[];
}

export function stepSections(body: string): StepSection[] {
  const out: StepSection[] = [];
  const re = /^### Step (\d+)\s+[—-]\s+(.*)$/gm;
  const heads = [...body.matchAll(re)];
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].index ?? 0;
    const rest = body.slice(start + heads[i][0].length);
    const next = /^#{2,3} /m.exec(rest);
    const text = rest.slice(0, next ? next.index : rest.length);
    out.push({ n: Number(heads[i][1]), title: heads[i][2], text, fences: fences(text) });
  }
  return out;
}

/** The body of a `check: <name>` fence (the skill-level checks of text artefacts). */
export function checkSnippet(skill: Skill, name: string): string {
  const f = fences(skill.body).find((x) => new RegExp(`\\bcheck:\\s*${name}\\b`).test(x.info));
  if (!f) throw new Error(`${skill.name} has no \`check: ${name}\` fence`);
  return f.code;
}

/** Union of the recorded command lists of `apps`: known ids + namespaces. */
export function fixtureUnion(apps: readonly string[]): { known: Set<string>; namespaces: Set<string>; versions: string } {
  const known = new Set<string>();
  const versions: string[] = [];
  for (const app of apps) {
    const fx = loadFixture(app);
    versions.push(`${app} ${fx.version}`);
    for (const id of fx.commandIds) known.add(id);
  }
  return { known, namespaces: new Set([...known].map((i) => i.split(".")[0])), versions: versions.join(", ") };
}

/**
 * Command ids a workflow quotes in `pi-craft <app> exec …` lines and in jsonl `{"id":"ns.name"}` rows, that are
 * unknown to the union of the driven apps. Sibling CLI lines (`pi-transcribe`, `npx hyperframes`, `ffmpeg`, `jq`…) are
 * not inspected. Returns the offending ids.
 */
export function unknownWorkflowIds(body: string, apps: readonly string[]): string[] {
  const { known, namespaces } = fixtureUnion(apps);
  return unknownIdsAgainst(body, known, namespaces);
}

/** Same check against any command-id set (the nightly drift test passes the live lists). */
export function unknownIdsAgainst(body: string, known: ReadonlySet<string>, namespaces: ReadonlySet<string>): string[] {
  const bad = new Set<string>();
  for (const f of fences(body)) {
    for (const m of f.code.matchAll(/"id"\s*:\s*"([A-Za-z]\w*(?:\.\w+)+)"/g)) if (!known.has(m[1])) bad.add(m[1]);
    for (const line of commandLines(f.code)) {
      if (!/^(?:\w+=\S+\s+)*pi-craft\s+\w+\s+exec\b/.test(line)) continue;
      for (const id of quotedIds(line, namespaces)) if (!known.has(id)) bad.add(id);
    }
  }
  return [...bad];
}
