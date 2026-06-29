#!/usr/bin/env node
/**
 * Build-time gate: assert the bundled server contains ZERO wmic shell-outs.
 *
 * Windows 11 22H2+ ships without wmic.exe. The repo replaced every wmic
 * invocation with PowerShell Get-CimInstance (change: replace-wmic-with-powershell).
 * This script enforces the spec scenario "No wmic shell-invocation anywhere in
 * shipped code" as a per-build CI gate so a regression can never re-ship wmic.
 *
 * Scope: only OUR bundled workspace code (paths under `@blackbelt-technology/`),
 * excluding test files. Third-party node_modules are out of scope — we don't
 * control their source. Strips comments first (so prose like "no wmic" never
 * matches), then matches a process-spawn API call whose argument list references
 * `wmic` — across newlines too, since the PowerShell replacements (and a future
 * wmic regression) span multiple lines.
 *
 * Exit 0 = clean. Exit 1 = violation(s) found (prints file:line). Exit 2 =
 * bundle dir missing (build did not run).
 *
 * Node-native (no bash) so it runs identically on Linux/macOS/Windows runners.
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE_ROOT = path.resolve(__dirname, "..", "resources", "server");

/** Only our bundled workspace packages carry this path segment. */
const OWN_CODE_SEGMENT = `${path.sep}@blackbelt-technology${path.sep}`;
const SCANNED_EXT = new Set([".js", ".cjs", ".mjs", ".ts"]);
/** Comments (block + line) — blanked to spaces so byte offsets / line numbers stay stable. */
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
/** Start of a process-spawn API call. */
const SPAWN_CALL = /\b(?:execSync|execFileSync|spawnSync|execFile|exec|spawn)\s*\(/g;
/** Max chars to scan past a call opener for a `wmic` argument (covers multiline argv). */
const ARG_WINDOW = 400;

/** Blank out comments, preserving newlines + length so offsets map back to source lines. */
function stripComments(src) {
  return src.replace(COMMENTS, (m) => m.replace(/[^\n]/g, " "));
}

/** Find wmic-referencing spawn calls in a (comment-stripped) source string. */
function findWmicCalls(src) {
  const hits = [];
  const code = stripComments(src);
  for (let m = SPAWN_CALL.exec(code); m !== null; m = SPAWN_CALL.exec(code)) {
    const window = code.slice(m.index, m.index + ARG_WINDOW);
    if (/\bwmic\b/i.test(window)) {
      const line = code.slice(0, m.index).split("\n").length;
      hits.push({ line, text: code.slice(m.index).split("\n")[0].trim() });
    }
  }
  return hits;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (st.isFile()) {
      yield full;
    }
  }
}

function main() {
  if (!existsSync(BUNDLE_ROOT)) {
    console.error(`[assert-no-wmic] bundle dir missing: ${BUNDLE_ROOT}`);
    console.error("[assert-no-wmic] run bundle-server.mjs first (gate is source_only_bundle == false).");
    process.exit(2);
  }

  const violations = [];
  let scanned = 0;
  for (const file of walk(BUNDLE_ROOT)) {
    if (!file.includes(OWN_CODE_SEGMENT)) continue;
    if (file.includes(`${path.sep}__tests__${path.sep}`) || /\.(?:test|spec)\.[cm]?[jt]s$/.test(file)) continue;
    if (!SCANNED_EXT.has(path.extname(file))) continue;
    scanned += 1;
    for (const hit of findWmicCalls(readFileSync(file, "utf-8"))) {
      violations.push({ file: path.relative(BUNDLE_ROOT, file), line: hit.line, text: hit.text });
    }
  }

  if (violations.length > 0) {
    console.error(`[assert-no-wmic] FAIL — ${violations.length} wmic invocation(s) in shipped bundle:`);
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    process.exit(1);
  }

  console.log(`[assert-no-wmic] OK — scanned ${scanned} @blackbelt-technology file(s), zero wmic invocations.`);
}

main();
