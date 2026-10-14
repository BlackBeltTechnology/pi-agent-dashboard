/**
 * `pi-photocraft replace-region` — generative part-replacement with pixel-exact
 * locality: PhotoCraft crops a padded region, `pi-nano-banana` regenerates only
 * that crop, PhotoCraft places it back through a feathered mask. Pixels outside
 * the crop box are never touched.
 *
 * Pure helpers (`parseReplaceArgs`, `computeCrop`, `computeMask`, bounds
 * normalisation, `buildCompositeArgs`, `resolveNanoBananaLauncher`) are separate
 * from the orchestration (`replaceRegion`), whose effects are injected.
 *
 * See change: add-photocraft-plugin (design D7).
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { provision as defaultProvision, type ExecFn, type ProvisionReport } from "./provision.js";

export const REPLACE_USAGE = `usage: pi-photocraft replace-region <input> --prompt <text> --out <file> (--rect x,y,w,h | --select subject|sky|object:x,y,w,h)
         [--mask crop|selection] [--pad 32] [--feather 8] [--min-crop 256]
         [--layered <file.psd>] [--keep-temp] [--model <id>] [--flash] [--backend gemini|pi]

Regenerates the selected region (plus padding) with pi-nano-banana and composites
it back; pixels outside the padded crop stay identical. --pad must be at least
3 x --feather.`;

// ── Geometry ────────────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Size {
  w: number;
  h: number;
}

/** `[x,y,w,h]` (`select.*`) → rect. */
export function fromXywh(b: readonly number[]): Rect {
  return { x: b[0], y: b[1], w: b[2], h: b[3] };
}
/** `[x0,y0,x1,y1]` (`file.placeEmbedded`) → rect. */
export function fromCorners(b: readonly number[]): Rect {
  return { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] };
}
export function toCorners(r: Rect): [number, number, number, number] {
  return [r.x, r.y, r.x + r.w, r.y + r.h];
}

/** Intersection with the image, or null when empty. */
export function clipRect(r: Rect, image: Size): Rect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(image.w, r.x + r.w);
  const y1 = Math.min(image.h, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Region + pad on every side → grown symmetrically to `minCrop` → clipped to the image (clipped growth moves to the open side). */
export function computeCrop(region: Rect, image: Size, pad: number, minCrop: number): Rect {
  let x = region.x - pad;
  let y = region.y - pad;
  let w = region.w + 2 * pad;
  let h = region.h + 2 * pad;
  if (w < minCrop) {
    x -= Math.floor((minCrop - w) / 2);
    w = minCrop;
  }
  if (h < minCrop) {
    y -= Math.floor((minCrop - h) / 2);
    h = minCrop;
  }
  const clipped = clipRect({ x, y, w, h }, image) as Rect;
  // Growth lost to clipping at an image edge is made up on the open side, so the
  // generator still gets min(minCrop, image) of context (whole image when smaller).
  const reach = (start: number, len: number, target: number, limit: number): [number, number] => {
    const size = Math.min(target, limit);
    if (len >= size) return [start, len];
    return [Math.max(0, Math.min(start, limit - size)), size];
  };
  const [cx, cw] = reach(clipped.x, clipped.w, minCrop, image.w);
  const [cy, ch] = reach(clipped.y, clipped.h, minCrop, image.h);
  return { x: cx, y: cy, w: cw, h: ch };
}

/** Crop inset by `pad − feather` on every side not clipped by the image edge (0 on clipped sides). */
export function computeMask(crop: Rect, image: Size, pad: number, feather: number): Rect {
  const inset = Math.max(0, pad - feather);
  const left = crop.x === 0 ? 0 : inset;
  const top = crop.y === 0 ? 0 : inset;
  const right = crop.x + crop.w === image.w ? 0 : inset;
  const bottom = crop.y + crop.h === image.h ? 0 : inset;
  return { x: crop.x + left, y: crop.y + top, w: crop.w - left - right, h: crop.h - top - bottom };
}

// ── Arguments ───────────────────────────────────────────────────────────────

export type Selector =
  | { kind: "rect"; rect: Rect }
  | { kind: "subject" }
  | { kind: "sky" }
  | { kind: "object"; hint: Rect };

export interface ReplaceOptions {
  input: string;
  prompt: string;
  out: string;
  selector: Selector;
  mask: "crop" | "selection";
  pad: number;
  feather: number;
  minCrop: number;
  layered?: string;
  keepTemp: boolean;
  model?: string;
  flash: boolean;
  backend?: "gemini" | "pi";
}

export type ParseResult = { ok: true; options: ReplaceOptions } | { ok: false; error: string; help?: boolean };

const INT = /^-?\d+$/;
const NONNEG_INT = /^\d+$/;

function parseRect(text: string, what: string): Rect | string {
  const parts = text.split(",");
  if (parts.length !== 4 || !parts.every((p) => INT.test(p.trim()))) {
    return `${what} must be four integers x,y,w,h (got "${text}")`;
  }
  const [x, y, w, h] = parts.map((p) => Number.parseInt(p, 10));
  if (w <= 0 || h <= 0) return `${what} width and height must be positive (got "${text}")`;
  return { x, y, w, h };
}

/** Resolve a path for same-file comparison, following symlinks even when the target does not exist yet. */
function realish(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
    } catch {
      return path.resolve(p);
    }
  }
}

