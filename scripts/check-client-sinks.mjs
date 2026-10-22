#!/usr/bin/env node
/**
 * Client sink guard.
 *
 * Fails when browser-side source contains a raw navigation or HTML / script
 * sink outside the allowlisted chokepoint and Trusted Types policy modules.
 * Navigation must go through `lib/nav/safe-navigation` (`SafeLink`,
 * `useSafeNavigation`, `openExternalUrl`), HTML / script URLs through a named
 * policy in `lib/security/trusted-types`.
 *
 * Comment- and string-aware: every file is parsed with the TypeScript
 * compiler, and only real AST nodes match, so a sink token inside a comment
 * or a string literal never fires.
 *
 * Rule sets (each switched on by its phase so CI stays green between phases):
 *   nav  · `window.open(`, `location.assign(` / `.replace(`, `location =`,
 *          `window.location =` / `document.location =`, `.href =`, `.src =`,
 *          `.action =`, `setAttribute("href"|"src"|"action", …)`, and a JSX
 *          `href={expr}` on an intrinsic `<a>` whose value is not a literal.
 *   html · `dangerouslySetInnerHTML`, `srcDoc`/`srcdoc`, `.innerHTML =`,
 *          `.outerHTML =`, `.srcdoc =`, `setAttribute("srcdoc", …)`,
 *          `insertAdjacentHTML(`, `document.write(`, `createContextualFragment(`,
 *          `setHTMLUnsafe(`, `eval(`, `new Function(`, `new Worker(`,
 *          `new SharedWorker(`, and an import of a key-lookup policy helper
 *          (`trustedStaticSvg`) outside its owner.
 *
 * Per-occurrence exemption — directly above the flagged line:
 *
 *   // client-sinks: allow — <reason>
 *
 * (or `{/* client-sinks: allow — <reason> *\/}` inside JSX). An annotation
 * without a reason is itself a violation.
 *
 * Scope: `packages/client/src`, `packages/client-utils/src`,
 * `packages/*-plugin/src/client`, `packages/dashboard-plugin-runtime/src`
 * (minus `src/server/**`) and `packages/team-app/src`. Test files are skipped.
 *
 *   node scripts/check-client-sinks.mjs [--rules nav,html] [--report] [root]
 *
 * Exit code: non-zero iff at least one violation.
 *
 * See change: harden-client-sinks (design D4).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";

export const REPO_ROOT = resolve(import.meta.dirname, "..");

export const RULE_SETS = ["nav", "html"];

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", "__tests__", "test-support", "__mocks__"]);
const SOURCE_FILE = /\.(tsx?|jsx?|mjs)$/;
const TEST_FILE = /\.(test|spec|stories)\.[cm]?[jt]sx?$|\.d\.ts$/;

/** Chokepoint and policy modules: the only places raw sinks may live. */
const FILE_ALLOWLIST = new Set([
  "packages/client/src/lib/nav/safe-navigation.ts",
  "packages/client/src/lib/nav/safe-navigation.tsx",
  "packages/client/src/lib/security/trusted-types.ts",
  "packages/dashboard-plugin-runtime/src/safe-navigation.tsx",
]);

/** Wrap-only policy helpers and the single module allowed to import each. */
const POLICY_HELPER_OWNERS = {
  trustedStaticSvg: (file) => file === "packages/team-app/src/ui/icons.tsx",
};

const ANNOTATION = /client-sinks:\s*allow\b(.*)$/;

const HINT_NAV_OPEN = "use openUrl() from useSafeNavigation() or openExternalUrl() (lib/nav/safe-navigation)";
const HINT_NAV_LOCATION = "use navigateTo() from useSafeNavigation() (lib/nav/safe-navigation)";
const HINT_NAV_PROP = "classify the target with classifyUrl() and annotate, or use SafeLink / useSafeNavigation()";
const HINT_NAV_JSX = "render <SafeLink href={…}> (lib/nav/safe-navigation)";
const HINT_HTML = "pass the value through a named Trusted Types policy (lib/security/trusted-types) and annotate";

