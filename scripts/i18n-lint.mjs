#!/usr/bin/env node
import { execSync } from "node:child_process";
// i18n lint (D6). Flags likely-hardcoded user-facing strings that are not
// wrapped in a translator. Heuristic ripgrep-style scan over client + plugin
// sources. Advisory by default; pass --strict to exit non-zero on hits.
// Usage: node scripts/i18n-lint.mjs [--strict] [glob...]
import fs from "node:fs";

const STRICT = process.argv.includes("--strict");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const roots = args.length
  ? args
  : ["packages/client/src", ...listPluginSrc()];

function listPluginSrc() {
  try {
    return execSync(
      "find packages -maxdepth 2 -type d -path '*plugin*/src' -not -path '*/node_modules/*'",
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      // demo-plugin ships example/scaffold code, not shipped UI.
      .filter((p) => !/demo-plugin/.test(p));
  } catch {
    return [];
  }
}

// Files that are dead code (retained but no longer wired into any barrel /
// rendered surface) — excluded from the shipped-UI scan.
const DEAD_CODE = [/flows-plugin\/src\/client\/FlowsCommandRoutes\.tsx$/];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      // Skip build/test dirs, plus scaffold/demo packages that ship example
      // code rather than shipped UI (not user-facing).
      if (/node_modules|__tests__|\.test\.|dist|templates|demo-plugin|dashboard-plugin-skill/.test(p))
        continue;
      out.push(...walk(p));
    } else if (
      /\.(tsx?|jsx?)$/.test(e.name) &&
      !/\.test\.|i18n(-|\.)/.test(e.name) &&
      !DEAD_CODE.some((re) => re.test(p))
    ) {
      out.push(p);
    }
  }
  return out;
}

// Developer-only throw messages (contract violations, fetch diagnostics) are
// NOT user-facing copy — they surface via generic error banners, never as UI
// text. Excluded from the throw check.
const TECH_THROW =
  /HTTP |failed:|must be rendered|no default export|not wired|<[A-Z]\w+>|\$\{res\b|\bstatus\b/;

// Patterns for likely user-facing hardcoded text.
const JSX_TEXT = />\s*[A-Z][A-Za-z][A-Za-z ,'".!?]{3,}</; // >Some Words<
const ATTR = /\b(placeholder|aria-label|title|alt)\s*=\s*["'][A-Z][^"']{2,}["']/;
const THROW = /throw new Error\(\s*["'`][A-Z][^"'`]{4,}/;
const MSG = /\bmessage:\s*["'`][A-Z][^"'`]{4,}/;

const hits = [];
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      // Skip lines already wrapped in a translator.
      if (/\b(t|i18nT)\(/.test(line)) return;
      let kind = null;
      if (ATTR.test(line)) kind = "attr";
      else if (THROW.test(line) && !TECH_THROW.test(line)) kind = "throw";
      else if (MSG.test(line)) kind = "message";
      else if (
        JSX_TEXT.test(line) &&
        !/https?:\/\/|import |from ["']|=>|Promise<|Array<|Record<|: [A-Z]\w+</.test(line) &&
        // Proper-noun identifiers rendered in <code> are intentionally literal.
        !/<code[ >]/.test(line)
      )
        kind = "jsx-text";
      if (kind) hits.push({ file, line: i + 1, kind, text: line.trim().slice(0, 100) });
    });
  }
}

if (hits.length === 0) {
  console.log("\u2713 i18n lint: no hardcoded user-facing strings found");
  process.exit(0);
}
const byKind = {};
for (const h of hits) byKind[h.kind] = (byKind[h.kind] || 0) + 1;
console.log(`i18n lint: ${hits.length} candidate hardcoded string(s)`);
console.log("by kind:", JSON.stringify(byKind));
for (const h of hits.slice(0, 60)) {
  console.log(`  ${h.file}:${h.line} [${h.kind}] ${h.text}`);
}
if (hits.length > 60) console.log(`  \u2026 and ${hits.length - 60} more`);
process.exit(STRICT ? 1 : 0);
