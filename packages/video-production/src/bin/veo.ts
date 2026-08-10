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
 *
 * <target> may be a project dir, a video_production dir, or a shots dir.
 */
import { formatReport, inspectPackage } from "../inspect.js";
import { planRender, type RenderOptions, renderShots } from "../render.js";
import { generateStoryboard } from "../storyboard.js";

interface Flags {
  positional: string[];
  bool: Set<string>;
  value: Record<string, string>;
  list: Record<string, string[]>;
}

const LIST_FLAGS = new Set(["shots", "only"]);
const VALUE_FLAGS = new Set(["model", "resolution", "out", "parallel", "poll", "workers", "api-key"]);

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

function requireTarget(f: Flags): string {
  const target = f.positional[0];
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
  if (report.problems.length > 0) process.exit(1);
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
    default:
      console.error(
        "usage: pi-veo <parse|render|plan|storyboard> <target> [options]\n" +
          "  parse       dry-run inspector (no key, no API)\n" +
          "  plan        resolve + print the render plan (no API)\n" +
          "  render      render shots to mp4 via Veo 3.1\n" +
          "  storyboard  (re)generate first-frame sketches via nano-banana",
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