/** Client-side source roots under `root`. */
function scanRoots(root) {
  const roots = [
    "packages/client/src",
    "packages/client-utils/src",
    "packages/dashboard-plugin-runtime/src",
    "packages/team-app/src",
  ];
  const pkgDir = join(root, "packages");
  if (existsSync(pkgDir)) {
    for (const e of readdirSync(pkgDir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name.endsWith("-plugin")) roots.push(`packages/${e.name}/src/client`);
    }
  }
  return roots.filter((r) => existsSync(join(root, r)));
}

function listSources(root) {
  const out = [];
  const walk = (abs) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const child = join(abs, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        const rel = relative(root, child).split(sep).join("/");
        if (rel === "packages/dashboard-plugin-runtime/src/server") continue;
        walk(child);
      } else if (e.isFile() && SOURCE_FILE.test(e.name) && !TEST_FILE.test(e.name)) {
        out.push(child);
      }
    }
  };
  for (const r of scanRoots(root)) walk(join(root, r));
  return out;
}

function scriptKind(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".ts")) return ts.ScriptKind.TS;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

const isIdent = (n, ...names) => n !== undefined && ts.isIdentifier(n) && names.includes(n.text);
const propName = (n) => (ts.isPropertyAccessExpression(n) ? n.name.text : undefined);
const isLiteralValue = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);
const isLocationRef = (n) => isIdent(n, "location") || propName(n) === "location";

