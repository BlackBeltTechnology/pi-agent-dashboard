#!/usr/bin/env node
/**
 * Theme-token guard (D8) — the durable half of the accent-ramp repair.
 *
 * Three arms, all RATCHETS against an enumerated baseline:
 *
 *  1. fallback-form  — `var(--token, #rrggbb)` used for a themed paint. A
 *     fallback literal is authored against exactly ONE theme, so while the
 *     token is undeclared the literal paints in EVERY theme while the text
 *     layered on it stays theme-aware. Invisible in the theme it was authored
 *     for, severe in the other (measured 1.52:1 on the Gateway Setup tab).
 *
 *  2. undeclared     — a color custom property referenced by a component but
 *     declared nowhere in the theme layer.
 *
 *  3. accent-as-text (`accentText`) — a FILL accent `--accent-<hue>` painted as
 *     text (`text-[var(--accent-red)]`, `color: var(--accent-red)`). Fill
 *     accents carry no text-contrast guarantee; coloured text must use
 *     `--accent-<hue>-text` (AA 4.5:1 on every text backdrop). This arm also
 *     reads `.css`. Files in `NON_TEXT_PAINT_FILES` are skipped by it only.
 *     See change: remediate-accent-text-contrast.
 *
 * 4. raw palette (`rawPalette`) — a Tailwind palette class (`text-amber-400`,
 *     `border-l-blue-500/40`, `hover:ring-offset-red-500`). Palette classes
 *     bypass the theme tokens, so they carry no contrast guarantee in any
 *     palette but the one they were authored against. Replacement families:
 *     `--accent-<hue>-text`, `--severity-*`, `--tint-*`, `--text-*`. Counted per
 *     `<file>::<hue>` site; ratchet only, existing sites are not swept.
 *     See change: fix-folder-card-pill-contrast (design D5).
 *
 * No arm may be a sweep. When this check landed the client carried 72
 * fallback-form bindings across 19 files, and `--border` / `--danger` /
 * `--success` / `--accent-fg` / `--bg-input` / `--border-focus` were all
 * referenced-but-undeclared. A rule failing on those fails on the day it lands
 * and forces the repo-wide reflow add-zrok-custom-reserved-name declares out of
 * scope. So each arm records what exists and fails only on what is ADDED.
 *
 * The baseline only ever SHRINKS: an entry present on disk but absent from the
 * baseline fails (a new binding), and repairing a site means deleting its
 * baseline entry, after which reintroducing it fails too. Each entry carries an
 * OCCURRENCE COUNT, not just presence, so adding a second identical binding to
 * a file that already has one is also caught — presence-only keys would let a
 * site grow silently under its own baseline entry.
 *
 * Refresh a shrunk baseline with:  node scripts/theme-token-guard.mjs --write
 * Add a NEW arm's map once:         node scripts/theme-token-guard.mjs --write --bootstrap-arm accentText|rawPalette
 *
 * See change: add-zrok-custom-reserved-name.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts", "theme-token-baseline.json");

/**
 * Every plugin client tree: the directory of each package manifest's
 * `pi-dashboard-plugin.client` entry (`src/client` or, for plugins without one,
 * `src`). See change: retro-ux-plugin-settings-wave-2 (design D7).
 */
