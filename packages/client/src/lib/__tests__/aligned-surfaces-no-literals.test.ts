/**
 * Source-layer gates for the aligned action surfaces (test-plan E3 + E5).
 *
 * E3 — no raw colour literal: accent colour on these surfaces comes from
 *   `--tint-*`, `--severity-*` or `--status-*` tokens, never a Tailwind palette
 *   class (`text-green-400`, `bg-blue-500/10`, …), a hex literal or `rgba(`.
 *   Those literals measured 1.12–2.99:1 in the light theme.
 * E5 — `--text-muted` only for decoration: it fails AA as readable text, so
 *   every use must be a `disabled:` variant (WCAG 1.4.3 exempts disabled
 *   controls) or sit on an element marked `aria-hidden="true"`.
 *
 * The scan walks the TypeScript AST, so comments never match: only string
 * literals and template-literal parts (class lists, `style` values, class
 * maps like `verdictCls`) are inspected. That is a superset of "inside
 * className/style" — a colour literal cannot hide in a helper constant.
 *
 * `OpenSpecBoardView.tsx` is in scope only for its new-session / create
 * controls (proposal "Surfaces"), so only those two source regions are read.
 *
 * See change: align-ui-with-theme-tokens (tasks 5.3, 5.5; design D7).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const PACKAGES = join(import.meta.dirname, "..", "..", "..", "..");
const CLIENT = join(PACKAGES, "client", "src", "components");
// The shared UI kits, now scanned too (change: align-ui-contract-recipes, design D8).
const CLIENT_UTILS = join(PACKAGES, "client-utils", "src");
const RUNTIME = join(PACKAGES, "dashboard-plugin-runtime", "src");

/** The spec's surface list (message-severity-tokens "No raw colour literals …"). */
const SURFACES: readonly string[] = [
  join(CLIENT, "folder", "FolderSpawnButtons.tsx"),
  join(CLIENT, "session", "DashboardSpawnButtons.tsx"),
  join(CLIENT, "session", "SessionCard.tsx"),
  join(CLIENT, "worktree", "WorktreeSpawnDialog.tsx"),
  join(CLIENT, "worktree", "WorktreeList.tsx"),
  join(CLIENT, "interactive-renderers", "ConfirmRenderer.tsx"),
  join(CLIENT, "interactive-renderers", "SelectRenderer.tsx"),
  join(PACKAGES, "goal-plugin", "src", "client", "GoalDetailClaim.tsx"),
  join(PACKAGES, "automation-plugin", "src", "client", "CreateAutomationDialog.tsx"),
  // The shared recipes and the surfaces migrated onto them (align-ui-contract-recipes D8).
  join(CLIENT_UTILS, "StatusPill.tsx"),
  join(CLIENT_UTILS, "Dialog.tsx"),
  join(RUNTIME, "settings-fields.tsx"),
  join(CLIENT, "session", "SessionActionsPanel.tsx"),
  join(CLIENT, "settings", "ProviderHealthPill.tsx"),
  join(CLIENT, "packages", "plugin-row-parts.tsx"),
  join(CLIENT, "settings", "services", "services-ui.tsx"),
  join(CLIENT, "settings", "vault", "vault-ui.tsx"),
  join(CLIENT, "settings", "vault", "OperateRequiredCallout.tsx"),
];
/** `SettingsPanel.tsx` is in scope for its rail block only (the rest holds pre-existing literals). */
const SETTINGS_PANEL = join(CLIENT, "settings", "SettingsPanel.tsx");
const BOARD = join(CLIENT, "openspec", "OpenSpecBoardView.tsx");

