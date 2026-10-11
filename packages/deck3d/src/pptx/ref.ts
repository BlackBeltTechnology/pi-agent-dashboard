/**
 * Reference renders (design D6, spec "Reference renders"): `--ref <dir>` user
 * exports first (PowerPoint / Keynote naming accepted), else LibreOffice +
 * `pdftoppm` when both are on PATH, else one warning. Output is always
 * `pptx/ref/sNN.png`; renders are authoring inputs, never embedded.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { isPng } from "../art/png.js";

/** Slide number a `--ref` file name refers to, or undefined. */
export function refSlideNumber(fileName: string): number | undefined {
  const m = /^(.+)\.(png|jpe?g)$/i.exec(fileName);
  if (!m) return undefined;
  const base = m[1].toLowerCase();
  const hit = /^(?:.*[ _-])?(?:s(\d+)|slide[ _-]?(\d+)|(\d+))$/.exec(base);
  const n = hit ? Number(hit[1] ?? hit[2] ?? hit[3]) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function onPath(cmd: string, env: NodeJS.ProcessEnv = process.env): boolean {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, cmd))) return true;
  }
  return false;
}

export interface RefResult {
  /** Slide number (1-based) → PNG bytes. */
  images: Map<number, Uint8Array>;
  warnings: string[];
}

/** Convert non-PNG exports through `toPng` (the sandboxed decoder); undefined ⇒ skipped. */
export type ToPng = (bytes: Uint8Array) => Promise<Uint8Array | undefined>;

export async function refFromDir(dir: string, slideCount: number, toPng: ToPng): Promise<RefResult> {
  const images = new Map<number, Uint8Array>();
  const warnings: string[] = [];
  const unmatched: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!/\.(png|jpe?g)$/i.test(name)) continue;
    const n = refSlideNumber(name);
    if (n === undefined || n > slideCount || images.has(n)) {
      unmatched.push(name);
      continue;
    }
    const bytes = new Uint8Array(readFileSync(join(dir, name)));
    const png = isPng(bytes) ? bytes : await toPng(bytes);
    if (!png) {
      warnings.push(`warning --ref ${name}: cannot convert to PNG without chromium (npx playwright install chromium); skipped`);
      continue;
    }
    images.set(n, png);
  }
  const missing: number[] = [];
  for (let n = 1; n <= slideCount; n++) if (!images.has(n)) missing.push(n);
  if (unmatched.length || missing.length) {
    const parts: string[] = [];
    if (unmatched.length) parts.push(`unmatched files: ${unmatched.join(", ")}`);
    if (missing.length) parts.push(`slides without a reference: ${missing.join(", ")}`);
    warnings.push(`warning --ref ${dir}: ${parts.join("; ")}`);
  }
  return { images, warnings };
}

export const NO_RENDERER_WARNING =
  "warning no reference renders: pass --ref <dir> or install LibreOffice (soffice) + poppler (pdftoppm); compare and raster fallbacks are unavailable";

/** LibreOffice → PDF → pdftoppm PNGs at 1920 px wide. */
export function refFromLibreOffice(pptxPath: string, slideCount: number, env: NodeJS.ProcessEnv = process.env): RefResult {
  const images = new Map<number, Uint8Array>();
  if (!onPath("soffice", env) || !onPath("pdftoppm", env)) return { images, warnings: [NO_RENDERER_WARNING] };
  const work = mkdtempSync(join(tmpdir(), "deck3d-ref-"));
  try {
    const conv = spawnSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", work, pptxPath], { env, encoding: "utf8", timeout: 300_000 });
    if (conv.status !== 0) {
      return { images, warnings: [`warning soffice exited with status ${conv.status ?? "signal"}; continuing without reference renders`] };
    }
    const pdf = readdirSync(work).find((f) => f.toLowerCase().endsWith(".pdf"));
    if (!pdf) return { images, warnings: ["warning soffice produced no PDF; continuing without reference renders"] };
    const ppm = spawnSync("pdftoppm", ["-png", "-scale-to-x", "1920", "-scale-to-y", "-1", join(work, pdf), join(work, "p")], {
      env,
      encoding: "utf8",
      timeout: 300_000,
    });
    if (ppm.status !== 0) {
      return { images, warnings: [`warning pdftoppm exited with status ${ppm.status ?? "signal"}; continuing without reference renders`] };
    }
    for (const f of readdirSync(work)) {
      const m = /^p-0*(\d+)\.png$/.exec(f);
      if (m && Number(m[1]) <= slideCount) images.set(Number(m[1]), new Uint8Array(readFileSync(join(work, f))));
    }
    return { images, warnings: [] };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
