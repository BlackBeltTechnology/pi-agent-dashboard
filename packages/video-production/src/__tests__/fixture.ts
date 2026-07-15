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
