/**
 * Source-layer gate for the folder-card / session-card pill surfaces
 * (theme-system "Card pill surfaces SHALL NOT paint raw colour", test-plan #E7).
 *
 * Every string / template literal of the listed files (AST, so comments never
 * match) is scanned for a raw Tailwind palette class, a hex literal, `rgba(` or
 * a `var(--token, <literal>)` fallback. `--text-muted` is allowed only on a
 * `disabled:` variant or an `aria-hidden` element. In `SessionList.tsx` only the
 * four pill regions are scanned — the rest of that file stays baselined.
 *
 * Deliberately NOT part of `aligned-surfaces-no-literals.test.ts`: that list
 * pulls in the 3:1 / 44 px floors (design D7).
 *
 * See change: fix-folder-card-pill-contrast (design D7, D8).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const PACKAGES = join(import.meta.dirname, "..", "..", "..", "..");
const CLIENT = join(PACKAGES, "client", "src", "components");
const SESSION_LIST = join(CLIENT, "session", "SessionList.tsx");

const FILES: readonly string[] = [
  join(CLIENT, "folder", "FolderActionBanner.tsx"),
  join(CLIENT, "worktree", "WorktreeInitButton.tsx"),
  join(CLIENT, "worktree", "WorktreeInitChip.tsx"),
  join(CLIENT, "worktree", "WorktreeInitStack.tsx"),
  join(PACKAGES, "dashboard-plugin-runtime", "src", "SlotPill.tsx"),
  join(PACKAGES, "automation-plugin", "src", "client", "FolderAutomationSection.tsx"),
  join(PACKAGES, "goal-plugin", "src", "client", "FolderGoalsSection.tsx"),
  join(PACKAGES, "mcp-client-plugin", "src", "client", "FolderMcpSection.tsx"),
  join(CLIENT, "openspec", "FolderOpenSpecSection.tsx"),
  join(CLIENT, "openspec", "OpenSpecActivityBadge.tsx"),
  join(CLIENT, "openspec", "openspec-helpers.tsx"),
  join(CLIENT, "openspec", "OpenSpecGroupPills.tsx"),
  join(PACKAGES, "flows-plugin", "src", "client", "FlowActivityBadge.tsx"),
];

/** Same shape as the theme-token-guard `rawPalette` arm (22 hues, numeric shade). */
const HUES = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PALETTE = new RegExp(
  `(?<![\\w-])(?:[^\\s"'\`:]+:)*(?:text|bg|border(?:-[trblxyse])?|ring(?:-offset)?|outline|divide|fill|stroke|from|via|to|placeholder|decoration|caret|accent|shadow)-(?:${HUES})-(?:50|[1-9]00|950)(?:/[\\w.\\[\\]]+)?(?![\\w-])`,
);
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGBA = /rgba\(/;
const FALLBACK = /var\(\s*--[a-z0-9-]+\s*,\s*(?!\s*var\()[^)]+\)/;

interface Lit {
  file: string;
  line: number;
  text: string;
  ariaHidden: boolean;
}

function ariaHiddenAttrs(attrs: ts.JsxAttributes): boolean {
  return attrs.properties.some(
    (p) =>
      ts.isJsxAttribute(p) &&
      p.name.getText() === "aria-hidden" &&
      p.initializer !== undefined &&
      /^["']?true["']?$/.test(p.initializer.getText().replace(/[{}\s]/g, "")),
  );
}

function literals(file: string, src: string, ranges?: Array<[number, number]>): Lit[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Lit[] = [];
  const inRange = (pos: number) => !ranges || ranges.some(([s, e]) => pos >= s && pos < e);
  const visit = (node: ts.Node): void => {
    const pos = node.getStart(sf);
    if (
      inRange(pos) &&
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node))
    ) {
      let ariaHidden = false;
      for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
        if (ts.isJsxAttributes(p)) {
          ariaHidden = ariaHiddenAttrs(p);
          break;
        }
        if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p) || ts.isFunctionLike(p)) break;
      }
      out.push({ file, line: sf.getLineAndCharacterOfPosition(pos).line + 1, text: node.text, ariaHidden });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The four SessionList pill regions, located structurally (not by line number). */
function sessionListRegions(src: string): Array<[number, number]> {
  const sf = ts.createSourceFile(SESSION_LIST, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Array<[number, number]> = [];
  const found = { toggle: false, addToWs: false, archive: false, pinned: false };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      if (node.name.text === "ToggleButton") {
        out.push([node.getStart(sf), node.getEnd()]);
        found.toggle = true;
      } else if (node.name.text === "renderAddToWorkspaceButton") {
        out.push([node.getStart(sf), node.getEnd()]);
        found.addToWs = true;
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attr = node.attributes.properties.find(
        (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "data-testid",
      );
      const val = attr?.initializer?.getText() ?? "";
      if (/"search-include-archive"/.test(val)) {
        out.push([node.getStart(sf), node.getEnd()]);
        found.archive = true;
      } else if (/folder-pinned-indicator-/.test(val)) {
        out.push([node.getStart(sf), node.getEnd()]);
        found.pinned = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  expect(found, "all four SessionList pill regions located").toEqual({ toggle: true, addToWs: true, archive: true, pinned: true });
  return out;
}

const rel = (f: string) => f.slice(PACKAGES.length + 1);
const colourHits = (lits: Lit[]): string[] =>
  lits
    .filter((l) => PALETTE.test(l.text) || HEX.test(l.text) || RGBA.test(l.text) || FALLBACK.test(l.text))
    .map((l) => `${rel(l.file)}:${l.line} ${JSON.stringify(l.text.slice(0, 120))}`);

function allLiterals(): Lit[] {
  const out: Lit[] = [];
  for (const f of FILES) out.push(...literals(f, readFileSync(f, "utf8")));
  const sl = readFileSync(SESSION_LIST, "utf8");
  out.push(...literals(SESSION_LIST, sl, sessionListRegions(sl)));
  return out;
}

/**
 * @structural-pin style lint over the card pill surfaces: no raw colour literal and no readable --text-muted; token usage is not observable in jsdom
 */
describe("card pill surfaces — source gates (#E7)", () => {
  const lits = allLiterals();

  it("reads literals from every listed file and the SessionList regions (anti-vacuity)", () => {
    for (const f of [...FILES, SESSION_LIST]) {
      expect(lits.some((l) => l.file === f), `no literals read from ${rel(f)}`).toBe(true);
    }
  });

  it("has no palette class, hex, rgba( or fallback literal", () => {
    expect(colourHits(lits)).toEqual([]);
  });

  it("uses --text-muted only on disabled: variants or aria-hidden elements", () => {
    const hits = lits
      .filter((l) => /text-muted/.test(l.text) && !l.ariaHidden && !/disabled:[^\s]*text-muted|disabled:text-\[var\(--text-muted\)\]/.test(l.text))
      .map((l) => `${rel(l.file)}:${l.line} ${JSON.stringify(l.text.slice(0, 120))}`);
    expect(hits).toEqual([]);
  });

  it("a planted text-amber-400 in a fixture copy fails naming the file", () => {
    const file = FILES[0];
    const mutated = `${readFileSync(file, "utf8")}\nconst planted = "text-amber-400";\n`;
    const hits = colourHits(literals(file, mutated));
    expect(hits.join("\n")).toContain("FolderActionBanner.tsx");
    expect(hits.join("\n")).toContain("text-amber-400");
  });
});
