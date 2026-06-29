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
 * control their source. Matches a process-spawn API call referencing `wmic`
 * on the same line (comments mentioning "no wmic" do NOT match: they carry no
 * exec/spawn token).
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
/** exec/spawn API call referencing wmic on the same line. */
const WMIC_INVOCATION = /\b(?:execSync|execFileSync|spawnSync|execFile|exec|spawn)\b[^;\n]*\bwmic\b/i;

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
    if (file.includes(`${path.sep}__tests__${path.sep}`) || /\.test\.[cm]?[jt]s$/.test(file)) continue;
    if (!SCANNED_EXT.has(path.extname(file))) continue;
    scanned += 1;
    const lines = readFileSync(file, "utf-8").split("\n");
    lines.forEach((line, i) => {
      if (WMIC_INVOCATION.test(line)) {
        violations.push({ file: path.relative(BUNDLE_ROOT, file), line: i + 1, text: line.trim() });
      }
    });
  }

  if (violations.length > 0) {
    console.error(`[assert-no-wmic] FAIL — ${violations.length} wmic invocation(s) in shipped bundle:`);
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    process.exit(1);
  }

  console.log(`[assert-no-wmic] OK — scanned ${scanned} @blackbelt-technology file(s), zero wmic invocations.`);
}

main();
