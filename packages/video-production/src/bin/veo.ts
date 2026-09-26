#!/usr/bin/env node
/**
 * pi-veo — parse / plan / render a Veo shot package, and generate storyboards.
 *
 * TypeScript port of the veo-generator Python scripts (parse_shots.py,
 * veo_render.py, gen_storyboard.py) unified behind one CLI. Runs as TypeScript
 * via pi's jiti loader (no build step).
 *
 * Usage:
 *   pi-veo parse <target> [--shots 01 03A] [--json]
 *   pi-veo render <target> [--shots …] [--model fast|standard] [--resolution 720p|1080p|4k]
 *                          [--with-reference] [--no-first-frame] [--chain] [--parallel N]
 *                          [--force] [--no-seed] [--enhance-prompt] [--api-key KEY]
 *                          [--poll SECONDS] [--dry-run]
 *   pi-veo storyboard <target> [--only shot_01 …] [--force] [--workers N] [--api-key KEY]
 *   pi-veo export render <target> [--out DIR] [--job ID] [--new-job] [--no-last-frame]
 *                          [--durations MIN-MAX] [--aspect 16:9,9:16] [--json]
 *   pi-veo export timeline <target> --clips DIR [--out DIR] [--job ID] [--json]
 *   pi-veo mux <target> --picture MP4 [--out FILE] [--force] [--burn]
 *
 * `export` writes job specs for @amaster.ai/pi-video-gen (verified 0.1.18);
 * run it from the pi session cwd. `--out` = clip dir (render), job output dir
 * (export), master file (mux).
 *
 * <target> may be a project dir, a video_production dir, or a shots dir.
 */
import { type ExportOptions, exportRender, exportTimeline, formatExportReport } from "../export.js";
import { formatReport, inspectPackage } from "../inspect.js";
import { runMux } from "../mux.js";
import { planRender, type RenderOptions, renderShots } from "../render.js";
import { generateStoryboard } from "../storyboard.js";

interface Flags {
  positional: string[];
  bool: Set<string>;
  value: Record<string, string>;
  list: Record<string, string[]>;
}

const LIST_FLAGS = new Set(["shots", "only"]);
const VALUE_FLAGS = new Set([
  "model",
  "resolution",
  "out",
  "parallel",
  "poll",
  "workers",
  "api-key",
  "job",
  "clips",
  "picture",
  "durations",
  "aspect",
]);

function parseFlags(argv: string[]): Flags {
  const f: Flags = { positional: [], bool: new Set(), value: {}, list: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      f.positional.push(a);
      continue;
    }
    const name = a.slice(2);
    if (LIST_FLAGS.has(name)) {
      const items: string[] = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) items.push(argv[++i]);
      f.list[name] = items;
    } else if (VALUE_FLAGS.has(name)) {
      f.value[name] = argv[++i];
    } else {
      f.bool.add(name);
    }
  }
  return f;
}

function requireTarget(f: Flags, index = 0): string {
  const target = f.positional[index];
  if (!target) {
    console.error("error: missing <target> (project dir, video_production dir, or shots dir)");
    process.exit(1);
  }
  return target;
}

