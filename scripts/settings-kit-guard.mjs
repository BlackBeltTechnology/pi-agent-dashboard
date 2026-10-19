#!/usr/bin/env node
/**
 * Settings-kit guard (design D7) — a RATCHET that keeps plugin settings bodies on
 * the shared runtime field kit.
 *
 * Scans every `.tsx` under the directory holding a module referenced by a
 * `settings-section` claim (resolved from each package manifest's
 * `pi-dashboard-plugin.claims`), minus `EXEMPT_FILES`, and counts per file:
 *
 *   checkbox   native `type="checkbox"`
 *   select     native `<select`
 *   hex        hex colour literal
 *   rgb        `rgb(` / `rgba(` literal
 *   palette    Tailwind palette colour class (`text-red-400`, `bg-zinc-800`, `accent-blue-500`)
 *   small-text text below 11 px (`text-[10px]`, `text-[9.5px]`, `fontSize: 10`)
 *   muted-text `--text-muted` / `--text-faint` painted as text
 *   identity   a JSX text node equal to the plugin's displayName or id
 *
 * Two tiers (decision 2026-10-18, recorded in design D7):
 *  - every file in a settings body's render closure (`settingsClosure`: the
 *    claimed module plus its package-local imports) must stay at ZERO — the
 *    real-tree test asserts the baseline holds no entry for one;
 *  - other files in those directories (boards, chips, panels) are legacy
 *    entries in the shrink-only baseline, so new drift there fails too.
 *
 * Comments are stripped before matching. Identity headers built from i18n keys
 * are invisible here; per-plugin render tests cover them.
 *
 * Same shape as `theme-token-guard.mjs`: per-file occurrence counts in a
 * baseline that only SHRINKS. A count above the baseline, or a new file with a
 * non-zero count, fails. `--write` refuses to grow the baseline.
 *
 *   node scripts/settings-kit-guard.mjs            # check
 *   node scripts/settings-kit-guard.mjs --write    # shrink the baseline
 *
 * See change: retro-ux-plugin-settings-wave-2 (design D7, test-plan #E33/#E34).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts", "settings-kit-baseline.json");

/** Files exempt from the lint (repo-relative). The MCP server editor modal keeps its schema-driven controls. */
export const EXEMPT_FILES = ["packages/mcp-client-plugin/src/client/ServerEditor.tsx"];

export const KINDS = ["checkbox", "select", "hex", "rgb", "palette", "small-text", "muted-text", "identity"];

const PALETTE_HUES =
  "red|green|blue|yellow|amber|gray|grey|slate|zinc|neutral|stone|emerald|orange|purple|indigo|sky|teal|cyan|lime|pink|rose|violet|fuchsia";
const PALETTE_PREFIX = "bg|text|border|ring|from|to|via|fill|stroke|outline|divide|accent|decoration|placeholder|caret|shadow";

