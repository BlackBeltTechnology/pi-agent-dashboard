#!/usr/bin/env node
/**
 * sync-claude-plugin.mjs — derive the Claude plugin's control-skill reference.
 *
 * `packages/claude-plugin/skills/pi-dashboard-control/references/api-reference.md`
 * is the extension skill's `api-reference.md` with its "WebSocket bus verbs"
 * section removed (heading through the next `---` rule) and no other change.
 * Fails (non-zero, naming the heading) when the heading is absent, so a renamed
 * source section cannot silently produce a no-op.
 *
 * Usage:
 *   node scripts/sync-claude-plugin.mjs [--source <file>] [--out <file>]
 *
 * See change: add-claude-code-plugin (design D7).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SECTION_HEADING = "## WebSocket bus verbs";
export const DEFAULT_SOURCE = path.join(
  REPO_ROOT,
  "packages/extension/.pi/skills/pi-dashboard/references/api-reference.md",
);
export const DEFAULT_OUT = path.join(
  REPO_ROOT,
  "packages/claude-plugin/skills/pi-dashboard-control/references/api-reference.md",
);

/**
 * Remove the "WebSocket bus verbs" section: from its heading through the next
 * `---` rule line and the blank line after it. Throws when the heading is absent.
 */
export function transformApiReference(source) {
  const start = source.indexOf(`${SECTION_HEADING}\n`);
  if (start === -1) {
    throw new Error(`heading "${SECTION_HEADING}" not found in the source reference`);
  }
  const rule = source.indexOf("\n---\n", start);
  if (rule === -1) {
    throw new Error(`no "---" rule follows the "${SECTION_HEADING}" section`);
  }
  let end = rule + "\n---\n".length;
  if (source[end] === "\n") end += 1;
  return source.slice(0, start) + source.slice(end);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : fallback;
}

function main() {
  const source = arg("--source", DEFAULT_SOURCE);
  const out = arg("--out", DEFAULT_OUT);
  let derived;
  try {
    derived = transformApiReference(fs.readFileSync(source, "utf8"));
  } catch (err) {
    console.error(`sync-claude-plugin: ${err.message}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, derived);
  console.log(`wrote ${path.relative(REPO_ROOT, out)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