export function pluginClientRoots(root = ROOT) {
  const out = [];
  const pkgs = join(root, "packages");
  if (!existsSync(pkgs)) return out;
  for (const pkg of readdirSync(pkgs).sort()) {
    const manifest = join(pkgs, pkg, "package.json");
    if (!existsSync(manifest)) continue;
    const client = JSON.parse(readFileSync(manifest, "utf8"))["pi-dashboard-plugin"]?.client;
    if (typeof client !== "string") continue;
    out.push(posix.join("packages", pkg, posix.dirname(client.replace(/^\.\//, ""))));
  }
  return out;
}

/**
 * Source roots scanned for color custom-property references: the client, the shared
 * UI kits (`client-utils`, `dashboard-plugin-runtime`) + every plugin client tree.
 * See change: align-ui-contract-recipes (design D8).
 */
export const SCAN_ROOTS = [
  ...new Set([
    "packages/client/src",
    "packages/client-utils/src",
    "packages/dashboard-plugin-runtime/src",
    ...pluginClientRoots(),
  ]),
];

/** index.css is the theme layer — the single place a token may be declared. */
const THEME_CSS = "packages/client/src/index.css";

/**
 * Arm 1 needs no name heuristic: a `var(--x, #rrggbb)` fallback literal IS a
 * color, by construction. Arm 2 has no literal to read, so it classifies by
 * name family instead — non-color tokens (spacing, blur, opacity, alpha
 * scalars) are excluded so it does not report layout knobs.
 */
const COLOR_TOKEN_RE =
  /^--(?:accent|bg|text|border|link|status|severity|warn|danger|success|error|info|rail|grip|table-stripe|focus-ring|shadow|elevation|neon|syntax|surface|fill|stroke)/;

const NON_COLOR_SUFFIX_RE = /-(?:alpha|blur|opacity|radius|width|size|space|duration|delay)$/;

/**
 * `var(--token, <literal>)` — the fallback form.
 *
 * The fallback is matched as "anything that is not another `var()`", NOT as an
 * enumerated list of colour syntaxes. An allow-list of `#hex|rgb|hsl` silently
 * missed `transparent`, named colours, `currentColor`, `color-mix(...)` and
 * `oklch(...)` — and `color-mix` is used throughout this very codebase, so the
 * guard had a hole exactly where the next regression would land.
 *
 * `var(--a, var(--b))` is a legitimate token CHAIN, not a hardcoded literal,
 * and is deliberately excluded.
 */
const FALLBACK_RE = /var\(\s*(--[a-z0-9-]+)\s*,\s*(?!\s*var\()([^;"'`]*?)\)/g;

/** Any `var(--token…)` reference, fallback or bare. */
const ANY_VAR_RE = /var\(\s*(--[a-z0-9-]+)\s*[,)]/g;

/**
 * Arm 3 — a fill accent painted as text. The hue alternation is followed by
 * `\s*\)`, so `--accent-red-text` never matches. An opacity suffix (`]/80`)
 * still matches: nothing is anchored past `]`. The lookbehinds keep variant
 * prefixes (`hover:text-`) while rejecting `context-[…]`, and reject
 * `background-color` / `border-color` / `caret-color` / `accent-color`.
 */
const ACCENT_HUE = "--accent-(?:purple|blue|green|orange|red|yellow)";
const ACCENT_TEXT_CLASS_RE = new RegExp(`(?<![\\w-])text-\\[var\\(\\s*(${ACCENT_HUE})\\s*\\)\\]`, "g");
const ACCENT_COLOR_DECL_RE = new RegExp(`(?<![\\w-])color\\s*:\\s*["'\`]?var\\(\\s*(${ACCENT_HUE})\\s*\\)`, "g");

/**
 * Exact paths the accent-as-text arm skips. Only for files whose fill-accent
 * `text-[…]` classes colour NON-text glyphs (3:1) by spec mandate. Each entry
 * needs a `why`; the real-tree test pins the list's length, so growing it is a
 * reviewed test change, not a quiet escape hatch.
 */
export const NON_TEXT_PAINT_FILES = [
  {
    path: "packages/client/src/lib/preview/file-icon.ts",
    why: "icon colour classes mandated by file-extension-icon-lookup; non-text 3:1",
  },
];

/**
 * Arm 4 — raw Tailwind palette classes. Colour utility prefix, optional variant
 * prefixes (`hover:`, `md:`, `[&>svg]:`), one of the 22 palette hues, a numeric
 * shade and an optional opacity suffix. The lookbehind rejects `--accent-blue-500`
 * style token names and `bg-accent-blue-500` compounds; `-text` ramp tokens never
 * match because they carry no numeric shade.
 */
const PALETTE_HUES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const RAW_PALETTE_PREFIXES =
  "text|bg|border(?:-[trblxyse])?|ring(?:-offset)?|outline|divide|fill|stroke|from|via|to|placeholder|decoration|caret|accent|shadow";
const RAW_PALETTE_RE = new RegExp(
  `(?<![\\w-])(?:[^\\s"'\`:]+:)*(?:${RAW_PALETTE_PREFIXES})-(${PALETTE_HUES})-(?:50|[1-9]00|950)(?:/[\\w.\\[\\]]+)?(?![\\w-])`,
  "g",
);

/** Arms in baseline order: key, report label. One list drives load / grow / bootstrap / write. */
const ARMS = [
  ["fallback", "fallback-form"],
  ["undeclared", "undeclared-token"],
  ["accentText", "accent-as-text"],
  ["rawPalette", "rawPalette"],
];
const ARM_LABELS = Object.fromEntries(ARMS);
/** Arms a baseline may gain after the fact via --bootstrap-arm. */
const BOOTSTRAP_ARMS = ["accentText", "rawPalette"];

export function isColorToken(name) {
  return COLOR_TOKEN_RE.test(name) && !NON_COLOR_SUFFIX_RE.test(name);
}

/** Every custom property DECLARED anywhere in the theme layer. */
export function declaredTokens(css) {
  const out = new Set();
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) out.add(m[1]);
  return out;
}

function walk(dir, acc = [], ext = /\.tsx?$/) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules" || name === "dist") continue;
      walk(full, acc, ext);
    } else if (ext.test(name) && !/\.test\.tsx?$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Arm 3 over its own file set: `.ts`/`.tsx` AND `.css` (the other arms keep
 * `.ts`/`.tsx`, so their baselines are unaffected), minus `NON_TEXT_PAINT_FILES`.
 */
function scanAccentText(root, roots) {
  const skip = new Set(NON_TEXT_PAINT_FILES.map((f) => f.path));
  const acc = {};
  for (const r of roots) {
    for (const file of walk(join(root, r), [], /\.(?:tsx?|css)$/)) {
      const rel = relative(root, file).split("\\").join("/");
      if (skip.has(rel)) continue;
      const src = readFileSync(file, "utf8");
      for (const re of [ACCENT_TEXT_CLASS_RE, ACCENT_COLOR_DECL_RE]) {
        for (const m of src.matchAll(re)) acc[`${rel}::${m[1]}`] = (acc[`${rel}::${m[1]}`] ?? 0) + 1;
      }
    }
  }
  return acc;
}

/** Arm 4 over `.ts`/`.tsx` (test files excluded by `walk`). */
function scanRawPalette(root, roots) {
  const acc = {};
  for (const r of roots) {
    for (const file of walk(join(root, r))) {
      const rel = relative(root, file).split("\\").join("/");
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(RAW_PALETTE_RE)) acc[`${rel}::${m[1]}`] = (acc[`${rel}::${m[1]}`] ?? 0) + 1;
    }
  }
  return acc;
}

/**
 * Scan sources for every arm.
 *
 * @returns {{ fallback: Record<string,number>, undeclared: Record<string,number>, accentText: Record<string,number>, rawPalette: Record<string,number> }}
 *   `"<file>::<token>"` -> occurrence count.
 */
export function scan({ root = ROOT, roots = SCAN_ROOTS, css } = {}) {
  const themeCss = css ?? readFileSync(join(root, THEME_CSS), "utf8");
  const declared = declaredTokens(themeCss);
  const fallback = {};
  const undeclared = {};
  const bump = (o, k) => {
    o[k] = (o[k] ?? 0) + 1;
  };

  for (const r of roots) {
    for (const file of walk(join(root, r))) {
      const rel = relative(root, file).split("\\").join("/");
      const src = readFileSync(file, "utf8");
      // No isColorToken() filter here — the matched fallback literal is itself
      // proof the binding paints a color.
      for (const m of src.matchAll(FALLBACK_RE)) bump(fallback, `${rel}::${m[1]}`);
      for (const m of src.matchAll(ANY_VAR_RE)) {
        if (isColorToken(m[1]) && !declared.has(m[1])) bump(undeclared, `${rel}::${m[1]}`);
      }
    }
  }
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const accentText = scanAccentText(root, roots);
  const rawPalette = scanRawPalette(root, roots);
  return {
    fallback: sorted(fallback),
    undeclared: sorted(undeclared),
    accentText: sorted(accentText),
    rawPalette: sorted(rawPalette),
  };
}

/**
 * Ratchet comparison. A site on disk absent from the baseline, or present with
 * MORE occurrences than baselined, is a NEW violation and fails. A baseline
 * entry with no disk counterpart is a repair — reported as shrinkable, never a
 * failure.
 */
export function ratchet(found, baseline) {
  const added = [];
  for (const [key, n] of Object.entries(found)) {
    const allowed = baseline[key] ?? 0;
    if (n > allowed) added.push({ key, found: n, allowed });
  }
  const repaired = Object.keys(baseline).filter((k) => (found[k] ?? 0) < baseline[k]);
  return { added, repaired, ok: added.length === 0 };
}

/** Total occurrences across every site — the number the spec delta quotes. */
export function total(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/**
 * `accentText` and `rawPalette` are REQUIRED: once bootstrapped, a missing key is
 * an error, never an implicit `{}` (which would bless every existing site at once).
 */
export function loadBaseline(path = BASELINE_PATH) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  for (const arm of BOOTSTRAP_ARMS) {
    if (raw[arm] === undefined || raw[arm] === null || typeof raw[arm] !== "object") {
      throw new Error(`baseline has no "${arm}" map — establish it once with --write --bootstrap-arm ${arm}`);
    }
  }
  return {
    fallback: raw.fallback ?? {},
    undeclared: raw.undeclared ?? {},
    accentText: raw.accentText,
    rawPalette: raw.rawPalette,
  };
}

/**
 * `--write` may only SHRINK. Without this the ratchet is advisory: anyone (or
 * CI) could adopt today's numbers and re-bless a regression, which is the one
 * direction the spec forbids.
 */
function grownEntries(found, current, arms = ARMS.map(([k]) => k)) {
  const grown = [];
  for (const arm of arms) {
    for (const [key, n] of Object.entries(found[arm])) {
      const allowed = current[arm]?.[key] ?? 0;
      if (n > allowed) grown.push(`[${ARM_LABELS[arm]}] ${key}: ${n} > ${allowed}`);
    }
  }
  return grown;
}

/**
 * `--write --bootstrap-arm <accentText|rawPalette>` — adds a brand-new arm's map
 * ONCE. Deliberately NOT the `--bootstrap` path (which treats any load error as
 * permission to write a fresh baseline): this reads the raw JSON itself,
 * refuses on a missing/malformed file or an existing map for that arm, refuses
 * if the tree has grown an arm the baseline already holds, and carries every
 * existing arm over exactly as it was.
 * @returns {number} exit code
 */
function bootstrapArm(arm, found, baselinePath) {
  if (!BOOTSTRAP_ARMS.includes(arm)) {
    console.error(
      `\u2717 theme-token-guard: --bootstrap-arm supports only ${BOOTSTRAP_ARMS.map((a) => `"${a}"`).join(" or ")}, got "${arm}"`,
    );
    return 1;
  }
  if (!existsSync(baselinePath)) {
    console.error(`\u2717 theme-token-guard: --bootstrap-arm needs an existing baseline at ${baselinePath}`);
    return 1;
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (err) {
    console.error(`\u2717 theme-token-guard: baseline could not be read \u2014 ${err?.message ?? err}. Refusing to write.`);
    return 1;
  }
  if (!raw?.fallback || !raw?.undeclared) {
    console.error("\u2717 theme-token-guard: baseline lacks fallback/undeclared maps. Refusing to write.");
    return 1;
  }
  if (raw[arm] !== undefined) {
    console.error(`\u2717 theme-token-guard: baseline already has a ${arm} arm; bootstrap runs once. Use --write to shrink it.`);
    return 1;
  }
  const held = ARMS.map(([k]) => k).filter((k) => raw[k] !== undefined);
  const grown = grownEntries(found, raw, held);
  if (grown.length > 0) {
    console.error("\u2717 theme-token-guard: --bootstrap-arm refuses to GROW an existing arm. Fix the binding instead:");
    for (const g of grown) console.error(`    ${g}`);
    return 1;
  }
  const out = {};
  for (const [k] of ARMS) {
    if (k === arm) out[k] = found[k];
    else if (raw[k] !== undefined) out[k] = raw[k];
  }
  writeFileSync(baselinePath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\u2713 theme-token-guard: ${arm} arm bootstrapped \u2014 ${total(found[arm])} occurrence(s)`);
  return 0;
}

/** @returns {number} exit code */
function writeBaseline(found, { bootstrap = false, baselinePath = BASELINE_PATH } = {}) {
  let current = null;
  try {
    current = loadBaseline(baselinePath);
  } catch (err) {
    // A missing OR malformed baseline is a HARD ERROR, never an implicit
    // "adopt whatever we measure today" — same rule knip-ratchet states for
    // itself. Otherwise `rm scripts/theme-token-baseline.json && --write`
    // recreates a LARGER baseline and the shrink-only ratchet is bypassed by
    // two commands. Bootstrapping is a deliberate, separate act.
    if (!bootstrap) {
      console.error(`\u2717 theme-token-guard: baseline could not be read \u2014 ${err?.message ?? err}`);
      console.error("      Refusing to write. Repair it, or pass --bootstrap to establish a NEW one deliberately.");
      return 1;
    }
  }
  const grown = current ? grownEntries(found, current) : [];
  if (grown.length > 0) {
    console.error("\u2717 theme-token-guard: --write refuses to GROW the baseline. Fix the binding instead:");
    for (const g of grown) console.error(`    ${g}`);
    return 1;
  }
  writeFileSync(
    baselinePath,
    `${JSON.stringify(Object.fromEntries(ARMS.map(([k]) => [k, found[k]])), null, 2)}\n`,
  );
  console.log(
    `\u2713 theme-token-guard: baseline written \u2014 ${total(found.fallback)} fallback, ${total(found.undeclared)} undeclared, ${total(found.accentText)} accent-as-text, ${total(found.rawPalette)} rawPalette`,
  );
  return 0;
}

/**
 * CLI entry. Returns the exit code; `root`/`roots`/`baselinePath` are
 * injectable so the write/bootstrap paths are testable on a fixture tree.
 * @returns {number}
 */
export function main(argv = process.argv.slice(2), { root = ROOT, roots = SCAN_ROOTS, baselinePath = BASELINE_PATH } = {}) {
  const found = scan({ root, roots });
  if (argv.includes("--write")) {
    const i = argv.indexOf("--bootstrap-arm");
    if (i !== -1) return bootstrapArm(argv[i + 1], found, baselinePath);
    return writeBaseline(found, { bootstrap: argv.includes("--bootstrap"), baselinePath });
  }

  let baseline;
  try {
    baseline = loadBaseline(baselinePath);
  } catch (err) {
    console.error(`\u2717 theme-token-guard: ${err?.message ?? err}`);
    return 1;
  }
  const arms = ARMS.map(([k, label]) => [label, ratchet(found[k], baseline[k])]);

  let failed = false;
  for (const [arm, r] of arms) {
    for (const { key, found: n, allowed } of r.added) {
      const [file, token] = key.split("::");
      console.error(
        `✗ theme-token-guard [${arm}]: ${token} in ${file} — ${n} occurrence(s), baseline allows ${allowed}` +
          (arm === "rawPalette"
            ? ` (raw palette class; use --accent-<hue>-text, --severity-*, --tint-* or --text-* tokens)`
            : ""),
      );
      failed = true;
    }
    if (r.repaired.length > 0) {
      console.log(
        `· theme-token-guard [${arm}]: ${r.repaired.length} baselined entr${r.repaired.length === 1 ? "y" : "ies"} repaired — run --write to shrink the baseline`,
      );
    }
  }

  if (failed) {
    console.error(
      "\nA themed paint must resolve from a declared token, not an inline fallback literal.\n" +
        "Declare the token in packages/client/src/index.css for BOTH :root and [data-theme=\"light\"].\n" +
        "Coloured TEXT uses --accent-<hue>-text; --accent-<hue> is the fill role (no text-contrast guarantee).",
    );
    return 1;
  }
  console.log(
    `✓ theme-token-guard: no new violations (baseline ${total(baseline.fallback)} fallback, ${total(baseline.undeclared)} undeclared, ${total(baseline.accentText)} accent-as-text, ${total(baseline.rawPalette)} rawPalette)`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