/** Same existing file (device + inode: hard links, case-insensitive spellings), else same resolved path. */
function sameFile(a: string, b: string): boolean {
  try {
    // bigint: dev/ino can exceed 2^53 on some filesystems
    const sa = fs.statSync(a, { bigint: true });
    const sb = fs.statSync(b, { bigint: true });
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return realish(a) === realish(b);
  }
}

interface RawArgs {
  input?: string;
  prompt?: string;
  out?: string;
  layered?: string;
  selectors: Selector[];
  mask: string;
  pad?: string;
  feather?: string;
  minCrop?: string;
  keepTemp: boolean;
  model?: string;
  flash: boolean;
  backend?: string;
}

/** A value flag stores its value; a returned string is a usage error. */
type ValueFlag = (raw: RawArgs, value: string) => string | undefined;

const VALUE_FLAGS: Record<string, ValueFlag> = {
  "--prompt": (r, v) => void (r.prompt = v),
  "--out": (r, v) => void (r.out = v),
  "--layered": (r, v) => void (r.layered = v),
  "--model": (r, v) => void (r.model = v),
  "--mask": (r, v) => void (r.mask = v),
  "--pad": (r, v) => void (r.pad = v),
  "--feather": (r, v) => void (r.feather = v),
  "--min-crop": (r, v) => void (r.minCrop = v),
  "--backend": (r, v) => void (r.backend = v),
  "--rect": (r, v) => {
    const rect = parseRect(v, "--rect");
    if (typeof rect === "string") return rect;
    r.selectors.push({ kind: "rect", rect });
  },
  "--select": (r, v) => {
    if (v === "subject" || v === "sky") return void r.selectors.push({ kind: v });
    if (!v.startsWith("object:")) return `--select must be subject, sky or object:x,y,w,h (got "${v}")`;
    const hint = parseRect(v.slice("object:".length), "--select object:");
    if (typeof hint === "string") return hint;
    r.selectors.push({ kind: "object", hint });
  },
};

const BOOL_FLAGS: Record<string, (raw: RawArgs) => void> = {
  "--keep-temp": (r) => void (r.keepTemp = true),
  "--flash": (r) => void (r.flash = true),
};

