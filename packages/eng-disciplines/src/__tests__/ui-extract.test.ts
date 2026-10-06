/**
 * reverse-spec-for-rebuild UI extraction: style kit + screen plan units (ported from the Plantifier pilot)
 * and the CLI contract (adapter by name or path, optional hooks, unlinked-control gate).
 * See change: promote-ui-extraction.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SKILL } from "./files";

const UX = join(SKILL, "scripts", "ui-extract");
const load = async (f: string): Promise<any> => import(pathToFileURL(join(UX, f)).href);
const { parseHtml } = await load("lib-html.mjs");
const { buildKit } = await load("style-kit.mjs");
const { planPage, planScreen } = await load("screen-plan.mjs");
const TOOLBAR = { ref: /OpBar\.(\w+)/g, assign: /OpBar\.(\w+)\s*=/g };

describe("ui-extract units", () => {

  it("parseHtml keeps line numbers, void and self-closing elements", () => {
    const t = parseHtml('<div class="a">\n  <input ng-model="x">\n  <br />\n  <span>{{y}}</span>\n</div>');
    const div = t.children.find((n) => n.tag === "div");
    assert.equal(div.line, 1);
    const [input, br, span] = div.children.filter((n) => n.tag);
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
    const c333 = kit.tokens.color.find((t) => t.value === "#333333");
    assert.equal(c333.uses, 3);
    const twice = buildKit({ "css/a.css": ".x { color: #fff; border: 1px solid #fff; }" }, {});
    assert.deepEqual(twice.tokens.color[0].cites, ["css/a.css:1"], "a rule using a colour twice is cited once");
    assert.equal(twice.tokens.color[0].uses, 2);
    assert.ok(kit.tokens.color.some((t) => t.value === "#ffffff" && t.uses === 2));
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
    <span class="op-bar-elem product" ng-click="about()">Plantifier</span>
    <span class="op-bar-elem" ng-if="OpBar.save || OpBar.lock"><button ng-if="OpBar.save" ng-click="OpBar.save.save()">{{str('save')}}</button>
    <button ng-if="OpBar.test && OpBar.test.failed" ng-click="OpBar.test.fixAll()">fix</button></span>
    <span class="op-bar-elem" ng-if="OpBar.import"><button ng-click="OpBar.import()">imp</button></span>
  </div>`;
  const ctx = () => ({
    templateFile: "html/order.htm",
    template: TEMPLATE,
    shellFile: "html/ang.htm",
    shell: SHELL,
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
    const byLine = Object.fromEntries(p.controls.map((c) => [c.at, c]));
    assert.equal(byLine["html/order.htm:7"].target.action, "ACT-add");
    assert.equal(byLine["html/order.htm:4"].target.unmapped, "config-driven date input");
    assert.equal(byLine["html/ang.htm:3"].target.action, "ACT-save");
    // shell controls not bound to this screen's toolbar keys belong to the app shell, not to the screen
    assert.equal(byLine["html/ang.htm:2"].target.shell, true);
    // template fields recorded on the screen link by cite
    assert.equal(byLine["html/order.htm:9"].target.field, "SCR-x#note");
    assert.deepEqual(p.unlinked.map((c) => c.at), ["html/order.htm:8"]);
    // one callout per source line even when a repeat renders the line twice
    assert.equal(p.controls.filter((c) => c.at === "html/order.htm:5").length, 1);
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
<div id="header"><span class="op-bar-elem" ng-if="OpBar.save"><button ng-click="OpBar.save.save()">{{str('save')}}</button></span></div>
<div ng-view></div></body></html>`);
    put(app, "css/main.css", "html { font-family: Calibri; }\n.button { color: #3194FF; }\n#header { background: #222; }\n");
    put(app, "css/font-awesome-4.5.0/css/font-awesome.min.css", ".fa{display:inline-block}");
    put(app, "js/strings.js", "var _STR_ = { hu: { save: 'Mentés', add: 'Felvétel' } };\n");
    put(app, "js/a.js", "function A($rootScope) {\n  $rootScope.OpBar.save = { save: save };\n}\n");
    put(app, "html/a.htm", `<div>\n  <button class="button" ng-click="add()">{{str('add')}}</button>\n  <a ng-click="ghost()">?</a>\n</div>\n`);
    put(pkg, "ui/screens/SCR-a.json", JSON.stringify({
      id: "SCR-a", template: "html/a.htm", dialogs: [], fields: [],
      actions: [
        { id: "ACT-add", label: "add", trigger: { kind: "ng-click", cite: "html/a.htm:2" } },
        { id: "ACT-save", label: "save", trigger: { kind: "opbar", cite: "js/a.js:2" } },
      ],
      unmapped: [{ at: "html/a.htm:3", reason: "debug link" }],
    }));
    put(dir, "job.json", JSON.stringify({ components: { button: [".button"], toolbar: ["#header"] } }));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("style kit + plan: built-in adapter name and the same adapter by path give identical output", () => {
    const builtin = join(UX, "adapters", "angularjs-hta.mjs");
    for (const [adapter, out] of [["angularjs-hta", "k1"], [builtin, "k2"]]) {
      const r = run(join(UX, "style-kit.mjs"), app, adapter, join(dir, "job.json"), join(dir, out));
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
    }
    expect(readFileSync(join(dir, "k2", "style-kit.css"), "utf8")).toBe(readFileSync(join(dir, "k1", "style-kit.css"), "utf8"));
    put(pkg, "ui/style-kit.json", readFileSync(join(dir, "k1", "style-kit.json"), "utf8"));
    put(pkg, "ui/style-kit.css", readFileSync(join(dir, "k1", "style-kit.css"), "utf8"));
    const r = run(join(UX, "screen-plan.mjs"), app, builtin, pkg, "SCR-a");
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("SCR-a: 3 controls, 0 unlinked");
    const html = readFileSync(join(pkg, "ui", "plans", "SCR-a.html"), "utf8");
    expect(html).toContain("Felvétel");
    expect(html).toContain("ACT-save");
  });

  it("a project adapter by path needs no optional hooks; an unlinked control exits 1 naming it", () => {
    put(dir, "my-adapter.mjs", `export const id = "mine";
export const styleSources = () => ["css/main.css"];
export const shell = { file: "html/ang.htm" };
export const planViews = {};
`);
    const r = run(join(UX, "screen-plan.mjs"), app, join(dir, "my-adapter.mjs"), pkg, "SCR-a");
    // no toolbar hook: the shell save button is not mapped through OpBar keys -> app shell; no strings hook: ‹placeholders›
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const s = JSON.parse(readFileSync(join(pkg, "ui/screens/SCR-a.json"), "utf8"));
    s.unmapped = [];
    put(pkg, "ui/screens/SCR-a.json", JSON.stringify(s));
    const bad = run(join(UX, "screen-plan.mjs"), app, join(dir, "my-adapter.mjs"), pkg, "SCR-a");
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/SCR-a: unlinked control \d+ at html\/a\.htm:3/);
  });

  it("an unknown adapter name is refused with usage, not a stack trace", () => {
    const r = run(join(UX, "style-kit.mjs"), app, "nope", join(dir, "job.json"), join(dir, "k3"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown adapter nope");
  });
});
