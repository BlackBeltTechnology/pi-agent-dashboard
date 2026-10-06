// Inventory adapter: AngularJS 1.x + Vue 2 in an IE/HTA shell (Plantifier).
// Each pattern: kind, scope ("js" | "html" | "all"), global regex with a named group `name`.
// Adding a stack = writing another file with this shape (see ../README.md).

export const id = "angularjs-hta";
// Vendored third-party code is not part of the application UI.
export const vendor = /^(angular|jquery|d3|vue|context-menu|moment|emoji-flags|JSON\.prune|lodash|lib|node_modules|\.git)$/;
export const sources = [
  { dir: "js", re: /\.js$/ },
  { dir: "html", re: /\.html?$/ },
];

const reg = (method) => new RegExp(`\\.${method}\\(\\s*['"](?<name>[\\w$.-]+)['"]`, "g");

export const patterns = [
  { kind: "controller", scope: "all", re: reg("controller") },
  { kind: "directive", scope: "all", re: reg("directive") },
  { kind: "component", scope: "all", re: reg("component") },
  { kind: "factory", scope: "all", re: reg("factory") },
  { kind: "service", scope: "all", re: reg("service") },
  { kind: "vue-component", scope: "all", re: /Vue\.component\(\s*['"](?<name>[\w-]+)['"]/g },
  { kind: "ng-click", scope: "all", re: /ng-click\s*=\s*\\?["'](?<name>[^"'\\]*)/g },
  { kind: "ng-model", scope: "all", re: /ng-model\s*=\s*\\?["'](?<name>[^"'\\]*)/g },
  { kind: "v-model", scope: "all", re: /v-model(?:\.\w+)*\s*=\s*\\?["'](?<name>[^"'\\]*)/g },
  { kind: "v-click", scope: "all", re: /(?:@click|v-on:click)(?:\.\w+)*\s*=\s*\\?["'](?<name>[^"'\\]*)/g },
  { kind: "modal", scope: "js", re: /Modals\.(?<name>show|confirm|switch|prompt)\(/g },
  { kind: "modal", scope: "all", re: /(?<![\w.$])(?<name>angModal)\(\s*(?!headerTxt)/g }, // html/ang.htm:594 definition excluded
  { kind: "template-load", scope: "all", re: /(?:getFileContents|getTemp)\(\s*["'](?<name>html\/[\w./-]+)["']/g },
  { kind: "native-dialog", scope: "js", re: /(?<![\w.$])(?<name>alert|confirm|prompt|alertE)\(/g },
  { kind: "context-menu-item", scope: "js", re: /["']?(?<name>[\w-]+)["']?\s*:\s*\{\s*name\s*:/g },
  { kind: "opbar-action", scope: "js", re: /OpBar\.(?<name>\w+)\s*=\s*\{/g },
  { kind: "key-handler", scope: "js", re: /(?<name>keydown|keyup|keypress)\b/g },
];

/** Routes are generated from the `views` array in html/ang.htm (rp.when('/' + view, ...)). */
export function routes(files, read) {
  const out = files.filter((f) => /\.html?$/.test(f)).map((file) => ({ kind: "template", name: file, file, line: 1, text: "" }));
  for (const file of files.filter((f) => f.endsWith("ang.htm"))) {
    const src = read(file);
    const m = /var\s+views\s*=\s*\[([^\]]*)\]/.exec(src);
    if (!m) continue;
    const line = src.slice(0, m.index).split("\n").length;
    for (const v of m[1].match(/[\w-]+/g) ?? []) {
      const ctrl = `${v[0].toUpperCase()}${v.slice(1)}Controller`; // _.startCase for one-word views
      out.push({ kind: "route", name: `/${v}`, file, line, text: `template html/${v}.htm, controller ${ctrl}` });
    }
  }
  return out;
}

/** Native-dialog false positives: definitions and methods named alert/confirm/prompt. */
export function keep(row) {
  if (row.kind !== "native-dialog") return true;
  return !/function\s+(alert|confirm|prompt|alertE)\b|(alert|confirm|prompt|alertE)\s*:\s*function/.test(row.text);
}

/**
 * Effective configuration exactly as the app builds it, using the app's own vendored lodash
 * (so defaultsDeep semantics, incl. index-wise array merge, are identical):
 *   CONF = _.defaultsDeep(variant, conf/<cust>/conf-base-<cust>.json, conf/conf-base.json)   js/admin.js:25
 *   form = _.defaultsDeep(CONF.orders.add.settings, DEFAULT.orders.settings)                 js/order.js:137
 */
export async function effectiveConfig(appDir, variant, { vm, join, readText, lineAt }) {
  const ctx = vm.createContext({});
  vm.runInContext(readText(join(appDir, "js/lodash/lodash.js")), ctx);
  const _ = ctx._;
  const cust = variant.split("/")[1];
  const layers = [variant, `conf/${cust}/conf-base-${cust}.json`, "conf/conf-base.json"];
  const json = (f) => JSON.parse(readText(join(appDir, f)));
  const conf = _.defaultsDeep(...layers.map(json));

  const admin = readText(join(appDir, "js/admin.js"));
  const at = admin.indexOf("var DEFAULT = {");
  let depth = 0;
  let end = at + "var DEFAULT = ".length;
  for (let i = end; i < admin.length; i++) {
    if (admin[i] === "{") depth++;
    if (admin[i] === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  const DEFAULT = vm.runInContext(`(${admin.slice(at + "var DEFAULT = ".length, end)})`, ctx);
  const defaultsCite = `js/admin.js:${lineAt(admin, at)}-${lineAt(admin, end)}`;
  const form = _.defaultsDeep(_.cloneDeep(_.get(conf, "orders.add.settings", {})), DEFAULT.orders.settings);

  // Labels exactly as js/order.js:139-147: STR["orders_field_"+key] (+ "_short"), CONF.strings overrides (js/admin.js:36-44).
  vm.runInContext(readText(join(appDir, "js/strings.js")), ctx);
  const STR = _.cloneDeep(ctx._STR_);
  _.each(conf.strings, (strings, lang) => Object.assign((STR[lang] ??= {}), strings));
  const label = (lang, key) => STR[lang]?.[`orders_field_${key}`] ?? null;

  // Where each key is defined: one cite per layer (variant, customer base, conf-base, DEFAULT in admin.js).
  const sources = [...layers.map((f) => ({ file: f, from: 1, to: Infinity })), { file: "js/admin.js", from: lineAt(admin, at), to: lineAt(admin, end) }];
  const texts = Object.fromEntries(sources.map((s) => [s.file, readText(join(appDir, s.file)).split("\n")]));
  const definedIn = (key) =>
    sources.flatMap(({ file, from, to }) => {
      const i = texts[file].findIndex((l, n) => n + 1 >= from && n + 1 <= to && new RegExp(`^\\s*"${key}"\\s*:\\s*\\{`).test(l));
      return i < 0 ? [] : [`${file}:${i + 1}`];
    });
  const fields = Object.entries(JSON.parse(JSON.stringify(form))).map(([key, settings]) => ({
    key,
    label: { hu: label("hu", key), gb: label("gb", key) },
    definedIn: definedIn(key),
    settings,
  }));
  return {
    layers,
    defaultsCite,
    forms: { "orders.add": { merge: "js/order.js:137", render: "html/order.htm", labels: "js/order.js:139-147", fields } },
    conf: JSON.parse(JSON.stringify(conf)),
  };
}

/** Which fields each rendering of a config-driven form shows (verbatim predicates from the app). */
export const formViews = {
  "orders.add": [
    { id: "input", cite: "js/order.js:198-203", show: (o) => (o.display || o.default) && !o.computed && !o.fixed },
    { id: "table", cite: "js/order.js:205-210", show: (o) => (o.display || o.default || o.fixed) && !o.parent && !o.hide_from_table },
    { id: "filter", cite: "js/order.js:191-196", show: (o) => (o.display || o.default) && ((!o.computed && !o.fixed) || o.filterable) },
  ],
};

/** App field type -> OpenForms type (input rendering: html/order.htm:24-60, input_field_type js/order.js:497-516). */
export const typeMap = { text: "text", number: "number", unit: "number", date: "date", checkbox: "boolean", select: "dropdown" };

// ---------- style kit + screen plan hooks ----------

const VENDOR_CSS = /(^|\/)(js\/|selectize|select2|font-awesome)/;
/** App-owned stylesheets, in the order the shell links them (commented links excluded). */
export function styleSources(appDir, readText) {
  const html = readText(`${appDir}/html/ang.htm`).replace(/<!--[\s\S]*?-->/g, "");
  return [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']\.\.\/([^"']+\.css)["']/gi)].map((m) => m[1]).filter((f) => !VENDOR_CSS.test(f));
}
/** Third-party CSS the plan needs for fidelity (icon font); fonts are inlined by the plan generator. */
export function planAssets(appDir, readText) {
  const file = "css/font-awesome-4.5.0/css/font-awesome.min.css";
  // keep only the woff source so the inlined page stays small
  const css = readText(`${appDir}/${file}`).replace(/src:url\([^;]*;src:[^;]*;/, "src:url('../fonts/fontawesome-webfont.woff?v=4.5.0') format('woff');");
  return [{ file, css }];
}
/** Toolbar convention: `OpBar.<key>` gates a toolbar item; a controller enables it by assigning `OpBar.<key> =`. */
export const toolbar = { ref: /OpBar\.(\w+)/, assign: /OpBar\.(\w+)\s*=/ };
/** Shell: the toolbar (#header) lives in the entry page, around the ng-view slot. */
export const shell = { file: "html/ang.htm" };
/** Field repeats in templates -> form-record view. */
export const planViews = { availableInputs: "input", filterInputs: "filter", tableInputs: "table" };
/** UI strings: _STR_.hu from js/strings.js, overridden by CONF.strings.hu (as the app does). */
export function strings(appDir, conf, readText) {
  const src = readText(`${appDir}/js/strings.js`);
  const STR = new Function(`${src}\nreturn _STR_;`)();
  return { ...(STR.hu || {}), ...((conf?.strings?.hu) || {}) };
}
