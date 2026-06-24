/**
 * Layered validation pipeline (L1–L4), parameterized by a selected preset.
 *
 *   L1 token-lint   — static, hard GATE when a token-linter applies.
 *   L2 a11y floor   — rendered axe + WCAG contrast, hard GATE (all systems).
 *   L3 named auditor— shell out to system tool if present, ADVISORY.
 *   L4 vision rubric— per-preset boolean checks, score = pass/N, ADVISORY.
 *
 * Gate layers determine `pass`; advisory layers only score. Every optional
 * tool degrades to "skipped + noted" when absent — the pipeline never throws
 * for a missing validator.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { DesignSystemPreset } from "./registry.js";
import { rubricPath } from "./contract.js";

export type LayerStatus = "pass" | "fail" | "skipped";

export interface LayerResult {
  layer: "L1" | "L2" | "L3" | "L4";
  tool: string;
  status: LayerStatus;
  gate: boolean;
  messages: string[];
}

export interface RubricCheck {
  id: string;
  text: string;
}

export interface L4Result extends LayerResult {
  checks: RubricCheck[];
  score: number | null;
}

export interface ValidateResult {
  system: string;
  gates: { l1: LayerResult; l2: LayerResult };
  advisory: { l3: LayerResult; l4: L4Result };
  pass: boolean;
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * True when an executable resolves on PATH. Pure filesystem scan (no
 * subprocess spawn): splits `PATH` on `path.delimiter` and probes the bare
 * name plus common Windows extensions. Checking `.exe`/`.cmd`/`.bat` on POSIX
 * is harmless (those files don't exist), so no platform branch is needed.
 */
