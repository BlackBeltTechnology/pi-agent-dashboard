/**
 * #E41 — supervised copy never claims isolation. Static scan of the user-facing
 * sources of the approval card, mode menu, Settings section, and this gate's own
 * strings: no match for /\bsandboxed\b|\bsafe\b|\bisolated\b|\bprotected\b/i, and
 * the phrase "not a sandbox" present once the UI files exist.
 *
 * The scan globs the paths later phases create (card / menu / Settings / i18n) and
 * tolerates a missing file — it fails only on a match — so it passes today and
 * covers the UI the day it lands. Comments are stripped first: they may discuss
 * the words the copy must not use.
 * See change: add-supervised-tool-approval (design D1; spec "Supervised mode is
 * approval-gating, not sandboxing").
 * @structural-pin copy-scan is a static scan of shipped UI/gate source text by design: user-facing strings must never claim isolation.
 */
import * as fs from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const ROOT = nodePath.resolve(here, "../../../../..");
const FORBIDDEN = /\bsandboxed\b|\bsafe\b|\bisolated\b|\bprotected\b/i;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

function listDir(rel: string): string[] {
  const abs = nodePath.join(ROOT, rel);
  try {
    return fs.readdirSync(abs).map((f) => nodePath.join(rel, f));
  } catch {
    return [];
  }
}

/** Every file of the supervised UI surface that exists right now. */
function uiFiles(): string[] {
  const nameHit = /supervis|toolapproval/i;
  const dirs = [
    "packages/client/src/components",
    "packages/client/src/components/interactive-renderers",
    "packages/client/src/components/settings",
    "packages/client/src/components/composer",
    "packages/client/src/components/chat",
  ];
  return dirs.flatMap((d) => listDir(d)).filter((f) => nameHit.test(nodePath.basename(f)) && /\.(tsx?|json)$/.test(f) && !/\.test\./.test(f));
}

function gateFiles(): string[] {
  return listDir("packages/extension/src/supervised-gate").filter((f) => f.endsWith(".ts"));
}

/** i18n entries about supervised mode (one line per key) — the files hold every other string too. */
function i18nLines(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const f of listDir("packages/client/src/lib/i18n").filter((x) => /i18n-.*\.ts$|i18n\.ts$/.test(x))) {
    const body = fs.readFileSync(nodePath.join(ROOT, f), "utf8");
    for (const line of body.split("\n")) if (/supervis|toolApproval/i.test(line)) out.push({ file: f, text: line });
  }
  return out;
}

describe("#E41 supervised copy claims no isolation", () => {
  it("scan predicate is not vacuous: the forbidden words match, comment stripping works", () => {
    for (const w of ["sandboxed", "safe", "isolated", "protected"]) expect(FORBIDDEN.test(`this is ${w} now`)).toBe(true);
    expect(FORBIDDEN.test("approval, not a sandbox")).toBe(false);
    expect(FORBIDDEN.test(stripComments("const a = 1; // safe\n/* isolated */ const b = 2;"))).toBe(false);
  });

  it("the gate's own strings (handler, summary, mode store, assembly) have no match", () => {
    const files = gateFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const body = stripComments(fs.readFileSync(nodePath.join(ROOT, f), "utf8"));
      expect(body, f).not.toMatch(FORBIDDEN);
    }
  });

  it("card, mode menu and Settings sources (when present) have no match and say `not a sandbox`", () => {
    const files = uiFiles();
    const bodies = files.map((f) => ({ f, body: stripComments(fs.readFileSync(nodePath.join(ROOT, f), "utf8")) }));
    for (const { f, body } of bodies) expect(body, f).not.toMatch(FORBIDDEN);
    for (const { file, text } of i18nLines()) expect(stripComments(text), `${file}: ${text}`).not.toMatch(FORBIDDEN);
    if (bodies.length > 0) {
      // once UI exists, the "approval, not a sandbox" framing must appear somewhere in it
      expect(bodies.some(({ body }) => /not a sandbox/i.test(body)) || i18nLines().some(({ text }) => /not a sandbox/i.test(text))).toBe(true);
    }
  });
});