/** Split argv into raw values; returns an error/help result instead when the shape is wrong. */
function scanArgs(argv: string[]): RawArgs | ParseResult {
  const raw: RawArgs = { selectors: [], mask: "crop", keepTemp: false, flash: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { ok: false, error: "", help: true };
    if (BOOL_FLAGS[a]) {
      BOOL_FLAGS[a](raw);
    } else if (VALUE_FLAGS[a]) {
      const value = argv[++i];
      if (value === undefined) return { ok: false, error: `${a} needs a value` };
      const error = VALUE_FLAGS[a](raw, value);
      if (error) return { ok: false, error };
    } else if (a.startsWith("-")) {
      return { ok: false, error: `unknown option: ${a}` };
    } else if (raw.input !== undefined) {
      return { ok: false, error: `unexpected extra argument: ${a}` };
    } else {
      raw.input = a;
    }
  }
  return raw;
}

const nonNegative = (name: string, text: string | undefined, fallback: number): number | string => {
  if (text === undefined) return fallback;
  return NONNEG_INT.test(text) ? Number.parseInt(text, 10) : `${name} must be a non-negative integer (got "${text}")`;
};

/** Cross-field rules: required pieces, numeric ranges, pad ≥ 3 × feather, output ≠ input. */
function validateArgs(raw: RawArgs): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error });
  const { input, prompt, out, layered } = raw;
  if (input === undefined) return fail("missing <input>");
  if (!prompt) return fail("missing --prompt");
  if (out === undefined) return fail("missing --out");
  if (raw.selectors.length === 0) return fail("missing region selector: give --rect or --select");
  if (raw.selectors.length > 1) return fail("give exactly one region selector (--rect or --select)");
  if (raw.mask !== "crop" && raw.mask !== "selection") return fail(`--mask must be crop or selection (got "${raw.mask}")`);
  if (raw.backend !== undefined && raw.backend !== "gemini" && raw.backend !== "pi") {
    return fail(`--backend must be gemini or pi (got "${raw.backend}")`);
  }

  const pad = nonNegative("--pad", raw.pad, 32);
  const feather = nonNegative("--feather", raw.feather, 8);
  const minCrop = nonNegative("--min-crop", raw.minCrop, 256);
  for (const v of [pad, feather, minCrop]) if (typeof v === "string") return fail(v);
  if ((minCrop as number) < 1) return fail("--min-crop must be at least 1");
  if ((pad as number) < 3 * (feather as number)) {
    return fail(`--pad must be at least 3 × --feather (${3 * (feather as number)}) so the feather is not cut off by the crop edge`);
  }
  if (!path.extname(out)) return fail("--out needs a file extension (it selects the output format)");

  if (sameFile(out, input)) return fail("--out resolves to the input file; refusing to overwrite the input");
  if (layered !== undefined) {
    if (sameFile(layered, input)) return fail("--layered resolves to the input file; refusing to overwrite the input");
    if (sameFile(layered, out)) return fail("--layered and --out resolve to the same file");
  }

  return {
    ok: true,
    options: {
      input,
      prompt,
      out,
      selector: raw.selectors[0],
      mask: raw.mask as "crop" | "selection",
      pad: pad as number,
      feather: feather as number,
      minCrop: minCrop as number,
      layered,
      keepTemp: raw.keepTemp,
      model: raw.model,
      flash: raw.flash,
      backend: raw.backend as "gemini" | "pi" | undefined,
    },
  };
}

export function parseReplaceArgs(argv: string[]): ParseResult {
  const scanned = scanArgs(argv);
  return "selectors" in scanned ? validateArgs(scanned) : scanned;
}

// ── PhotoCraft command lists ────────────────────────────────────────────────

const cmd = (id: string, params?: unknown): string[] => (params === undefined ? ["--cmd", id] : ["--cmd", id, "--params", JSON.stringify(params)]);

/** Selection commands for a semantic selector (`rect` has none). */
function selectCommands(sel: Selector): string[] {
  switch (sel.kind) {
    case "subject":
      return cmd("select.subject");
    case "sky":
      return cmd("select.sky");
    case "object":
      return cmd("select.object", { rect: [sel.hint.x, sel.hint.y, sel.hint.w, sel.hint.h] });
    default:
      return [];
  }
}

