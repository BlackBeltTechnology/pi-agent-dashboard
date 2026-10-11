// Test fixture: an application profile over the built-in `angularjs` adapter (no imports needed).
export const parent = "angularjs";
export const id = "legacy-ng-fixture";
export const encoding = "windows-1250";
export const shell = { file: "html/ang.htm", toolbarId: "header" };
export const toolbar = { ref: /TB\.(\w+)/, assign: /TB\.(\w+)\s*=/ };
export const planViews = { availableInputs: "input", filterInputs: "filter", tableInputs: "table" };
export const styleSources = () => ["css/main.css"];
/** Config reads: `cfg.a.b` -> "a.b". */
export const configReads = /\bcfg((?:\.[A-Za-z_$][\w$]*)+)/g;
/** conf/<customer>/<name>.json; `demo-*` files are demo variants. */
export const variantInfo = (v) => ({ customer: v.split("/")[1], env: /\/demo-/.test(v) ? "demo" : "prod" });
/** String table: the first object literal of js/strings.js, `hu` branch. */
export function strings(appDir, conf, readText, { parseLiteralAt }) {
  const src = readText(`${appDir}/js/strings.js`);
  return parseLiteralAt(src, src.indexOf("{")).value.hu;
}
const CASE = { capitalize: (x) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase() };
export const dialect = {
  controlTags: ["ui-select"],
  selectTags: ["ui-select"],
  dropTags: ["ui-select-choices"],
  controlAttrs: ["ng-click", "ng-model", "ng-change", "on-select"],
  refAttrs: ["ng-click", "ng-model", "on-select", "ng-if"],
  exprText: (e, env, ctx) => {
    const s = e.match(/^(?:_\.(capitalize)\(\s*)?str\(\s*['"]([^'"]+)['"]\s*\)\s*\)?$/);
    if (s) return { text: (CASE[s[1]] ?? ((x) => x))(ctx.strings[s[2]] ?? s[2]) };
    if (env.field && /label\(\s*key\s*\)/.test(e)) return { text: env.field.label?.hu ?? env.field.key };
    if (env.field && /\[\s*key\s*\]/.test(e)) return { ph: env.field.key };
    return undefined;
  },
  decide: (c, env) => {
    if (c === "$last") return env.fieldLast;
    if (c === "$first") return env.fieldIndex === 0;
    const t = c.match(/^(?:val|col)\.type\s*===?\s*['"](\w+)['"]$/);
    return t ? env.field.type === t[1] : undefined;
  },
  classes: { view: "page", dialog: "dlg", dialogHeader: "dlg-h", dialogBody: "dlg-b", dialogFooter: "dlg-f", button: "button" },
  language: "hu",
};
