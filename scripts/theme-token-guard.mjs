#!/usr/bin/env node
/**
 * Theme-token guard (D8) — the durable half of the accent-ramp repair.
 *
 * Two arms, both RATCHETS against an enumerated baseline:
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
 * Neither arm may be a sweep. When this check landed the client carried 72
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
 *
 * See change: add-zrok-custom-reserved-name.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts", "theme-token-baseline.json");

/** Source roots scanned for color custom-property references. */
export const SCAN_ROOTS = [
  "packages/client/src",
  "packages/automation-plugin/src/client",
  "packages/flows-plugin/src/client",
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

export function isColorToken(name) {
  return COLOR_TOKEN_RE.test(name) && !NON_COLOR_SUFFIX_RE.test(name);
}

/** Every custom property DECLARED anywhere in the theme layer. */
export function declaredTokens(css) {
  const out = new Set();
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) out.add(m[1]);
  return out;
}

function walk(dir, acc = []) {
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
      walk(full, acc);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Scan sources for both arms.
 *
 * @returns {{ fallback: Record<string,number>, undeclared: Record<string,number> }}
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
  return { fallback: sorted(fallback), undeclared: sorted(undeclared) };
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

export function loadBaseline(path = BASELINE_PATH) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return { fallback: raw.fallback ?? {}, undeclared: raw.undeclared ?? {} };
}

/**
 * `--write` may only SHRINK. Without this the ratchet is advisory: anyone (or
 * CI) could adopt today's numbers and re-bless a regression, which is the one
 * direction the spec forbids.
 */
function grownEntries(found, current) {
  const grown = [];
  for (const arm of ["fallback", "undeclared"]) {
    for (const [key, n] of Object.entries(found[arm])) {
      const allowed = current[arm][key] ?? 0;
      if (n > allowed) grown.push(`[${arm}] ${key}: ${n} > ${allowed}`);
    }
  }
  return grown;
}

function writeBaseline(found) {
  let current = null;
  try {
    current = loadBaseline();
  } catch (err) {
    // ONLY a missing file means "no baseline yet". Swallowing every error made
    // the refuses-to-grow guard trivially bypassable: corrupt the baseline JSON
    // and `--write` would happily adopt today's numbers, which is precisely the
    // direction the ratchet forbids.
    if (err?.code !== "ENOENT") {
      console.error(`\u2717 theme-token-guard: existing baseline could not be read \u2014 ${err?.message ?? err}`);
      console.error("      Refusing to overwrite it. Repair or delete it deliberately.");
      process.exit(1);
    }
  }
  const grown = current ? grownEntries(found, current) : [];
  if (grown.length > 0) {
    console.error("\u2717 theme-token-guard: --write refuses to GROW the baseline. Fix the binding instead:");
    for (const g of grown) console.error(`    ${g}`);
    process.exit(1);
  }
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ fallback: found.fallback, undeclared: found.undeclared }, null, 2)}\n`,
  );
  console.log(
    `\u2713 theme-token-guard: baseline written \u2014 ${total(found.fallback)} fallback, ${total(found.undeclared)} undeclared`,
  );
}

function main() {
  const found = scan();
  if (process.argv.includes("--write")) {
    writeBaseline(found);
    return;
  }

  const baseline = loadBaseline();
  const arms = [
    ["fallback-form", ratchet(found.fallback, baseline.fallback)],
    ["undeclared-token", ratchet(found.undeclared, baseline.undeclared)],
  ];

  let failed = false;
  for (const [arm, r] of arms) {
    for (const { key, found: n, allowed } of r.added) {
      const [file, token] = key.split("::");
      console.error(
        `✗ theme-token-guard [${arm}]: ${token} in ${file} — ${n} occurrence(s), baseline allows ${allowed}`,
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
        "Declare the token in packages/client/src/index.css for BOTH :root and [data-theme=\"light\"].",
    );
    process.exit(1);
  }
  console.log(
    `✓ theme-token-guard: no new violations (baseline ${total(baseline.fallback)} fallback, ${total(baseline.undeclared)} undeclared)`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