export interface CompositeInput {
  input: string;
  patch: string;
  out: string;
  crop: Rect;
  region: Rect;
  image: Size;
  options: Pick<ReplaceOptions, "selector" | "mask" | "pad" | "feather">;
}

/** The single composite `run` argv (everything after the binary). */
export function buildCompositeArgs(c: CompositeInput): string[] {
  const { options, crop, region } = c;
  const semantic = options.selector.kind !== "rect";
  const args: string[] = ["run", c.input];
  const useSelection = options.mask === "selection" && semantic;
  if (useSelection) args.push(...selectCommands(options.selector), ...cmd("select.saveSelection", { name: "pc_region" }), ...cmd("select.deselect"));
  args.push(...cmd("file.placeEmbedded", { path: c.patch, fit: false, scale: 100, center: [crop.x + crop.w / 2, crop.y + crop.h / 2] }));
  if (options.mask === "crop") {
    const m = computeMask(crop, c.image, options.pad, options.feather);
    args.push(...cmd("select.rect", { x: m.x, y: m.y, width: m.w, height: m.h, feather: options.feather }));
  } else if (!semantic) {
    args.push(...cmd("select.rect", { x: region.x, y: region.y, width: region.w, height: region.h, feather: options.feather }));
  } else {
    args.push(...cmd("select.loadSelection", { channel: "pc_region" }));
    if (options.feather > 0) args.push(...cmd("select.modify.feather", { radius: options.feather }));
  }
  args.push(...cmd("layer.layerMask.revealSelection"), "--out", c.out);
  return args;
}

// ── Generator (pi-nano-banana subprocess) ───────────────────────────────────

/**
 * `<nano-banana package dir>/<bin.pi-nano-banana>`, resolved relative to
 * `fromUrl` — valid from `src/` in a checkout and from the bundled `dist/` in an install.
 */
export function resolveNanoBananaLauncher(fromUrl: string): string {
  const pkgName = "@blackbelt-technology/pi-dashboard-nano-banana";
  let pkgJsonPath: string;
  try {
    pkgJsonPath = createRequire(fromUrl).resolve(`${pkgName}/package.json`);
  } catch {
    throw new Error(`cannot locate ${pkgName}; install it next to @blackbelt-technology/pi-dashboard-craft-apps`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as { bin?: Record<string, string> };
  const rel = pkg.bin?.["pi-nano-banana"];
  if (!rel) throw new Error(`${pkgName} declares no pi-nano-banana bin`);
  return path.join(path.dirname(pkgJsonPath), rel);
}

export interface GenerateRequest {
  prompt: string;
  file: string;
  output: string;
  model?: string;
  flash: boolean;
  backend?: "gemini" | "pi";
}
export interface GenerateResult {
  ok: boolean;
  error?: string;
  /** Model reported by the generator, if any. */
  model?: string | null;
}

export function makeGenerator(execFile: ExecFn, launcher: () => string): (req: GenerateRequest) => Promise<GenerateResult> {
  return async (req) => {
    const argv = [launcher(), req.prompt, "--file", req.file, "--output", req.output];
    if (req.model) argv.push("--model", req.model);
    if (req.flash) argv.push("--flash");
    if (req.backend) argv.push("--backend", req.backend);
    try {
      const { stdout } = await execFile(process.execPath, argv, { timeout: 5 * 60_000 });
      if (!fs.existsSync(req.output)) return { ok: false, error: "generator exited 0 but wrote no image" };
      const model = /\(pi · ([^)]+)\)/.exec(stdout.toString())?.[1] ?? null;
      return { ok: true, model };
    } catch (e) {
      const err = e as { stderr?: string | Buffer; message?: string };
      const text = (err.stderr?.toString().trim() || err.message || "generator failed").trim();
      return { ok: false, error: text };
    }
  };
}

// ── Orchestration ───────────────────────────────────────────────────────────

export class StepError extends Error {
  readonly step: string;
  constructor(step: string, message: string) {
    super(`${step} step failed: ${message}`);
    this.step = step;
  }
}

export type RunFn = (bin: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface ReplaceDeps {
  provision: () => Promise<ProvisionReport>;
  run: RunFn;
  generate: (req: GenerateRequest) => Promise<GenerateResult>;
  tmpdir: () => string;
  now: () => number;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
}

export function defaultReplaceDeps(): ReplaceDeps {
  const exec: ExecFn = (file, args, opts) => execFileAsync(file, args, { maxBuffer: 64 * 1024 * 1024, ...opts });
  return {
    provision: () => defaultProvision("photocraft"),
    run: async (bin, args) => {
      const r = await exec(bin, args);
      return { stdout: r.stdout.toString(), stderr: r.stderr.toString() };
    },
    generate: makeGenerator(exec, () => resolveNanoBananaLauncher(import.meta.url)),
    tmpdir: () => os.tmpdir(),
    now: () => Date.now(),
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    env: process.env,
  };
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("warning:")) ?? text.trim()
  );
}

