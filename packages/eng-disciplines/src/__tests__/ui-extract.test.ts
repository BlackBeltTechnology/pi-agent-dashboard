/**
 * reverse-spec-for-rebuild UI extraction: style kit + screen plan units, adapter profiles + dialect
 * and the CLI contract (adapter by name or path, optional hooks, unlinked-control gate).
 * See change: promote-ui-extraction.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SKILL } from "./files";

const UX = join(SKILL, "scripts", "ui-extract");
const load = async (f: string): Promise<any> => import(pathToFileURL(join(UX, f)).href);
const { parseHtml } = await load("lib-html.mjs");
const { buildKit } = await load("style-kit.mjs");
const { planPage, planScreen } = await load("screen-plan.mjs");
const { loadAdapter, decode, setLegacyEncoding } = await load("lib.mjs");
const PROFILE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "legacy-ng-profile.mjs");
const profile = await loadAdapter(PROFILE);
const TOOLBAR = { ref: /TB\.(\w+)/g, assign: /TB\.(\w+)\s*=/g };

describe("ui-extract units", () => {

  it("parseHtml keeps line numbers, void and self-closing elements", () => {
    const t = parseHtml('<div class="a">\n  <input ng-model="x">\n  <br />\n  <span>{{y}}</span>\n</div>');
    const div = t.children.find((n: any) => n.tag === "div");
    assert.equal(div.line, 1);
    const [input, br, span] = div.children.filter((n: any) => n.tag);
    assert.equal(input.tag, "input");
    assert.equal(input.line, 2);
    assert.equal(input.attrs["ng-model"], "x");
    assert.equal(br.tag, "br");
    assert.equal(span.line, 4);
    assert.equal(span.children[0].text, "{{y}}");
  });

  const CSS = {
    "css/main.css": "html { font-family: Calibri; color: #333; }\n.button { background: #3194FF; border: 1px solid #fff; }\n/* .gone { color: red } */\n.op-bar-elem { color: rgb(51, 51, 51); }\n",
    "css/order.css": "@media print { .orders { color: #333 } }\n.orders .newline { background-color: white; }\n",
  };

  it("buildKit tokenizes colours, keeps layout rules, extracts mapped components with cites", () => {
    const kit = buildKit(CSS, { components: { button: [".button"], "toolbar-item": [".op-bar-elem"] } });
    // #333 and rgb(51,51,51) are one colour token; white -> #ffffff
    const c333 = kit.tokens.color.find((t: any) => t.value === "#333333");
    assert.equal(c333.uses, 3);
    const twice = buildKit({ "css/a.css": ".x { color: #fff; border: 1px solid #fff; }" }, {});
    assert.deepEqual(twice.tokens.color[0].cites, ["css/a.css:1"], "a rule using a colour twice is cited once");
    assert.equal(twice.tokens.color[0].uses, 2);
    assert.ok(kit.tokens.color.some((t: any) => t.value === "#ffffff" && t.uses === 2));
    assert.equal(kit.tokens.font[0].value, "Calibri");
    assert.ok(!kit.css.includes("#3194FF"), "literal colours replaced by variables");
    assert.match(kit.css, /\.button \{ background: var\(--sk-c-3194ff\);/);
    assert.match(kit.css, /@media print \{/);
    assert.ok(!kit.css.includes(".gone"), "commented rules dropped");
    assert.equal(kit.components.button[0].cite, "css/main.css:2");
    assert.match(kit.css, /\.sk-button \{ background: var\(--sk-c-3194ff\);/);
    assert.match(kit.css, /--sk-font-base: var\(--sk-font-1\);/, "alias references the token, so re-theming the token reaches it");
  });

  it("buildKit drops invalid declarations (no colon) instead of emitting broken CSS", () => {
    const kit = buildKit({ "css/plan.css": ".event:before { font-family: FontAwesome; //, 'Segoe UI Emoji';\n color: #555566; }\n.after { color: red; }" }, {});
    assert.match(kit.css, /\.event:before \{ font-family: var\(--sk-font-1\); color: var\(--sk-c-555566\); \}/);
    assert.ok(!kit.css.includes("Segoe"), "bogus // declaration dropped");
    assert.match(kit.css, /\.after \{ color: var\(--sk-c-ff0000\); \}/);
  });

  it("buildKit refuses a component selector that is not in the CSS", () => {
    assert.throws(() => buildKit(CSS, { components: { tab: [".nav-tab"] } }), /tab: selector \.nav-tab not found/);
  });

  const TEMPLATE = `<div class="orders">
    <div class="rendElem" ng-repeat="(key, col) in availableInputs" ng-switch="input_field_type(line, key, col)">
      <label>{{longer_field_label(key)}}</label>
      <input ng-switch-when="date" class="input" ng-model="line[key]">
      <input ng-switch-when="text|unit" ng-switch-when-separator="|" class="input" ng-model="line[key]">
    </div>
    <button class="button" ng-click="addOrder(line)">{{str('Add_order')}}</button>
    <a ng-click="mystery()">?</a>
    {{_.capitalize(str('save'))}} <input ng-model="note">
    <tr ng-repeat="line in orderlines"><td>{{line.x}}</td></tr>
  </div>`;
  const SHELL = `<div id="header">
    <span class="op-bar-elem product" ng-click="about()">App</span>
    <span class="op-bar-elem" ng-if="TB.save || TB.lock"><button ng-if="TB.save" ng-click="TB.save.save()">{{str('save')}}</button>
    <button ng-if="TB.test && TB.test.failed" ng-click="TB.test.fixAll()">fix</button></span>
    <span class="op-bar-elem" ng-if="TB.import"><button ng-click="TB.import()">imp</button></span>
  </div>`;
  const ctx = (): any => ({
    templateFile: "html/order.htm",
    template: TEMPLATE,
    shellFile: "html/ang.htm",
    shell: SHELL,
    shellToolbarId: "header",
    dialect: profile.dialect,
    strings: { Add_order: "Felvétel", save: "Mentés" },
    toolbar: TOOLBAR,
    toolbarKeys: { save: "ACT-save" },
    form: {
      fields: [
        { key: "ordernum", type: "text", label: { hu: "SAP azon." }, views: ["input"] },
        { key: "deadline", type: "date", label: { hu: "Határidő" }, views: ["input"] },
        { key: "status", type: "text", label: { hu: "Állapot" }, views: ["table"] },
      ],
    },
    formViews: { availableInputs: "input", filterInputs: "filter", tableInputs: "table" },
    screen: {
      id: "SCR-x",
      actions: [{ id: "ACT-add", label: "Add", covers: ["html/order.htm:7"], guards: ["BR-1"], effects: [{ step: "Store order" }] }],
      unmapped: [{ at: "html/order.htm:4", reason: "config-driven date input" }, { at: "html/order.htm:5", reason: "config-driven text input" }],
      dialogs: [],
      fields: [{ key: "note", cite: "html/order.htm:9; js/x.js:1" }],
    },
  });

  it("planScreen expands field repeats with the matching switch branch, resolves labels, filters the toolbar", () => {
    const p = planScreen(ctx());
    // one rendElem per input-view field, in form order; date field gets the date branch only
    assert.equal((p.html.match(/class="rendElem/g) || []).length, 2);
    assert.match(p.html, /SAP azon\.[\s\S]*Határidő/);
    assert.ok(!p.html.includes("Állapot"), "table-only field not in the input view");
    assert.ok(!p.html.includes("ng-"), "angular attributes stripped");
    assert.match(p.html, /Felvétel/);
    assert.match(p.html, /Mentés/);
    assert.match(p.html, /Mentés <span class="pl-n"[^>]*>\d+<\/span><input/, "str() inside a lodash wrapper resolves too");
    assert.ok(!p.html.includes(">fix<") && !p.html.includes(">imp<"), "toolbar items of keys the screen does not set are dropped");
    assert.match(p.html, /pl-repeat/, "non-field repeat marked as repeated");
  });

  it("planScreen keeps entities, decides $last/$first/type conjuncts per field, shows non-bindable bindings as placeholders", () => {
    const c = ctx();
    c.template = `<div class="orders">
    <table><tr ng-repeat="line in orderlines"><td ng-repeat="(key, val) in tableInputs">
      <span ng-if="val.type == 'unit' && line[key]">unit</span>
      <div ng-if="$last && line.isMod"><div class="button" ng-click="modOrder()">OK</div></div>
      <b ng-if="$first">first</b>
    </td></tr></table>
    <span>&nbsp;per page</span><span ng-non-bindable>{{VERSION}}</span>
  </div>`;
    c.form.fields = [
      { key: "a", type: "text", label: { hu: "A" }, views: ["table"] },
      { key: "q", type: "unit", label: { hu: "Q" }, views: ["table"] },
      { key: "z", type: "date", label: { hu: "Z" }, views: ["table"] },
    ];
    c.screen.actions.push({ id: "ACT-mod", label: "mod", covers: ["html/order.htm:4"] });
    const p = planScreen(c);
    assert.equal((p.html.match(/>unit</g) || []).length, 1, "type conjunct: only the unit field");
    assert.equal((p.html.match(/>OK</g) || []).length, 1, "$last: only the last field");
    assert.equal((p.html.match(/>first</g) || []).length, 1, "$first: only the first field");
    assert.match(p.html, /&nbsp;per page/);
    assert.ok(!p.html.includes("&amp;nbsp;"));
    assert.match(p.html, /‹VERSION›/);
  });

  it("planScreen numbers controls and links them to actions, unmapped reasons and toolbar keys", () => {
    const p = planScreen(ctx());
    const byLine = Object.fromEntries(p.controls.map((c: any) => [c.at, c]));
    assert.equal(byLine["html/order.htm:7"].target.action, "ACT-add");
    assert.equal(byLine["html/order.htm:4"].target.unmapped, "config-driven date input");
    assert.equal(byLine["html/ang.htm:3"].target.action, "ACT-save");
    // shell controls not bound to this screen's toolbar keys belong to the app shell, not to the screen
    assert.equal(byLine["html/ang.htm:2"].target.shell, true);
    // template fields recorded on the screen link by cite
    assert.equal(byLine["html/order.htm:9"].target.field, "SCR-x#note");
    assert.deepEqual(p.unlinked.map((c: any) => c.at), ["html/order.htm:8"]);
    // one callout per source line even when a repeat renders the line twice
    assert.equal(p.controls.filter((c: any) => c.at === "html/order.htm:5").length, 1);
    assert.match(p.html, /data-pl="\d+"/);
  });

  it("ng-bind keeps the element's static initial text; plan page adds a generic fallback to kit fonts", () => {
    const c = ctx();
    c.template = `<div><span ng-bind="lock.msg">{{str('save')}}</span><span ng-bind="other.msg"></span></div>`;
    const p = planScreen(c);
    assert.match(p.html, /<span>Mentés<\/span>/);
    assert.match(p.html, /‹other\.msg›/);
    const page = planPage(p, { ...c, kitFonts: [{ name: "--sk-font-1", value: "Calibri" }, { name: "--sk-font-2", value: "Arial, sans-serif" }] }, ":root{}");
    assert.match(page, /--sk-font-1: Calibri, Carlito, "Segoe UI", sans-serif;/);
    assert.ok(!page.includes("--sk-font-2: Arial, sans-serif, "), "stacks that already end in a generic family stay");
    const kw = planPage(p, { ...c, kitFonts: [{ name: "--sk-font-7", value: "inherit" }] }, ":root{}");
    assert.ok(!kw.includes("inherit, Carlito"), "CSS-wide keywords are not stacks");
    c.kitClasses = { "op-button": "sk-tb", notificationIcons: "sk-tb" };
    c.template = `<div><button class="notificationIcons op-button" ng-click="x()">b</button></div>`;
    assert.equal((planScreen(c).html.match(/sk-tb/g) || []).length, 1, "kit class added once");
  });

  it("dialog messages from the app string table are escaped in the plan", () => {
    const c = ctx();
    c.strings.boom = '<img src=x onerror="alert(1)">';
    c.screen.dialogs = [{ id: "DLG-x", kind: "alert", message: "boom extra", from: null }];
    const p = planScreen(c);
    expect(p.dialogs).toContain("DLG-x");
    expect(p.dialogs).not.toContain("<img src=x");
    expect(p.dialogs).toContain("&lt;img src=x");
  });

  it("without a toolbar hook no toolbar control is filtered", () => {
    const c = ctx();
    delete (c as any).toolbar;
    const p = planScreen(c);
    assert.ok(p.html.includes(">fix<") && p.html.includes(">imp<"));
  });
});

const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe("ui-extract CLI", () => {
  let dir: string;
  let app: string;
  let pkg: string;
  const put = (root: string, rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "uix-"));
    app = join(dir, "app");
    pkg = join(dir, "pkg");
    put(app, "html/ang.htm", `<html><head><link rel="stylesheet" href="../css/main.css"></head><body>
<div id="header"><span class="op-bar-elem" ng-if="TB.save"><button ng-click="TB.save.save()">{{str('save')}}</button></span></div>
<div ng-view></div></body></html>`);
    put(app, "css/main.css", "html { font-family: Calibri; }\n.button { color: #3194FF; }\n#header { background: #222; }\n");
    put(app, "css/font-awesome-4.5.0/css/font-awesome.min.css", ".fa{display:inline-block}");
    put(app, "js/strings.js", "var _STR_ = { hu: { save: 'Mentés', add: 'Felvétel' } };\n");
    put(app, "js/a.js", "function A($rootScope) {\n  $rootScope.TB.save = { save: save };\n}\n");
    put(app, "index.html", `<html><head><link rel="stylesheet" href="css/main.css"></head></html>`);
    put(app, "html/a.htm", `<div>\n  <button class="button" ng-click="add()">{{str('add')}}</button>\n  <a ng-click="ghost()" onclick="ghost()">?</a>\n</div>\n`);
    put(pkg, "ui/screens/SCR-a.json", JSON.stringify({
      id: "SCR-a", template: "html/a.htm", dialogs: [], fields: [],
      actions: [
        { id: "ACT-add", label: "add", trigger: { kind: "click", cite: "html/a.htm:2" } },
        { id: "ACT-save", label: "save", trigger: { kind: "toolbar", cite: "js/a.js:2" } },
      ],
      unmapped: [{ at: "html/a.htm:3", reason: "debug link" }],
    }));
    put(dir, "job.json", JSON.stringify({ components: { button: [".button"], toolbar: ["#header"] } }));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("style kit + plan: built-in adapter name and the same adapter by path give identical output; a profile plans", () => {
    const builtin = join(UX, "adapters", "angularjs.mjs");
    for (const [adapter, out] of [["angularjs", "k1"], [builtin, "k2"]]) {
      const r = run(join(UX, "style-kit.mjs"), app, adapter, join(dir, "job.json"), join(dir, out));
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
    }
    expect(readFileSync(join(dir, "k2", "style-kit.css"), "utf8")).toBe(readFileSync(join(dir, "k1", "style-kit.css"), "utf8"));
    put(pkg, "ui/style-kit.json", readFileSync(join(dir, "k1", "style-kit.json"), "utf8"));
    put(pkg, "ui/style-kit.css", readFileSync(join(dir, "k1", "style-kit.css"), "utf8"));
    const r = run(join(UX, "screen-plan.mjs"), app, PROFILE, pkg, "SCR-a");
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("SCR-a: 3 controls, 0 unlinked");
    const html = readFileSync(join(pkg, "ui", "plans", "SCR-a.html"), "utf8");
    expect(html).toContain("Felvétel");
    expect(html).toContain("ACT-save");
  });

  it("config.mjs hands profiles a guarded defaultsDeep and no vm", () => {
    put(dir, "cfg-profile.mjs", `export const id = "cfg";
export async function effectiveConfig(appDir, variant, h) {
  const merged = h.defaultsDeep({ a: [1], n: null }, { a: [2, 3], b: { c: 1 }, n: { x: 1 } }, JSON.parse('{"__proto__": {"polluted": 1}, "constructor": {"prototype": {"p2": 1}}}'));
  return { forms: {}, helpers: Object.keys(h).sort(), merged, polluted: ({}).polluted ?? null, p2: ({}).p2 ?? null };
}
`);
    const out = join(dir, "cfg-out.json");
    const r = run(join(UX, "config.mjs"), app, join(dir, "cfg-profile.mjs"), "conf/v.json", out);
    expect(r.stderr).toBe("");
    const res = JSON.parse(readFileSync(out, "utf8"));
    expect(res.helpers).toEqual(["defaultsDeep", "join", "lineAt", "parseLiteralAt", "readText"]);
    expect(res.merged).toEqual({ a: [1, 3], n: null, b: { c: 1 } });
    expect(res.polluted).toBeNull();
    expect(res.p2).toBeNull();
  });

  it("a project adapter by path needs no optional hooks; an unlinked control exits 1 naming it", () => {
    put(dir, "my-adapter.mjs", `export const id = "mine";
export const styleSources = () => ["css/main.css"];
export const shell = { file: "html/ang.htm" };
export const planViews = {};
`);
    const r = run(join(UX, "screen-plan.mjs"), app, join(dir, "my-adapter.mjs"), pkg, "SCR-a");
    // no toolbar hook: the shell save button is not mapped through TB keys -> app shell; no strings hook: ‹placeholders›
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const s = JSON.parse(readFileSync(join(pkg, "ui/screens/SCR-a.json"), "utf8"));
    s.unmapped = [];
    put(pkg, "ui/screens/SCR-a.json", JSON.stringify(s));
    const bad = run(join(UX, "screen-plan.mjs"), app, join(dir, "my-adapter.mjs"), pkg, "SCR-a");
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/SCR-a: unlinked control \d+ at html\/a\.htm:3/);
  });

  it("gate: trigger kinds come from the stack-neutral vocabulary (no framework or app names)", () => {
    const g = join(dir, "gpkg");
    put(g, "ui/_inventory.json", JSON.stringify({ rows: [] }));
    const rec = (kind: string) =>
      put(g, "ui/screens/SCR-g.json", JSON.stringify({ id: "SCR-g", kind: "route", name: "g", template: "html/a.htm", scope: [], actions: [{ id: "ACT-g", label: "g", trigger: { kind, cite: "html/a.htm:2" } }] }));
    for (const bad of ["ng-click", "opbar", "v-click"]) {
      rec(bad);
      const r = run(join(UX, "gate.mjs"), app, g);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain(`trigger kind '${bad}' is not in the vocabulary`);
    }
    for (const ok of ["click", "toolbar", "change", "context-menu", "dblclick"]) {
      rec(ok);
      expect(run(join(UX, "gate.mjs"), app, g).stdout).toContain("PASS 1 record(s)");
    }
  });

  it("config-reads: code reads of config paths (comments ignored) + variants classified by the profile", () => {
    put(app, "js/cfgread.js", "if (cfg.orders.unique) x();\n// cfg.commented.out\nvar n = cfg.planner.mode, m = cfg.orders.unique;\n");
    put(pkg, "ui/_effective/A--prod.json", JSON.stringify({ variant: "conf/A/prod.json", conf: {} }));
    put(pkg, "ui/_effective/A--demo.json", JSON.stringify({ variant: "conf/A/demo-1.json", conf: {} }));
    const r = run(join(UX, "config-reads.mjs"), app, PROFILE, pkg);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const o = JSON.parse(readFileSync(join(pkg, "ui", "_config-reads.json"), "utf8"));
    expect(o.reads).toEqual([
      { path: "orders.unique", cites: ["js/cfgread.js:1", "js/cfgread.js:3"] },
      { path: "planner.mode", cites: ["js/cfgread.js:3"] },
    ]);
    expect(o.variants).toEqual([
      { id: "A--demo", variant: "conf/A/demo-1.json", customer: "A", env: "demo" },
      { id: "A--prod", variant: "conf/A/prod.json", customer: "A", env: "prod" },
    ]);
    put(dir, "nohook.mjs", 'export const id = "n"; export const sources = [{ dir: "js", re: /\\.js$/ }]; export const vendor = /^x$/;');
    const bad = run(join(UX, "config-reads.mjs"), app, join(dir, "nohook.mjs"), pkg);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("adapter has no configReads hook");
  });

  it("an unknown adapter name is refused with usage, not a stack trace", () => {
    const r = run(join(UX, "style-kit.mjs"), app, "nope", join(dir, "job.json"), join(dir, "k3"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown adapter nope");
  });
});

describe("adapter profiles, dialect, encoding (stack-level skill, app knowledge in a profile)", () => {
  it("a profile with `parent` merges over the built-in adapter, dialect key-wise", () => {
    expect(profile.id).toBe("legacy-ng-fixture");
    expect(profile.patterns.some((p: any) => p.kind === "controller")).toBe(true); // from angularjs
    expect(profile.dialect.bindAttrs).toEqual(["ng-bind", "ng-bind-html"]); // inherited key
    expect(profile.dialect.language).toBe("hu"); // profile key
    expect(profile.dialect.condition({ "ng-hide": "x" })).toBe("!(x)");
  });

  it("a parent cycle and an unknown parent are refused", async () => {
    const d = mkdtempSync(join(tmpdir(), "prof-"));
    writeFileSync(join(d, "a.mjs"), `export const parent = ${JSON.stringify(join(d, "b.mjs"))};`);
    writeFileSync(join(d, "b.mjs"), `export const parent = ${JSON.stringify(join(d, "a.mjs"))};`);
    writeFileSync(join(d, "c.mjs"), `export const parent = "nope";`);
    await expect(loadAdapter(join(d, "a.mjs"))).rejects.toThrow(/parent cycle/);
    await expect(loadAdapter(join(d, "c.mjs"))).rejects.toThrow(/unknown adapter nope/);
    rmSync(d, { recursive: true, force: true });
  });

  it("decode: UTF-16 BOM, then valid UTF-8, then the legacy code page (default windows-1252, profile-set)", () => {
    const ow = Buffer.from([0x6f, 0xf5]); // "o" + 0xF5: ő in windows-1250, õ in windows-1252
    expect(decode(Buffer.from([0xff, 0xfe, 0x41, 0x00])).text).toBe("A");
    expect(decode(Buffer.from("ő", "utf8")).text).toBe("ő");
    expect(decode(ow, "windows-1252").text).toBe("oõ");
    setLegacyEncoding("windows-1250");
    expect(decode(ow).text).toBe("oő");
    setLegacyEncoding("windows-1252");
    expect(decode(ow).text).toBe("oõ");
    expect(() => setLegacyEncoding("no-such-code-page")).toThrow();
  });

  it("without a dialect the plan reads plain HTML: no interpolation, only HTML controls and on* handlers", () => {
    const p = planScreen({
      templateFile: "a.html",
      template: `<div>\n<button onclick="go()">Go {{x}}</button>\n<a ng-click="y()">y</a>\n<input name="q">\n</div>`,
      strings: {},
      screen: { id: "SCR-p", actions: [{ id: "ACT-go", covers: ["a.html:2"] }], unmapped: [], dialogs: [], fields: [{ key: "q", cite: "a.html:4" }] },
    });
    expect(p.controls.map((c: any) => c.at)).toEqual(["a.html:2", "a.html:4"]);
    expect(p.unlinked).toEqual([]);
    expect(p.html).toContain("Go {{x}}");
    expect(p.html).toContain('class="pl-view"');
    const page = planPage(p, { screen: { id: "SCR-p", actions: [{ id: "ACT-go" }] }, templateFile: "a.html" }, "");
    expect(page).toContain('<html lang="en">');
    expect(page).toContain(".pl-dialog { position: static");
  });

  it("dialect classes and language reach the plan page and dialogs", () => {
    const p = planScreen({
      templateFile: "a.html",
      template: "<div></div>",
      strings: {},
      dialect: profile.dialect,
      screen: { id: "SCR-d", actions: [], unmapped: [], dialogs: [{ id: "DLG-x", kind: "confirm", message: "sure?", buttons: ["OK"] }] },
    });
    expect(p.dialogs).toContain('class="dlg pl-dialog"');
    expect(p.dialogs).toContain('<div class="dlg-h">');
    expect(p.dialogs).toContain('class="button sk-button pl-ctl"');
    const page = planPage(p, { screen: { id: "SCR-d", actions: [] }, templateFile: "a.html", dialect: profile.dialect }, "");
    expect(page).toContain('<html lang="hu">');
    expect(page).toContain(".pl-dialog.dlg { position: static");
  });

  it("built-in angularjs routes: $routeProvider.when and ui-router .state", async () => {
    const ng = await load("adapters/angularjs.mjs");
    const src: Record<string, string> = {
      "app.js": "app.config(function ($routeProvider) {\n  $routeProvider.when('/orders', { templateUrl: 'orders.html', controller: 'OrdersCtrl' });\n});\n",
      "states.js": "$stateProvider\n  .state('detail', { url: '/detail/:id', templateUrl: 'detail.html' });\n",
      "orders.html": "<div></div>",
    };
    const rows = ng.routes(Object.keys(src), (f: string) => src[f]);
    expect(rows.filter((r: any) => r.kind === "route").map((r: any) => `${r.name}@${r.file}:${r.line}`)).toEqual(["/orders@app.js:2", "/detail/:id@states.js:2"]);
    expect(rows.find((r: any) => r.kind === "template").name).toBe("orders.html");
  });

  it("js-literal refuses non-literal code instead of evaluating it", async () => {
    const { parseLiteralAt } = await load("js-literal.mjs");
    expect(parseLiteralAt("{ a: [1, 'x', null, true], 'b': { c: -1.5e2 }, }", 0).value).toEqual({ a: [1, "x", null, true], b: { c: -150 } });
    expect(() => parseLiteralAt("{ a: require('fs') }", 0)).toThrow(/not a literal/);
    expect(() => parseLiteralAt("{ a: `x${1}` }", 0)).toThrow(/not a literal/);
  });
});