const PATTERNS = {
  checkbox: /type\s*[=:]\s*\{?\s*["'`]checkbox["'`]/g,
  select: /<select\b/g,
  hex: /(?<![\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g,
  rgb: /\brgba?\(/g,
  // `text-red-400`, `hover:bg-zinc-800/50`, `accent-blue-500`. `text-white` is NOT counted:
  // the contract's primary button is white on `--accent-solid`.
  palette: new RegExp(`(?<![\\w-])(?:${PALETTE_PREFIX})-(?:${PALETTE_HUES})-\\d{2,3}(?![\\w-])`, "g"),
  "small-text": /text-\[(?:\d|10)(?:\.\d+)?px\]|fontSize\s*:\s*["'`]?(?:\d|10)(?:\.\d+)?(?:px)?["'`]?(?![\d.])/g,
  "muted-text": /text-\[var\(--text-(?:muted|faint)\)\]|(?<![\w-])color\s*:\s*["'`]?var\(--text-(?:muted|faint)\)/g,
};

/** Strip `//` line comments and block comments (keeps strings intact enough for class lists). */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count every kind in one source text. `identity` = names (displayName, id). */
export function countKinds(src, identity = []) {
  const code = stripComments(src);
  const out = {};
  for (const [kind, re] of Object.entries(PATTERNS)) {
    const n = [...code.matchAll(re)].length;
    if (n > 0) out[kind] = n;
  }
  let ident = 0;
  for (const name of identity.filter(Boolean)) {
    const re = new RegExp(`>\\s*${escapeRe(name)}\\s*<`, "g");
    ident += [...code.matchAll(re)].length;
  }
  if (ident > 0) out.identity = ident;
  return out;
}

/**
 * Every settings-section claim as `{ pkg, plugin, file }`, `file` repo-relative.
 * A claim without `module` resolves through the manifest's `client` entry: the
 * `.tsx` in that entry's directory that declares the claimed component
 * (`component` is then set, so the closure follows only that component's imports).
 */
export function settingsClaims(root = ROOT) {
  const out = [];
  const pkgs = join(root, "packages");
  if (!existsSync(pkgs)) return out;
  for (const pkg of readdirSync(pkgs).sort()) {
    const manifestPath = join(pkgs, pkg, "package.json");
    if (!existsSync(manifestPath)) continue;
    const plugin = JSON.parse(readFileSync(manifestPath, "utf8"))["pi-dashboard-plugin"];
    for (const c of plugin?.claims ?? []) {
      if (c.slot !== "settings-section") continue;
      let file = null;
      if (c.module) {
        file = posix.join("packages", pkg, c.module.replace(/^\.\//, ""));
      } else if (typeof plugin.client === "string" && c.component) {
        const dir = posix.join("packages", pkg, posix.dirname(plugin.client.replace(/^\.\//, "")));
        const decl = new RegExp(`(?:function|const|class)\\s+${escapeRe(c.component)}\\b`);
        file =
          walk(join(root, dir))
            .map((f) => relative(root, f).split("\\").join("/"))
            .find((f) => decl.test(readFileSync(join(root, f), "utf8"))) ?? null;
      }
      if (file) out.push({ pkg, plugin, file, component: c.module ? null : c.component });
    }
  }
  return out;
}

/**
 * Every settings-section claim's directory with its plugin identity.
 * @returns {{ dir: string, identity: string[] }[]} dir repo-relative, deduped
 */
export function settingsRoots(root = ROOT) {
  const byDir = new Map();
  for (const { plugin, file } of settingsClaims(root)) {
    const dir = posix.dirname(file);
    const identity = [plugin.displayName, plugin.id].filter(Boolean);
    byDir.set(dir, { dir, identity: [...new Set([...(byDir.get(dir)?.identity ?? []), ...identity])] });
  }
  return [...byDir.values()];
}

/**
 * Every repo-relative file reachable from a settings-section module through
 * package-local relative imports (`.tsx`/`.ts`). The settings body's render tree.
 * @returns {Set<string>}
 */
export function settingsClosure(root = ROOT) {
  const resolveImport = (from, spec) => {
    const base = posix.join(posix.dirname(from), spec).replace(/\.js$/, "");
    return [".tsx", ".ts", "/index.tsx", "/index.ts"].map((e) => base + e).find((c) => existsSync(join(root, c)));
  };
  const queue = [];
  const barrels = new Set();
  for (const { file, component } of settingsClaims(root)) {
    if (!component) {
      queue.push(file);
      continue;
    }
    // Barrel file declaring several claim components: keep the file, but follow
    // only the imports whose bound names the claimed component's body references.
    queue.push(file);
    barrels.add(file);
    const src = stripComments(readFileSync(join(root, file), "utf8"));
    const at = src.search(new RegExp(`(?:function|const|class)\\s+${escapeRe(component)}\\b`));
    const rest = src.slice(at);
    const end = rest.search(/\n}\n|\n};\n/);
    const body = end === -1 ? rest : rest.slice(0, end);
    const bindings = [
      ...[...src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g)].flatMap((m) =>
        m[1].split(",").map((n) => [n.trim().split(/\s+as\s+/).pop(), m[2]]),
      ),
      ...[...src.matchAll(/import\s+(\w+)\s+from\s*["'](\.[^"']+)["']/g)].map((m) => [m[1], m[2]]),
      ...[...src.matchAll(/const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*["'](\.[^"']+)["']/g)].map((m) => [m[1], m[2]]),
    ];
    for (const [name, spec] of bindings) {
      if (name && new RegExp(`\\b${escapeRe(name)}\\b`).test(body)) {
        const hit = resolveImport(file, spec);
        if (hit) queue.push(hit);
      }
    }
  }
  const seen = new Set();
  while (queue.length > 0) {
    const rel = queue.pop();
    if (seen.has(rel) || !existsSync(join(root, rel))) continue;
    seen.add(rel);
    if (barrels.has(rel)) continue;
    const src = readFileSync(join(root, rel), "utf8");
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
      const hit = resolveImport(rel, m[1]);
      if (hit) queue.push(hit);
    }
  }
  return seen;
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
    } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * @returns {Record<string, number>} `"<file>::<kind>"` → occurrence count, sorted.
 */
export function scan({ root = ROOT, roots = settingsRoots(root), exempt = EXEMPT_FILES } = {}) {
  const skip = new Set(exempt);
  const out = {};
  const seen = new Set();
  for (const { dir, identity } of roots) {
    for (const file of walk(join(root, dir))) {
      const rel = relative(root, file).split("\\").join("/");
      if (skip.has(rel) || seen.has(rel)) continue;
      seen.add(rel);
      const counts = countKinds(readFileSync(file, "utf8"), identity);
      for (const [kind, n] of Object.entries(counts)) out[`${rel}::${kind}`] = n;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Same contract as theme-token-guard: added = above baseline (fails), repaired = below (shrinkable). */
export function ratchet(found, baseline) {
  const added = [];
  for (const [key, n] of Object.entries(found)) {
    const allowed = baseline[key] ?? 0;
    if (n > allowed) added.push({ key, found: n, allowed });
  }
  const repaired = Object.keys(baseline).filter((k) => (found[k] ?? 0) < baseline[k]);
  return { added, repaired, ok: added.length === 0 };
}

export function total(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

export function loadBaseline(path = BASELINE_PATH) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!raw || typeof raw.counts !== "object" || raw.counts === null) {
    throw new Error(`baseline at ${path} has no "counts" map`);
  }
  return raw.counts;
}

/** @returns {number} exit code */
export function main(argv = process.argv.slice(2), { root = ROOT, roots, baselinePath = BASELINE_PATH } = {}) {
  const found = scan({ root, roots: roots ?? settingsRoots(root) });
  if (argv.includes("--write")) {
    let current = null;
    try {
      current = loadBaseline(baselinePath);
    } catch (err) {
      if (!argv.includes("--bootstrap")) {
        console.error(`\u2717 settings-kit-guard: baseline could not be read \u2014 ${err?.message ?? err}. Refusing to write.`);
        return 1;
      }
    }
    if (current) {
      const grown = ratchet(found, current).added;
      if (grown.length > 0) {
        console.error("\u2717 settings-kit-guard: --write refuses to GROW the baseline. Fix the file instead:");
        for (const g of grown) console.error(`    ${g.key}: ${g.found} > ${g.allowed}`);
        return 1;
      }
    }
    writeFileSync(baselinePath, `${JSON.stringify({ counts: found }, null, 2)}\n`);
    console.log(`\u2713 settings-kit-guard: baseline written \u2014 ${total(found)} occurrence(s)`);
    return 0;
  }

  let baseline;
  try {
    baseline = loadBaseline(baselinePath);
  } catch (err) {
    console.error(`\u2717 settings-kit-guard: ${err?.message ?? err}`);
    return 1;
  }
  const r = ratchet(found, baseline);
  for (const { key, found: n, allowed } of r.added) {
    const [file, kind] = key.split("::");
    console.error(`\u2717 settings-kit-guard [${kind}]: ${file} \u2014 ${n} occurrence(s), baseline allows ${allowed}`);
  }
  if (r.repaired.length > 0) {
    console.log(`\u00b7 settings-kit-guard: repaired ${r.repaired.join(", ")} \u2014 run --write to shrink the baseline`);
  }
  if (!r.ok) {
    console.error(
      "\nPlugin settings bodies use the runtime field kit (ToggleField, SelectField, SettingsStatusPill, …),\n" +
        "paint only through theme tokens, keep text at 11 px or more, and never repeat the plugin's name or id.",
    );
    return 1;
  }
  console.log(`\u2713 settings-kit-guard: no new violations (baseline ${total(baseline)} occurrence(s))`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