/** Parse the JSON lines `run` prints; returns the `result` of the first command whose id starts with `prefix`. */
function commandResult(stdout: string, prefix: string): Record<string, unknown> | undefined {
  for (const line of stdout.split("\n")) {
    try {
      const rec = JSON.parse(line) as { command?: string; result?: Record<string, unknown> | null };
      if (rec.command?.startsWith(prefix)) return rec.result ?? {};
    } catch {
      /* not a result line */
    }
  }
  return undefined;
}

/**
 * Copy each source next to its destination, then move all of them into place. A
 * failure at any point restores pre-existing destinations and removes outputs this
 * call created, so a late error never leaves a partial result. `staged` collects the
 * temporary files for the caller's cleanup.
 */
export function commitOutputs(targets: [string, string][], staged: string[], tag: string, rename: typeof fs.renameSync = fs.renameSync): void {
  for (const [, dest] of targets) {
    if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) throw new Error(`${dest} is a directory`);
  }
  const stages = targets.map(([src, dest]) => {
    const stage = path.join(path.dirname(dest), `.${path.basename(dest)}.pcr-${tag}.tmp`);
    fs.copyFileSync(src, stage);
    staged.push(stage);
    return stage;
  });
  const committed: { dest: string; backup?: string }[] = [];
  try {
    targets.forEach(([, dest], i) => {
      const backup = fs.existsSync(dest) ? path.join(path.dirname(dest), `.${path.basename(dest)}.pcr-bak-${tag}.tmp`) : undefined;
      if (backup) {
        rename(dest, backup);
      }
      committed.push({ dest, backup });
      rename(stages[i], dest);
    });
  } catch (e) {
    for (const { dest, backup } of committed.reverse()) {
      fs.rmSync(dest, { force: true });
      if (backup) rename(backup, dest);
    }
    throw e;
  }
  for (const { backup } of committed) if (backup) fs.rmSync(backup, { force: true });
  staged.length = 0;
}