/** Collect `{ruleSet, rule, hint, node}` hits for one source file. */
function findSinks(sf, file) {
  const hits = [];
  const hit = (ruleSet, rule, hint, node) => hits.push({ ruleSet, rule, hint, node });

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = propName(callee);
      const recv = ts.isPropertyAccessExpression(callee) ? callee.expression : undefined;
      if (name === "open" && isIdent(recv, "window", "globalThis", "self")) hit("nav", "window-open", HINT_NAV_OPEN, node);
      else if ((name === "assign" || name === "replace") && recv && isLocationRef(recv))
        hit("nav", `location-${name}`, HINT_NAV_LOCATION, node);
      else if (name === "setAttribute" && node.arguments[0] && isLiteralValue(node.arguments[0])) {
        const attr = node.arguments[0].text.toLowerCase();
        if (attr === "href" || attr === "src" || attr === "action") hit("nav", `setAttribute-${attr}`, HINT_NAV_PROP, node);
        else if (attr === "srcdoc") hit("html", "setAttribute-srcdoc", HINT_HTML, node);
      } else if ((name === "write" || name === "writeln") && recv && (isIdent(recv, "document") || propName(recv) === "document"))
        hit("html", "document-write", HINT_HTML, node);
      else if (name === "insertAdjacentHTML" || name === "createContextualFragment" || name === "setHTMLUnsafe")
        hit("html", name, HINT_HTML, node);
      else if (isIdent(callee, "eval")) hit("html", "eval", HINT_HTML, node);
    } else if (ts.isNewExpression(node)) {
      if (isIdent(node.expression, "Worker", "SharedWorker", "Function"))
        hit("html", `new-${node.expression.text}`, HINT_HTML, node);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const lhs = node.left;
      const name = propName(lhs);
      if (isIdent(lhs, "location")) hit("nav", "location-assignment", HINT_NAV_LOCATION, node);
      else if (name === "location") hit("nav", "location-assignment", HINT_NAV_LOCATION, node);
      else if (name === "href" || name === "src" || name === "action") hit("nav", `${name}-assignment`, HINT_NAV_PROP, node);
      else if (name === "innerHTML" || name === "outerHTML" || name === "srcdoc") hit("html", `${name}-assignment`, HINT_HTML, node);
    } else if (ts.isJsxAttribute(node)) {
      const attr = node.name.getText(sf);
      if (attr === "dangerouslySetInnerHTML" || attr === "srcDoc" || attr === "srcdoc") {
        hit("html", `jsx-${attr}`, HINT_HTML, node);
      } else if (attr === "href") {
        const el = node.parent?.parent; // JsxAttributes → opening / self-closing element
        const tag = el && (ts.isJsxOpeningElement(el) || ts.isJsxSelfClosingElement(el)) ? el.tagName : undefined;
        const init = node.initializer;
        const literal =
          init === undefined ||
          ts.isStringLiteral(init) ||
          (ts.isJsxExpression(init) && init.expression !== undefined && isLiteralValue(init.expression));
        if (isIdent(tag, "a") && !literal) hit("nav", "jsx-href", HINT_NAV_JSX, node);
      }
    } else if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const spec of node.importClause.namedBindings.elements) {
        const imported = (spec.propertyName ?? spec.name).text;
        const owner = POLICY_HELPER_OWNERS[imported];
        if (owner && !owner(file))
          hit("html", "policy-helper-import", `${imported} is a wrap-only policy helper; only its owning module may import it`, spec);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/**
 * Analyse every client-side source file under `root`. `ruleSets` selects the
 * active rule sets (default: all). Returns `{ files, violations }`.
 */
export function analyzeClientSinks(root = REPO_ROOT, { ruleSets = RULE_SETS } = {}) {
  const active = new Set(ruleSets);
  const violations = [];
  const files = listSources(root);
  for (const abs of files) {
    const file = relative(root, abs).split(sep).join("/");
    if (FILE_ALLOWLIST.has(file)) continue;
    const text = readFileSync(abs, "utf8");
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, scriptKind(abs));
    const lines = text.split("\n");
    const seen = new Set();
    for (const h of findSinks(sf, file)) {
      if (!active.has(h.ruleSet)) continue;
      const line = sf.getLineAndCharacterOfPosition(h.node.getStart(sf)).line + 1;
      const above = (lines[line - 2] ?? "").match(ANNOTATION);
      let rule = h.rule;
      if (above) {
        const reason = above[1].replace(/\*\/\s*\}?\s*$/, "").replace(/^[\s—–:-]+/, "").trim();
        if (reason) continue;
        rule = "annotation-missing-reason";
      }
      const dedupe = `${line}:${rule}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      violations.push({ file, line, rule, ruleSet: h.ruleSet, text: lines[line - 1].trim(), hint: h.hint });
    }
  }
  violations.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { files: files.length, violations };
}

function parseArgs(argv) {
  const opts = { ruleSets: RULE_SETS, report: false, root: REPO_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--report") opts.report = true;
    else if (a === "--rules") opts.ruleSets = argv[++i].split(",").filter(Boolean);
    else if (a.startsWith("--rules=")) opts.ruleSets = a.slice(8).split(",").filter(Boolean);
    else opts.root = resolve(a);
  }
  for (const r of opts.ruleSets) if (!RULE_SETS.includes(r)) throw new Error(`unknown rule set: ${r}`);
  return opts;
}

function main() {
  const { ruleSets, report, root } = parseArgs(process.argv.slice(2));
  const { files, violations } = analyzeClientSinks(root, { ruleSets });
  for (const v of violations) {
    console.error(`client-sink [${v.ruleSet}/${v.rule}] ${v.file}:${v.line}: ${v.text}\n    → ${v.hint}`);
  }
  if (report) {
    const byFile = new Map();
    for (const v of violations) byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
    console.log("\nInventory (file · count):");
    for (const [f, n] of byFile) console.log(`  ${f} · ${n}`);
  }
  const stream = violations.length > 0 ? console.error : console.log;
  stream(`\n${files} file(s) checked · rules ${ruleSets.join(",")} · ${violations.length} raw sink violation(s)`);
  process.exit(violations.length > 0 ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
