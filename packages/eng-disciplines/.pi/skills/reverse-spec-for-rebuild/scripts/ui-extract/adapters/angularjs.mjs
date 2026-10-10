// Built-in adapter: AngularJS 1.x (stack level — no application knowledge).
// An application profile extends it: `export const parent = "angularjs"` in the project's own
// adapter file, overriding sources, patterns, routes, config, strings, toolbar and dialect keys.
// Each pattern: kind, scope ("js" | "html" | "all"), global regex with a named group `name`.

export const id = "angularjs";
/** Vendored third-party directories are not part of the application UI. */
export const vendor = /^(node_modules|bower_components|vendor|\.git)$/;
export const sources = [{ dir: ".", re: /\.(js|html?)$/ }];

const reg = (method) => new RegExp(`\\.${method}\\(\\s*['"](?<name>[\\w$.-]+)['"]`, "g");

export const patterns = [
  { kind: "controller", scope: "all", re: reg("controller") },
  { kind: "directive", scope: "all", re: reg("directive") },
  { kind: "component", scope: "all", re: reg("component") },
  { kind: "factory", scope: "all", re: reg("factory") },
  { kind: "service", scope: "all", re: reg("service") },
  { kind: "ng-click", scope: "all", re: /ng-click\s*=\s*\\?["'](?<name>[^"'\\]*)/g },
  { kind: "ng-model", scope: "all", re: /ng-model\s*=\s*\\?["'](?<name>[^"'\\]*)/g },
  { kind: "modal", scope: "js", re: /\$(?:uib)?[mM]odal\.(?<name>open)\(/g },
  { kind: "template-load", scope: "all", re: /templateUrl\s*:\s*["'](?<name>[\w./-]+)["']/g },
  { kind: "native-dialog", scope: "js", re: /(?<![\w.$])(?<name>alert|confirm|prompt)\(/g },
  { kind: "key-handler", scope: "js", re: /(?<name>keydown|keyup|keypress)\b/g },
];

/** Routes: `$routeProvider.when('/path', {...})` and ui-router `.state('name', {url: '/path', ...})`. */
export function routes(files, read) {
  const out = files.filter((f) => /\.html?$/.test(f)).map((file) => ({ kind: "template", name: file, file, line: 1, text: "" }));
  const lineOf = (src, i) => src.slice(0, i).split("\n").length;
  for (const file of files.filter((f) => f.endsWith(".js"))) {
    const src = read(file);
    for (const m of src.matchAll(/\.when\(\s*['"](\/[^'"]*)['"]\s*,\s*\{([^}]*)\}/g))
      out.push({ kind: "route", name: m[1], file, line: lineOf(src, m.index), text: m[2].replace(/\s+/g, " ").trim() });
    for (const m of src.matchAll(/\.state\(\s*['"]([\w.-]+)['"]\s*,\s*\{([^}]*)\}/g))
      out.push({ kind: "route", name: /url\s*:\s*['"]([^'"]+)['"]/.exec(m[2])?.[1] ?? m[1], file, line: lineOf(src, m.index), text: m[2].replace(/\s+/g, " ").trim() });
  }
  return out;
}

/** Native-dialog false positives: definitions and methods named alert/confirm/prompt. */
export function keep(row) {
  if (row.kind !== "native-dialog") return true;
  return !/function\s+(alert|confirm|prompt)\b|(alert|confirm|prompt)\s*:\s*function/.test(row.text);
}

/** HTML input type -> OpenForms type. */
export const typeMap = { text: "text", number: "number", date: "date", checkbox: "boolean", select: "dropdown" };
export const formViews = {};
export const planViews = {};

/** App-owned stylesheets linked from the entry page (`index.html`), vendor excluded. */
export function styleSources(appDir, readText) {
  let html;
  try {
    html = readText(`${appDir}/index.html`).replace(/<!--[\s\S]*?-->/g, "");
  } catch {
    return [];
  }
  return [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["'](?:\.\/)?([^"':]+\.css)["']/gi)].map((m) => m[1]).filter((f) => !/(^|\/)(node_modules|bower_components|vendor)\//.test(f));
}

/** AngularJS template dialect for screen plans (see screen-plan.mjs `dialectOf`). */
export const dialect = {
  interpolation: ["{{", "}}"],
  controlAttrs: ["ng-click", "ng-model", "ng-change"],
  refAttrs: ["ng-click", "ng-model", "ng-if"],
  labelAttrs: ["ng-click", "ng-model"],
  bindAttrs: ["ng-bind", "ng-bind-html"],
  condition: (a) => a["ng-if"] ?? a["ng-show"] ?? (a["ng-hide"] !== undefined ? `!(${a["ng-hide"]})` : null),
  repeat: (a) => a["ng-repeat"] ?? null,
  /** `(key, value) in list` -> list (a form-field repeat when `planViews[list]` names a form view). */
  repeatList: (r) => /^\s*\(\s*\w+\s*,\s*\w+\s*\)\s+in\s+(\w+)/.exec(r)?.[1] ?? null,
  repeatLabel: (r) => r.split("|")[0].trim(),
  switchValues: (a) => (a["ng-switch-when"] === undefined ? undefined : a["ng-switch-when"].split(a["ng-switch-when-separator"] || "\u0000")),
  /** `'key' | translate` (angular-translate) resolves through the adapter's string table. */
  exprText: (e, env, ctx) => {
    const t = /^['"]([^'"]+)['"]\s*\|\s*translate$/.exec(e);
    return t ? { text: ctx.strings[t[1]] ?? t[1] } : undefined;
  },
  decide: (c, env) => (c === "$last" ? env.fieldLast : c === "$first" ? env.fieldIndex === 0 : undefined),
};