/** One regex shared by spec, design D7 and this test. */
const PALETTE = /\b(text|bg|border|ring|outline|divide|shadow|from|via|to)-(green|orange|blue|yellow|indigo|red|amber|purple|emerald|sky)-\d/;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGBA = /rgba\(/;

interface Lit {
  file: string;
  line: number;
  text: string;
  /** `aria-hidden="true"` on the JSX element whose attribute holds this literal. */
  ariaHidden: boolean;
}

function isAriaHiddenElement(attrs: ts.JsxAttributes): boolean {
  return attrs.properties.some(
    (p) =>
      ts.isJsxAttribute(p) &&
      p.name.getText() === "aria-hidden" &&
      p.initializer !== undefined &&
      /^(\{?\s*)?["']?true["']?(\s*\})?$/.test(p.initializer.getText().replace(/[{}]/g, "")),
  );
}

/** Every string/template literal in `src[start, end)`, with its JSX aria-hidden context. */
function literals(file: string, src: string, start = 0, end = src.length): Lit[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Lit[] = [];
  const visit = (node: ts.Node): void => {
    const pos = node.getStart(sf);
    if (
      pos >= start &&
      pos < end &&
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node))
    ) {
      let ariaHidden = false;
      for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
        if (ts.isJsxAttributes(p)) {
          ariaHidden = isAriaHiddenElement(p);
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

function boardRegions(src: string): Array<[number, number]> {
  const actionsStart = src.indexOf("{/* Card actions");
  const actionsEnd = src.indexOf("// ── Session row", actionsStart);
  const dialogStart = src.indexOf("function NewProposalDialog");
  expect(actionsStart, "OpenSpecBoardView card-actions marker").toBeGreaterThan(0);
  expect(actionsEnd, "OpenSpecBoardView session-row marker").toBeGreaterThan(actionsStart);
  expect(dialogStart, "OpenSpecBoardView NewProposalDialog").toBeGreaterThan(0);
  return [
    [actionsStart, actionsEnd],
    [dialogStart, src.length],
  ];
}

/** The `<nav data-testid="settings-nav-rail">` block of SettingsPanel.tsx, up to the page content. */
function railRegion(src: string): [number, number] {
  const start = src.indexOf('data-testid="settings-nav-rail"');
  const end = src.indexOf("{/* Page content.", start);
  expect(start, "SettingsPanel settings-nav-rail marker").toBeGreaterThan(0);
  expect(end, "SettingsPanel page-content marker").toBeGreaterThan(start);
  return [start, end];
}

function allLiterals(): Lit[] {
  const out: Lit[] = [];
  for (const f of SURFACES) out.push(...literals(f, readFileSync(f, "utf8")));
  const board = readFileSync(BOARD, "utf8");
  for (const [s, e] of boardRegions(board)) out.push(...literals(BOARD, board, s, e));
  const panel = readFileSync(SETTINGS_PANEL, "utf8");
  const [rs, re] = railRegion(panel);
  out.push(...literals(SETTINGS_PANEL, panel, rs, re));
  return out;
}

/** The E3 rule, shared by the scan and its self-test. */
const colourHits = (lits: Lit[]): string[] =>
  lits.filter((l) => PALETTE.test(l.text) || HEX.test(l.text) || RGBA.test(l.text)).map((l) => `${rel(l.file)}:${l.line} ${JSON.stringify(l.text.slice(0, 120))}`);

const rel = (f: string) => f.slice(PACKAGES.length + 1);

/**
 * @structural-pin style lint over the aligned action surfaces: no raw colour literal and no --text-muted token; token usage is not observable in jsdom
 */
describe("aligned action surfaces — source gates", () => {
  const lits = allLiterals();

  it("scans a non-trivial number of literals (anti-vacuity)", () => {
    // Every surface file contributes; a broken path or empty region would
    // silently shrink this to ~0 and pass the gates below vacuously.
    for (const f of [...SURFACES, BOARD, SETTINGS_PANEL]) {
      expect(lits.some((l) => l.file === f), `no literals read from ${rel(f)}`).toBe(true);
    }
    expect(lits.length).toBeGreaterThan(300);
  });

  it("E3: no palette class, hex or rgba( colour literal", () => {
    expect(colourHits(lits)).toEqual([]);
  });

  // test-plan #E13 (align-ui-contract-recipes): the scan really bites on the shared files.
  it("E13: the shared dialog and the kit are on the list", () => {
    const scanned = new Set(lits.map((l) => rel(l.file)));
    for (const f of ["client-utils/src/Dialog.tsx", "client-utils/src/StatusPill.tsx", "dashboard-plugin-runtime/src/settings-fields.tsx"]) {
      expect(scanned.has(f), `${f} is not scanned`).toBe(true);
    }
  });

  it("E13: a copy of Dialog.tsx with bg-red-600 reintroduced fails, naming the file", () => {
    const file = join(CLIENT_UTILS, "Dialog.tsx");
    const mutated = readFileSync(file, "utf8").replace("bg-[var(--tint-red-bg)]", "bg-red-600");
    expect(mutated).toContain("bg-red-600");
    const hits = colourHits(literals(file, mutated));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.join("\n")).toContain("client-utils/src/Dialog.tsx");
  });

  it("E13: the settings rail block is scanned (a raw palette class there is caught)", () => {
    const panel = readFileSync(SETTINGS_PANEL, "utf8");
    const mutated = panel.replace('data-testid="settings-nav-rail"', 'data-testid="settings-nav-rail" data-x="bg-amber-400"');
    const [rs, re] = railRegion(mutated);
    const hits = colourHits(literals(SETTINGS_PANEL, mutated, rs, re));
    expect(hits.join("\n")).toContain("SettingsPanel.tsx");
    expect(hits.join("\n")).toContain("bg-amber-400");
  });

  it("E5: --text-muted appears only as a disabled: variant or on an aria-hidden element", () => {
    const hits: string[] = [];
    for (const l of lits) {
      if (!l.text.includes("--text-muted")) continue;
      // Class tokens that reference the muted token.
      const tokens = l.text.split(/\s+/).filter((t) => t.includes("--text-muted"));
      const bad = tokens.filter((t) => !t.startsWith("disabled:"));
      if (bad.length > 0 && !l.ariaHidden) hits.push(`${rel(l.file)}:${l.line} ${bad.join(" ")}`);
    }
    expect(hits).toEqual([]);
  });

  it("E5 self-check: the aria-hidden detector recognises both JSX spellings", () => {
    const src = `const a = <span aria-hidden="true" className="text-[var(--text-muted)]">·</span>;
const b = <span aria-hidden className="x" />;
const c = <span aria-hidden={true} className="text-[var(--text-muted)]">·</span>;
const d = <span className="text-[var(--text-muted)]">t</span>;`;
    const found = literals("probe.tsx", src).filter((l) => l.text.includes("--text-muted"));
    expect(found.map((l) => l.ariaHidden)).toEqual([true, true, false]);
  });
});

// E11 — retired tokens and shapes in the flow agent card
// (change: consolidate-flow-agent-cards). The card's secondary text uses
// `--text-tertiary`; the `&nbsp;` pad rows and the `‹› <absolute path>` line
// are gone, and the path is reduced to a basename. A raw source scan is
// deliberate here: the `&nbsp;` shape lives in JSX text, which the AST-literal
// walker above cannot see.
describe("flow agent card — retired token and shape gate (E11)", () => {
  const CARD = join(PACKAGES, "flows-plugin", "src", "client", "FlowAgentCard.tsx");
  const src = readFileSync(CARD, "utf8");

  it("scans a non-empty source (anti-vacuity)", () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain("FlowAgentCard");
  });

  it("no --text-muted / text-muted token", () => {
    expect(src).not.toContain("--text-muted");
    expect(src).not.toContain("text-muted");
  });

  it("no non-breaking-space placeholder literal", () => {
    expect(src).not.toContain("&nbsp;");
    expect(src).not.toContain("\u00a0");
  });

  it("no chevron-pair path literal", () => {
    expect(src).not.toContain("‹›");
  });
});