/** Returns the process exit code; failures are reported on stderr. */
export async function replaceRegion(options: ReplaceOptions, partial: Partial<ReplaceDeps> = {}): Promise<number> {
  const deps: ReplaceDeps = { ...defaultReplaceDeps(), ...partial };

  let bin: string;
  try {
    bin = (await deps.provision()).binary;
  } catch (e) {
    deps.stderr(`pi-photocraft: ${(e as Error).message}\n`);
    return 69;
  }

  const timings: Record<string, number> = {};
  const timed = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = deps.now();
    try {
      return await fn();
    } catch (e) {
      if (e instanceof StepError) throw e;
      const err = e as { stderr?: string | Buffer; message?: string };
      throw new StepError(step, firstLine(err.stderr?.toString() || err.message || String(e)));
    } finally {
      timings[step] = deps.now() - t0;
    }
  };
  const photocraft = (step: string, args: string[]) => timed(step, () => deps.run(bin, args));

  const input = path.resolve(options.input);
  const outPath = path.resolve(options.out);
  const layeredPath = options.layered ? path.resolve(options.layered) : undefined;
  const tmp = fs.mkdtempSync(path.join(deps.tmpdir(), "pi-photocraft-"));
  const staged: string[] = [];
  try {
    // info
    const info = await photocraft("info", ["info", input, "--compact"]);
    let image: Size;
    try {
      const doc = JSON.parse(info.stdout) as { width: number; height: number };
      image = { w: doc.width, h: doc.height };
      if (!(image.w > 0 && image.h > 0)) throw new Error("no size");
    } catch {
      throw new StepError("info", "could not read the image size");
    }

    // region
    let region: Rect;
    const sel = options.selector;
    if (sel.kind === "rect") {
      const clipped = clipRect(sel.rect, image);
      if (!clipped) {
        deps.stderr(`pi-photocraft: rect ${sel.rect.x},${sel.rect.y},${sel.rect.w},${sel.rect.h} lies outside the ${image.w}×${image.h} image\n`);
        return 1;
      }
      region = clipped;
    } else {
      const probe = await photocraft("select", ["run", input, ...selectCommands(sel), "--out", path.join(tmp, "probe.png")]);
      const res = commandResult(probe.stdout, "select.");
      const b = res?.bounds as number[] | undefined;
      const empty = !res || res.selected === false || res.coverage === 0 || !b || b.length !== 4 || b[2] <= 0 || b[3] <= 0;
      if (empty) {
        deps.stderr("pi-photocraft: nothing was selected by the region selector; no image was generated\n");
        return 1;
      }
      const clipped = clipRect(fromXywh(b as number[]), image);
      if (!clipped) {
        deps.stderr("pi-photocraft: nothing was selected inside the image; no image was generated\n");
        return 1;
      }
      region = clipped;
    }

    const crop = computeCrop(region, image, options.pad, options.minCrop);

    // crop → generate → resize
    const cropFile = path.join(tmp, "crop.png");
    await photocraft("crop", ["run", input, ...cmd("image.crop", { x: crop.x, y: crop.y, width: crop.w, height: crop.h }), "--out", cropFile]);

    const genFile = path.join(tmp, "gen.png");
    const gen = await timed("generate", () =>
      deps.generate({ prompt: options.prompt, file: cropFile, output: genFile, model: options.model, flash: options.flash, backend: options.backend }),
    );
    if (!gen.ok) throw new StepError("generate", gen.error ?? "generation failed");

    const patch = path.join(tmp, "patch.png");
    await photocraft("resize", ["run", genFile, ...cmd("image.imageSize", { width: crop.w, height: crop.h }), "--out", patch]);

    // composite → flatten
    const comp = path.join(tmp, "comp.psd");
    await photocraft("composite", buildCompositeArgs({ input, patch, out: comp, crop, region, image, options }));
    const flat = path.join(tmp, `out${path.extname(outPath)}`);
    await photocraft("convert", ["convert", comp, flat]);

    // write outputs: stage beside the destination, then commit all-or-nothing
    await timed("write", async () => {
      const targets: [string, string][] = [[flat, outPath]];
      if (layeredPath) targets.push([comp, layeredPath]);
      commitOutputs(targets, staged, `${process.pid}-${deps.now()}`);
    });

    const env = deps.env.NANO_BANANA_BACKEND?.trim().toLowerCase();
    const backend = options.backend ?? (env === "pi" || env === "gemini" ? env : "gemini");
    deps.stdout(
      `${JSON.stringify({
        region,
        crop,
        backend,
        model: options.model ?? gen.model ?? null,
        out: outPath,
        layered: layeredPath ?? null,
        timings,
      })}\n`,
    );
    return 0;
  } catch (e) {
    deps.stderr(`pi-photocraft replace-region: ${(e as Error).message}\n`);
    return 1;
  } finally {
    for (const s of staged) fs.rmSync(s, { force: true });
    if (options.keepTemp) deps.stderr(`[pi-photocraft] kept intermediates in ${tmp}\n`);
    else fs.rmSync(tmp, { recursive: true, force: true });
  }
}
