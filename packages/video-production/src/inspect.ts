/**
 * Dry-run inspector.
 *
 * Port of `parse_shots.py`: parse a shot package and report what WOULD be
 * rendered, with no API key and no SDK needed. Used to validate that prompts,
 * seeds, aspect/resolution and image references extracted correctly before
 * spending Veo credits.
 */
import * as path from "node:path";
import { type ResolveKeyOptions, resolveVeoKey } from "./env.js";
import { loadShots } from "./package.js";
import type { Shot } from "./shots.js";

export interface ShotReport {
  name: string;
  title: string;
  seed: number | null;
  aspectRatio: string;
  resolution: string;
  enhancePrompt: boolean;
  firstFrame: string | null;
  referenceImages: string[];
  seamlessNext: boolean;
  promptWords: number;
  hasPrompt: boolean;
  hasNegative: boolean;
}

export interface InspectReport {
  baseDir: string;
  keyState: string;
  shots: ShotReport[];
  /** Shots missing a Full Veo prompt block. */
  problems: string[];
}

function toShotReport(s: Shot): ShotReport {
  return {
    name: s.name,
    title: s.title,
    seed: s.seed,
    aspectRatio: s.aspectRatio,
    resolution: s.resolution,
    enhancePrompt: s.enhancePrompt,
    firstFrame: s.firstFrame,
    referenceImages: s.referenceImages,
    seamlessNext: s.seamlessNext,
    promptWords: s.prompt ? s.prompt.split(/\s+/).filter(Boolean).length : 0,
    hasPrompt: Boolean(s.prompt),
    hasNegative: Boolean(s.negative),
  };
}

export interface InspectOptions extends ResolveKeyOptions {
  target: string;
  shots?: string[];
}

export function inspectPackage(opts: InspectOptions): InspectReport {
  const { shots, baseDir } = loadShots(opts.target, opts.shots);
  const { key, source } = resolveVeoKey({ ...opts, baseDir });
  const keyState = key ? `FOUND (${source})` : "MISSING — set one before rendering";
  const reports = shots.map(toShotReport);
  return {
    baseDir,
    keyState,
    shots: reports,
    problems: reports.filter((s) => !s.hasPrompt).map((s) => s.name),
  };
}

/** Render an `InspectReport` as a human-readable table (matches the Python output). */
export function formatReport(report: InspectReport): string {
  const lines: string[] = [];
  lines.push(`Package : ${report.baseDir}`);
  lines.push(`API key : ${report.keyState}`);
  lines.push(`Shots   : ${report.shots.length}`, "");

  for (const s of report.shots) {
    const ff = s.firstFrame ? path.basename(s.firstFrame) : "—";
    const refs = s.referenceImages.map((r) => path.basename(r)).join(", ") || "—";
    const flags: string[] = [];
    if (!s.hasPrompt) flags.push("NO-PROMPT");
    if (!s.hasNegative) flags.push("no-negative");
    if (s.seamlessNext) flags.push("seamless→next");
    const flagStr = flags.length ? `  [${flags.join(", ")}]` : "";
    lines.push(
      `• ${s.name.padEnd(14)} seed=${String(s.seed).padEnd(7)} ${s.aspectRatio} ` +
        `${s.resolution.padEnd(5)} prompt=${String(s.promptWords).padStart(3)}w  ` +
        `first=${ff.padEnd(20)} ref=${refs}${flagStr}`,
    );
    lines.push(`    ${s.title}`);
  }

  lines.push("");
  if (report.problems.length > 0) {
    lines.push(`⚠ ${report.problems.length} shot(s) had no parseable Full Veo prompt — check those .md files.`);
  } else {
    lines.push("✓ All shots have a Full Veo prompt block.");
  }
  return lines.join("\n");
}
