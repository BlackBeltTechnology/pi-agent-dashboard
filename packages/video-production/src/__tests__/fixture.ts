import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const created: string[] = [];

/** Build a minimal Veo shot package on disk. Returns the project base dir. */
export function makePackage(shots: Record<string, string>): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "veo-"));
  created.push(base);
  fs.mkdirSync(path.join(base, "shots"), { recursive: true });
  fs.mkdirSync(path.join(base, "storyboard"), { recursive: true });
  // world anchor + per-shot sketches so image refs resolve
  fs.writeFileSync(path.join(base, "storyboard", "00_world_anchor.png"), "png");
  for (const name of Object.keys(shots)) {
    fs.writeFileSync(path.join(base, "storyboard", `${name}.png`), "png");
    fs.writeFileSync(path.join(base, "shots", `${name}.md`), shots[name]);
  }
  return base;
}

export function shotMd(opts: {
  title: string;
  prompt: string;
  negative?: string;
  seed?: number;
  resolution?: string;
  firstFrame?: string;
  reference?: string;
  seamlessTo?: string;
}): string {
  const lines = [
    `# ${opts.title}`,
    "",
    "## ▶ Full Veo prompt",
    "```",
    opts.prompt,
    "```",
    "",
  ];
  if (opts.negative) lines.push("## ⛔ Negative prompt", "```", opts.negative, "```", "");
  lines.push("## Reproduction & consistency");
  if (opts.seed !== undefined) lines.push(`- Seed: \`${opts.seed}\``);
  lines.push("- Aspect: `16:9`");
  lines.push(`- Resolution: ${opts.resolution ?? "1080p"}`);
  lines.push("- enhance_prompt: false");
  if (opts.reference) lines.push(`- Reference image: \`${opts.reference}\``);
  if (opts.firstFrame) lines.push(`- First-frame: \`${opts.firstFrame}\``);
  if (opts.seamlessTo) lines.push(`- Continuity: SEAMLESS to ${opts.seamlessTo}`);
  return `${lines.join("\n")}\n`;
}

export function cleanup(): void {
  for (const d of created) fs.rmSync(d, { recursive: true, force: true });
  created.length = 0;
}

// ── sidecar fixtures ──────────────────────────────────────────────────────

/** Minimal real image signatures (enough for magic-byte checks). */
export const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
export const WEBP_BYTES = Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

function writeJsonOrText(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

export function writeFilm(base: string, data: unknown): void {
  writeJsonOrText(path.join(base, "film.json"), data);
}

export function writeShotSidecar(base: string, name: string, data: unknown): void {
  writeJsonOrText(path.join(base, "shots", `${name}.json`), data);
}

export function writeTimeline(base: string, data: unknown): void {
  writeJsonOrText(path.join(base, "timeline.json"), data);
}

export function writeFile(file: string, data: string | Buffer = ""): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
}

export const validFilm = () => ({
  title: "Booth",
  style: "cinematic, film grain",
  consistency: "faces stay identical",
  negative: "no text",
  aspectRatio: "16:9",
  characters: [
    { id: "arm", description: "orange robot arm" },
    { id: "host", description: "woman in blue blazer" },
  ],
});

export const validShot = (durationSec = 8) => ({
  prompt: { visuals: "static wide shot", action: "arm picks a part" },
  durationSec,
});

export interface ProjectShot {
  /** Markdown override; default a valid shotMd with a first frame. `null` = no .md. */
  md?: string | null;
  /** Sidecar JSON; default validShot(); `null` = no .json. */
  sidecar?: unknown;
  seamlessTo?: string;
}

/**
 * Build `<tmp>/<name>/video_production/{film.json,shots,storyboard}` with real
 * PNG first frames. Returns `{ project, base }` (base = video_production dir).
 */
export function makeProject(opts: {
  name?: string;
  shots: Record<string, ProjectShot>;
  film?: unknown;
  timeline?: unknown;
}): { project: string; base: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "veo-proj-"));
  created.push(root);
  const project = path.join(root, opts.name ?? "booth-2026");
  const base = path.join(project, "video_production");
  fs.mkdirSync(path.join(base, "shots"), { recursive: true });
  fs.mkdirSync(path.join(base, "storyboard"), { recursive: true });
  for (const [name, s] of Object.entries(opts.shots)) {
    fs.writeFileSync(path.join(base, "storyboard", `${name}.png`), PNG_BYTES);
    if (s.md !== null) {
      const md =
        s.md ??
        shotMd({ title: name, prompt: `prompt for ${name}`, firstFrame: `storyboard/${name}.png`, seamlessTo: s.seamlessTo });
      fs.writeFileSync(path.join(base, "shots", `${name}.md`), md);
    }
    if (s.sidecar !== null) writeShotSidecar(base, name, s.sidecar ?? validShot());
  }
  if (opts.film !== undefined) writeFilm(base, opts.film);
  if (opts.timeline !== undefined) writeTimeline(base, opts.timeline);
  return { project, base };
}