export function isToolAvailable(name: string): boolean {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const candidates = [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`];
  for (const dir of dirs) {
    for (const c of candidates) {
      try {
        if (fs.existsSync(path.join(dir, c))) return true;
      } catch {
        // ignore unreadable PATH entries
      }
    }
  }
  return false;
}

function listFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (exts.includes(path.extname(e.name).toLowerCase())) out.push(full);
    }
  };
  walk(dir);
  return out;
}

// ── WCAG contrast (inline, no dep) ──────────────────────────────────────────

function srgbToLin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relLuminance(...a);
  const lb = relLuminance(...b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Parse a #rgb / #rrggbb hex into an [r,g,b] triple, or null. */
export function parseHex(hex: string): [number, number, number] | null {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const HEX_RE = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g;
/** A line that defines a CSS custom property (a token definition, not usage). */
const TOKEN_DEF_RE = /--[\w-]+\s*:/;

// ── L1: static token-lint ───────────────────────────────────────────────────

/**
 * Built-in token-lint gate: flags raw hex color literals used outside CSS
 * custom-property definitions (= off-token usage). Applies when the preset's
 * L1 validator is bundled (shadcn, material-3). Optional external linters
 * (mui/fluent) are noted as available/absent but not run here.
 */
export function runL1(preset: DesignSystemPreset, dir?: string): LayerResult {
  const spec = preset.validators.find((v) => v.layer === "L1");
  if (!spec) {
    return { layer: "L1", tool: "(none)", status: "skipped", gate: false, messages: ["No L1 token-lint for this system."] };
  }
  if (!spec.bundled) {
    const present = isToolAvailable(spec.tool);
    return {
      layer: "L1",
      tool: spec.tool,
      status: "skipped",
      gate: false,
      messages: [present ? `${spec.tool} present (optional — run separately).` : `${spec.tool} not found — skipped + noted.`],
    };
  }
  if (!dir || !fs.existsSync(dir)) {
    return { layer: "L1", tool: spec.tool, status: "skipped", gate: spec.gate, messages: ["No mockup dir to lint."] };
  }
  const files = listFiles(dir, [".html", ".htm", ".css", ".tsx", ".jsx", ".vue"]);
  const offending: string[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (TOKEN_DEF_RE.test(line)) return;
      const hits = line.match(HEX_RE);
      if (hits) offending.push(`${path.relative(dir, file)}:${i + 1} raw hex ${hits.join(", ")}`);
    });
  }
  if (offending.length) {
    return { layer: "L1", tool: spec.tool, status: "fail", gate: spec.gate, messages: ["Off-token color literals:", ...offending.slice(0, 20)] };
  }
  return { layer: "L1", tool: spec.tool, status: "pass", gate: spec.gate, messages: ["No off-token color literals."] };
}

// ── L2: a11y floor (axe if present + built-in contrast) ─────────────────────

/**
 * Built-in WCAG contrast scan: finds `color` + `background[-color]` hex pairs
 * declared in the same CSS rule or inline style and flags ratios < 4.5:1.
 * Deterministic + offline; the gate for the L2 floor. axe-core augments when
 * @axe-core/playwright + playwright resolve (advisory message only here).
 */
export function runL2(_preset: DesignSystemPreset, dir?: string): LayerResult {
  if (!dir || !fs.existsSync(dir)) {
    return { layer: "L2", tool: "@axe-core/playwright", status: "skipped", gate: true, messages: ["No mockup dir to scan."] };
  }
  const files = listFiles(dir, [".html", ".htm", ".css"]);
  const failures: string[] = [];
  // Match a CSS-declaration block or inline style; pull color + background.
  const blockRe = /\{[^}]*\}|style\s*=\s*"[^"]*"/g;
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const blocks = text.match(blockRe) ?? [];
    for (const block of blocks) {
      const fg = /(?:^|[^-])color\s*:\s*(#[0-9a-fA-F]{3,8})/.exec(block);
      const bg = /background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})/.exec(block);
      if (fg && bg) {
        const a = parseHex(fg[1]);
        const b = parseHex(bg[1]);
        if (a && b) {
          const ratio = contrastRatio(a, b);
          if (ratio < 4.5) failures.push(`${path.basename(file)}: ${fg[1]} on ${bg[1]} = ${ratio.toFixed(2)}:1 (< 4.5)`);
        }
      }
    }
  }
  const axe = isToolAvailable("playwright") ? "axe-core available" : "axe-core/playwright absent (built-in contrast scan only)";
  if (failures.length) {
    return { layer: "L2", tool: "@axe-core/playwright", status: "fail", gate: true, messages: [`Contrast failures (${axe}):`, ...failures.slice(0, 20)] };
  }
  return { layer: "L2", tool: "@axe-core/playwright", status: "pass", gate: true, messages: [`Contrast floor OK (${axe}).`] };
}

// ── L3: named-system auditor (shell-out-if-present) ─────────────────────────

export function runL3(preset: DesignSystemPreset): LayerResult {
  const spec = preset.validators.find((v) => v.layer === "L3");
  if (!spec) {
    return { layer: "L3", tool: "(none)", status: "skipped", gate: false, messages: ["No named-system auditor for this system."] };
  }
  if (!isToolAvailable(spec.tool)) {
    return { layer: "L3", tool: spec.tool, status: "skipped", gate: false, messages: [`skipped (${spec.tool} not found)`] };
  }
  return { layer: "L3", tool: spec.tool, status: "pass", gate: false, messages: [`${spec.tool} present — run it against the mockup for advisory findings.`] };
}

// ── L4: vision rubric ───────────────────────────────────────────────────────

export function loadRubric(id: string): RubricCheck[] {
  const file = rubricPath(id);
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { checks?: RubricCheck[] };
  return parsed.checks ?? [];
}

/**
 * L4 vision judge. Returns the preset's boolean rubric for the agent to fill.
 * When `answers` (id → boolean) are supplied, derives `score = passCount / N`
 * in code — the model never emits the aggregate float itself.
 */
export function runL4(preset: DesignSystemPreset, answers?: Record<string, boolean>): L4Result {
  const checks = loadRubric(preset.id);
  let score: number | null = null;
  const messages: string[] = [];
  if (!checks.length) {
    messages.push("No rubric for this system.");
  } else if (answers && Object.keys(answers).length) {
    const passCount = checks.filter((c) => answers[c.id] === true).length;
    score = passCount / checks.length;
    messages.push(`Rubric score ${passCount}/${checks.length} = ${(score * 100).toFixed(0)}%.`);
  } else {
    messages.push(`Answer each of the ${checks.length} boolean checks (PASS/FAIL + one-line reason); score = pass/N.`);
  }
  return { layer: "L4", tool: "rubric", status: "skipped", gate: false, messages, checks, score };
}

// ── orchestrator ────────────────────────────────────────────────────────────

export function validateMockup(opts: {
  preset: DesignSystemPreset;
  dir?: string;
  answers?: Record<string, boolean>;
}): ValidateResult {
  const { preset, dir, answers } = opts;
  const l1 = runL1(preset, dir);
  const l2 = runL2(preset, dir);
  const l3 = runL3(preset);
  const l4 = runL4(preset, answers);
  // Gate layers determine pass: only an explicit gate `fail` blocks.
  const gateBlocked = [l1, l2].some((r) => r.gate && r.status === "fail");
  return {
    system: preset.id,
    gates: { l1, l2 },
    advisory: { l3, l4 },
    pass: !gateBlocked,
  };
}