async function cmdParse(f: Flags): Promise<void> {
  const report = inspectPackage({ target: requireTarget(f), shots: f.list.shots });
  if (f.bool.has("json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }
  if (report.problems.length > 0 || (report.sidecars?.problems.length ?? 0) > 0) process.exit(1);
}

function usageError(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseDurations(v: string | undefined): [number, number] | undefined {
  if (v === undefined) return undefined;
  const m = /^(\d+)-(\d+)$/.exec(v);
  if (!m || Number(m[1]) > Number(m[2])) {
    usageError("error: --durations must be <min>-<max> integers with min <= max (from video_capabilities)");
  }
  return [Number(m[1]), Number(m[2])];
}

const EXPORT_USAGE =
  "usage: pi-veo export <render|timeline> <target> [options]\n" +
  "  render    write .video-gen/<job>/render-input.json for pi-video-gen video_render\n" +
  "  timeline  write .video-gen/<job>/timeline-input.json for pi-video-gen video_compose (needs --clips <dir>)\n" +
  "Verified against @amaster.ai/pi-video-gen 0.1.18. Run from the pi session cwd.";

async function cmdExport(f: Flags): Promise<void> {
  const mode = f.positional[0];
  if (mode !== "render" && mode !== "timeline") usageError(EXPORT_USAGE);
  const target = requireTarget(f, 1);
  const opts: ExportOptions = {
    target,
    out: f.value.out,
    job: f.value.job,
    newJob: f.bool.has("new-job"),
    noLastFrame: f.bool.has("no-last-frame"),
    durations: parseDurations(f.value.durations),
    aspect: f.value.aspect?.split(",").map((a) => a.trim()).filter(Boolean),
    clips: f.value.clips,
  };
  if (mode === "timeline" && !opts.clips) usageError("error: --clips <dir> is required");
  const r = mode === "render" ? exportRender(opts) : exportTimeline(opts);
  if (f.bool.has("json")) {
    console.log(JSON.stringify({ specPath: r.specPath, jobDir: r.jobDir, tool: r.tool, warnings: r.warnings }, null, 2));
  } else {
    console.log(formatExportReport(r));
  }
}

async function cmdMux(f: Flags): Promise<void> {
  const r = await runMux({
    target: requireTarget(f),
    picture: f.value.picture,
    out: f.value.out,
    force: f.bool.has("force"),
    burn: f.bool.has("burn"),
  });
  for (const w of r.warnings) console.log(`⚠ ${w}`);
  console.log(`✓ master: ${r.output}`);
}

function renderOptions(f: Flags): RenderOptions {
  return {
    target: requireTarget(f),
    shots: f.list.shots,
    out: f.value.out,
    model: f.value.model,
    resolution: f.value.resolution as RenderOptions["resolution"],
    withReference: f.bool.has("with-reference"),
    noFirstFrame: f.bool.has("no-first-frame"),
    chain: f.bool.has("chain"),
    parallel: f.value.parallel ? Number.parseInt(f.value.parallel, 10) : undefined,
    force: f.bool.has("force"),
    noSeed: f.bool.has("no-seed"),
    enhancePrompt: f.bool.has("enhance-prompt"),
    cliKey: f.value["api-key"],
    poll: f.value.poll ? Number.parseInt(f.value.poll, 10) : undefined,
  };
}

async function cmdRender(f: Flags): Promise<void> {
  const opts = renderOptions(f);
  const plan = planRender(opts);

  console.log(`Package    : ${plan.baseDir}`);
  console.log(`Output     : ${plan.outDir}`);
  console.log(`Model      : ${plan.model}`);
  console.log(`API key    : ${plan.keyState}`);
  console.log(`Shots      : ${plan.shots.length}  (${opts.chain ? "chained sequential" : "independent"})\n`);

  if (plan.missingPrompt.length > 0) {
    console.error(`error: these shots have no Full Veo prompt block: ${plan.missingPrompt.join(", ")}`);
    process.exit(1);
  }

  if (f.bool.has("dry-run")) {
    for (const s of plan.shots) {
      const ff = s.firstFrame && !opts.noFirstFrame ? s.firstFrame.split("/").pop() : "—";
      console.log(
        `  would render ${s.name.padEnd(14)} -> ${plan.outDir.split("/").pop()}/${s.name}.mp4  ` +
          `(seed=${s.seed}, ${s.aspectRatio}, ${opts.resolution ?? s.resolution}, first=${ff})`,
      );
    }
    console.log("\nDry run only — no API calls made.");
    return;
  }

  const results = await renderShots(opts);
  if (results.some((r) => r.status === "error")) process.exit(1);
}

async function cmdStoryboard(f: Flags): Promise<void> {
  const run = await generateStoryboard({
    target: requireTarget(f),
    only: f.list.only,
    force: f.bool.has("force"),
    workers: f.value.workers ? Number.parseInt(f.value.workers, 10) : undefined,
    cliKey: f.value["api-key"],
    onResult: (r) => {
      if (r.skipped) console.log(`= ${r.name}: exists, skip`);
      else if (r.ok) console.log(`✓ ${r.name}: ${r.output?.split("/").pop()}`);
      else console.log(`✗ ${r.name}: failed — ${r.error}`);
    },
  });
  console.log(`\nKey: ${run.keySource}\nStoryboard: ${run.storyboardDir}`);
  if (run.results.some((r) => !r.ok)) process.exit(1);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = parseFlags(rest);
  switch (cmd) {
    case "parse":
      await cmdParse(f);
      break;
    case "render":
    case "plan":
      if (cmd === "plan") f.bool.add("dry-run");
      await cmdRender(f);
      break;
    case "storyboard":
      await cmdStoryboard(f);
      break;
    case "export":
      await cmdExport(f);
      break;
    case "mux":
      await cmdMux(f);
      break;
    default:
      console.error(
        "usage: pi-veo <parse|plan|render|storyboard|export|mux> <target> [options]\n" +
          "  parse       dry-run inspector (no key, no API)\n" +
          "  plan        resolve + print the render plan (no API)\n" +
          "  render      render shots to mp4 via Veo 3.1\n" +
          "  storyboard  (re)generate first-frame sketches via nano-banana\n" +
          "  export      export <render|timeline> <target> — pi-video-gen job specs (no API)\n" +
          "  mux         mux <target> --picture <mp4> — final VO/music/captions mix via ffmpeg",
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
