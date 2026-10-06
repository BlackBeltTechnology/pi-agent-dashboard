#!/usr/bin/env node
// Screen plan: the original template (+ shell toolbar) flattened to static HTML, styled with the
// style kit, every control numbered and linked to its UI-model action / unmapped reason / field.
// usage: screen-plan.mjs <appDir> <adapter> <pkgDir> <screenId> [effectiveConfig.json]
//   writes <pkgDir>/ui/plans/<screenId>.html; exit 1 when a control links to nothing (gate).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { parseLiteralAt } from "./js-literal.mjs";
import { adapterOrExit, parseCite, readText } from "./lib.mjs";
import { escAttr, escHtml, isVoid, parseHtml } from "./lib-html.mjs";

const BASE_CONTROL_TAGS = ["button", "input", "select", "textarea"];
const BASE_DROP_TAGS = ["script", "style"];
const KEEP_ATTRS = new Set(["class", "style", "type", "title", "colspan", "rowspan", "id", "value", "placeholder", "width", "height", "align", "valign"]);

// text from a template: existing entities (&nbsp;) stay, bare & < > are escaped
const escText = (s) => String(s).replace(/&(?!#?\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (s, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Toolbar keys an expression references, by the adapter's `toolbar.ref` pattern (none without the hook). */
const toolbarRefs = (s, ctx) => (ctx.toolbar ? [...String(s ?? "").matchAll(new RegExp(ctx.toolbar.ref.source, "g"))].map((m) => m[1]) : []);

const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const firstAttr = (a, names) => names.map((n) => a[n]).find((v) => v);

/**
 * Template dialect of the adapter (`adapter.dialect`), normalized. Every template-language rule the
 * plan applies comes from here; without a dialect the plan reads plain HTML.
 * Keys: interpolation [open, close]; controlTags/dropTags/selectTags; controlAttrs (make an element a
 * control), refAttrs (scanned for toolbar refs), labelAttrs (label fallback), bindAttrs (text binding);
 * condition(attrs) -> expr|null; repeat(attrs) -> expr|null; repeatList(expr) -> form-view list name|null;
 * repeatLabel(expr); switchValues(attrs) -> values|undefined; switchType(field); exprText(expr, env, ctx)
 * -> {text}|{ph}|undefined; decide(conjunct, env) -> true|false|undefined; classes {view, dialog,
 * dialogHeader, dialogBody, dialogFooter, button}; language (field-label language, page lang).
 */
const DIALECT_DEFAULTS = {
  interpolation: null,
  controlTags: [],
  dropTags: [],
  selectTags: [],
  controlAttrs: ["onclick", "onchange"],
  refAttrs: [],
  labelAttrs: ["onclick", "name"],
  bindAttrs: [],
  condition: () => null,
  repeat: () => null,
  repeatList: () => null,
  repeatLabel: (x) => x,
  switchValues: () => undefined,
  switchType: (f) => f.type,
  exprText: () => undefined,
  decide: () => undefined,
  language: "en",
};
const CLASS_DEFAULTS = { view: "pl-view", dialog: "", dialogHeader: "pl-dlg-h", dialogBody: "pl-dlg-b", dialogFooter: "pl-dlg-f", button: "" };

export function dialectOf(d = {}) {
  const x = { ...DIALECT_DEFAULTS, ...d };
  const [open, close] = x.interpolation ?? [null, null];
  const body = open && `${reEsc(open)}[\\s\\S]*?${reEsc(close)}`;
  return {
    ...x,
    open,
    close,
    interp: body ? new RegExp(`(${body})`) : null,
    interpAll: body ? new RegExp(body, "g") : null,
    controlTags: new Set([...BASE_CONTROL_TAGS, ...x.controlTags]),
    dropTags: new Set([...x.dropTags, ...BASE_DROP_TAGS]),
    selectTags: new Set(x.selectTags),
    classes: { ...CLASS_DEFAULTS, ...(d.classes ?? {}) },
  };
}
const hasInterp = (v, D) => D.open !== null && String(v).includes(D.open);
const fieldLabel = (field, D) => field.label?.[D.language] ?? field.key;

/** Interpolated expression -> display text (dialect first), else a ‹placeholder›. */
function exprText(expr, env, ctx) {
  return ctx.D.exprText(expr.trim(), env, ctx) ?? { ph: short(expr.trim()) };
}
function renderText(text, env, ctx) {
  const D = ctx.D;
  if (!D.interp) return escText(text);
  return text
    .split(D.interp)
    .map((part) => {
      if (!part.startsWith(D.open)) return escText(part);
      const r = exprText(part.slice(D.open.length, -D.close.length), env, ctx);
      return r.text !== undefined ? escHtml(r.text) : `<span class="pl-ph">‹${escHtml(r.ph)}›</span>`;
    })
    .join("");
}

/** Which UI-model item a control at `at` belongs to. */
function resolveTarget(at, a, env, ctx) {
  const act = ctx.screen.actions.find((x) => (x.covers || []).includes(at) || x.trigger?.cite === at);
  if (act) return { action: act.id };
  const un = (ctx.screen.unmapped || []).find((u) => u.at === at);
  if (un) return { unmapped: un.reason };
  const fld = (ctx.screen.fields || []).find((f) => (f.covers || []).includes(at) || String(f.cite || "").split(/;\s*/).includes(at));
  if (fld) return { field: `${ctx.screen.id}#${fld.key}` };
  const key = ctx.D.refAttrs.map((n) => a[n]).flatMap((x) => toolbarRefs(x, ctx)).find((k) => ctx.toolbarKeys?.[k]);
  if (key) return { action: ctx.toolbarKeys[key] };
  if (env.field) return { field: `${ctx.form.id ?? "form"}#${env.field.key}` };
  // the shell's own controls (logo/about, navigation) are on every screen: app shell, not this screen's model
  if (env.file === ctx.shellFile) return { shell: true };
  return null;
}

function controlLabel(node, a, env, ctx) {
  const text = (function collect(n) {
    return n.children.map((c) => (c.text !== undefined ? c.text : collect(c))).join(" ");
  })(node);
  const shown = renderText(text, env, ctx).replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  if (shown) return shown;
  if (env.field) return fieldLabel(env.field, ctx.D);
  return firstAttr(a, ctx.D.labelAttrs) || a.placeholder || node.tag;
}

/** Register a control (one per source line); returns its number and whether this is the first render. */
function control(node, a, env, ctx, st) {
  const at = `${env.file}:${node.line}`;
  if (st.byAt.has(at)) return { n: st.byAt.get(at).n, first: false };
  const c = { n: st.controls.length + 1, at, where: env.where, label: controlLabel(node, a, env, ctx), target: resolveTarget(at, a, env, ctx) };
  st.controls.push(c);
  st.byAt.set(at, c);
  return { n: c.n, first: true };
}

/** Static classes (bindings dropped) + mapped kit classes + plan markers, de-duplicated. */
function classList(a, extraClass, ctx) {
  const raw = String(a.class ?? "");
  const cls = [...(ctx.D.interpAll ? raw.replace(ctx.D.interpAll, "") : raw).split(/\s+/).filter(Boolean)];
  for (const c of [...cls]) if (ctx.kitClasses?.[c]) cls.push(ctx.kitClasses[c]);
  cls.push(...extraClass);
  return [...new Set(cls)];
}
const BLANK_IMG = 'src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27/%3E"';

function outAttrs(node, a, extraClass, title, ctx, file) {
  const cls = classList(a, extraClass, ctx);
  const out = [];
  for (const [k, v] of Object.entries(a)) {
    if (k === "class" || !KEEP_ATTRS.has(k) || hasInterp(v, ctx.D)) continue;
    out.push(`${k}="${escAttr(v)}"`);
  }
  if (cls.length) out.unshift(`class="${escAttr(cls.join(" "))}"`);
  if (title) out.push(`title="${escAttr(title)}"`);
  if (node.tag === "img") {
    const src = a.src && !hasInterp(a.src, ctx.D) ? ctx.asset?.(a.src, file) : null;
    out.push(src ? `src="${src}"` : BLANK_IMG);
  }
  return out.length ? ` ${out.join(" ")}` : "";
}

/** Top-level `&&` parts of a condition (none when it has a top-level `||`). */
function conjuncts(cond) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cond.length; i++) {
    const ch = cond[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && cond.startsWith("||", i)) return [];
    else if (depth === 0 && cond.startsWith("&&", i)) {
      parts.push(cond.slice(start, i));
      start = i + 2;
      i++;
    }
  }
  parts.push(cond.slice(start));
  return parts.map((x) => x.trim().replace(/^\((.*)\)$/, "$1").trim());
}
/** Visibility of an element: {hidden} when it cannot show here, else its condition and toolbar refs. */
function visibility(node, a, env, ctx) {
  const D = ctx.D;
  if (D.dropTags.has(node.tag)) return { hidden: true };
  const vals = env.field ? D.switchValues(a) : undefined;
  if (vals && !vals.includes(D.switchType(env.field))) return { hidden: true };
  const cond = D.condition(a);
  const refs = toolbarRefs(cond, ctx);
  if (refs.length && !refs.some((k) => ctx.toolbarKeys?.[k])) return { hidden: true };
  if (cond && env.field && conjuncts(cond).some((c) => D.decide(c, env) === false)) return { hidden: true };
  return { cond, refs };
}

/** Plan marker classes + title for a conditional and/or repeated element. */
function markers(cond, refs, env) {
  const extra = [];
  let title = null;
  if (cond && !refs.length) {
    extra.push("pl-cond");
    title = `shown when: ${cond}`;
  }
  if (env.repeat) {
    extra.push("pl-repeat");
    title = [title, `repeated: ${env.repeat}`].filter(Boolean).join(" · ");
  }
  return { extra, title };
}

/** Numbered callout of a control: badge (first render of its line only) + data-pl attribute. */
function callout(node, a, env, ctx, st, extra) {
  const isCtl = ctx.D.controlTags.has(node.tag) || ctx.D.selectTags.has(node.tag) || firstAttr(a, ctx.D.controlAttrs);
  if (!isCtl) return { badge: "", dataPl: "" };
  const { n, first } = control(node, a, env, ctx, st);
  extra.push("pl-ctl");
  return { badge: first ? `<span class="pl-n" data-pl="${n}">${n}</span>` : "", dataPl: ` data-pl="${n}"` };
}

function elementBody(node, a, env, ctx, st) {
  // an element's own content shows until a text binding resolves: prefer it when there is any
  const hasOwn = node.children.some((c) => c.tag || (c.text ?? "").trim());
  const bind = firstAttr(a, ctx.D.bindAttrs);
  if (bind && !hasOwn) return `<span class="pl-ph">‹${escHtml(short(bind))}›</span>`;
  const inner = { ...env, repeat: null };
  return node.children.map((c) => emitNode(c, inner, ctx, st)).join("");
}

/** Emit one element (after repeat/condition handling). */
function emitElement(node, env, ctx, st) {
  const a = node.attrs;
  const vis = visibility(node, a, env, ctx);
  if (vis.hidden) return "";
  const { extra, title } = markers(vis.cond, vis.refs, env);
  const { badge, dataPl } = callout(node, a, env, ctx, st, extra);
  if (ctx.D.selectTags.has(node.tag)) {
    return `${badge}<span${outAttrs(node, a, ["pl-select", "sk-input", ...extra], title, ctx, env.file)}${dataPl}><span class="pl-ph">‹${escHtml(env.field?.key ?? "select")}›</span> ▾</span>`;
  }
  const body = elementBody(node, a, env, ctx, st);
  const open = `<${node.tag}${outAttrs(node, a, extra, title, ctx, env.file)}${dataPl}>`;
  return `${badge}${open}${isVoid(node.tag) ? "" : `${body}</${node.tag}>`}`;
}

function emitNode(node, env, ctx, st) {
  if (node.text !== undefined) return renderText(node.text, env, ctx);
  const rep = ctx.D.repeat(node.attrs);
  if (!rep) return emitElement(node, env, ctx, st);
  const list = ctx.D.repeatList(rep);
  const view = list && ctx.formViews?.[list];
  if (view && ctx.form) {
    const fields = ctx.form.fields.filter((f) => (f.views || []).includes(view));
    return fields.map((field, i) => emitElement(node, { ...env, field, fieldIndex: i, fieldLast: i === fields.length - 1 }, ctx, st)).join("");
  }
  return emitElement(node, { ...env, repeat: ctx.D.repeatLabel(rep) }, ctx, st);
}

const findById = (n, id) => (n.attrs?.id === id ? n : (n.children || []).reduce((hit, c) => hit || (c.tag ? findById(c, id) : null), null));

/** Actions not reached through the template/toolbar: context menu, keys, auto, toolbar items outside the shell markup. */
function otherEntries(ctx, st) {
  const reached = new Set(st.controls.map((c) => c.target?.action).filter(Boolean));
  const groups = {};
  for (const a of ctx.screen.actions) {
    if (reached.has(a.id)) continue;
    const kind = a.trigger?.kind || "other";
    const c = { n: st.controls.length + 1, at: a.trigger?.cite || "", where: kind, label: a.label || a.id, target: { action: a.id } };
    st.controls.push(c);
    (groups[kind] ||= []).push(c);
  }
  const TITLE = { "context-menu": "Context menu", key: "Keyboard", auto: "Automatic / not user-triggered", toolbar: "Toolbar (outside the shell markup)" };
  return Object.entries(groups)
    .map(([kind, cs]) => `<div class="pl-group"><h4>${escHtml(TITLE[kind] || kind)}</h4><ul class="sk-menu pl-menu">${cs.map((c) => `<li class="pl-ctl" data-pl="${c.n}"><span class="pl-n" data-pl="${c.n}">${c.n}</span> ${escHtml(c.label)}</li>`).join("")}</ul></div>`)
    .join("");
}

const cls = (...xs) => escAttr(xs.filter(Boolean).join(" "));

function dialogsHtml(ctx, st) {
  const K = ctx.D.classes;
  return (ctx.screen.dialogs || [])
    .map((d) => {
      const buttons = (d.buttons || ["OK"]).map((b) => {
        const c = { n: st.controls.length + 1, at: d.cite || "", where: "dialog", label: `${d.id}: ${b}`, target: { dialog: d.id, action: d.from } };
        st.controls.push(c);
        return `<span class="pl-n" data-pl="${c.n}">${c.n}</span><button class="${cls(K.button, "sk-button pl-ctl")}" data-pl="${c.n}">${escHtml(b)}</button>`;
      });
      const msg = String(d.message ?? "");
      const key = msg.split(/\s/)[0];
      const text = ctx.strings[key] ? `${ctx.strings[key]}${msg.length > key.length ? ` <span class="pl-ph">${escHtml(msg.slice(key.length).trim())}</span>` : ""}` : escHtml(msg);
      return `<div class="${cls(K.dialog, "pl-dialog")}" id="pl-${escAttr(d.id)}"><div class="${escAttr(K.dialogHeader)}">${escHtml(d.id)} <span class="pl-kind">${escHtml(d.kind || "")}</span></div><div class="${escAttr(K.dialogBody)}">${text}</div><div class="${escAttr(K.dialogFooter)}">${buttons.join(" ")}</div></div>`;
    })
    .join("");
}

/** Build the plan fragments + control register. Pure (ctx carries all inputs). */
export function planScreen(context) {
  const ctx = { ...context, D: dialectOf(context.dialect) };
  const st = { controls: [], byAt: new Map() };
  let header = "";
  if (ctx.shell && ctx.shellToolbarId) {
    const h = findById(parseHtml(ctx.shell), ctx.shellToolbarId);
    if (h) header = emitNode(h, { file: ctx.shellFile, where: "toolbar" }, ctx, st);
  }
  const view = parseHtml(ctx.template)
    .children.map((n) => emitNode(n, { file: ctx.templateFile, where: "screen" }, ctx, st))
    .join("");
  const others = otherEntries(ctx, st);
  const dialogs = dialogsHtml(ctx, st);
  const unlinked = st.controls.filter((c) => !c.target);
  return { html: `${header}<div class="${cls(ctx.D.classes.view)}">${view}</div>`, others, dialogs, controls: st.controls, unlinked };
}

// ---------- page ----------

/** Legend cell for an action: link, label, guards, first 4 effect steps. */
function actionText(id, act) {
  const guards = (act.guards || []).length ? ` <span class="pl-guard">guard ${act.guards.map(escHtml).join(", ")}</span>` : "";
  const steps = (act.effects || []).map((e) => e.step).filter(Boolean).slice(0, 4).map(escHtml).join(" → ");
  return `<a href="#" data-open="${escAttr(id)}">${escHtml(id)}</a> ${escHtml(act.label || "")}${guards}${steps ? `<div class="pl-steps">${steps}</div>` : ""}`;
}
function targetText(t, act) {
  if (act) return actionText(t.action, act);
  if (t.unmapped) return `<span class="pl-un">not an action:</span> ${escHtml(t.unmapped)}`;
  if (t.field) return `field ${escHtml(t.field)}`;
  if (t.shell) return '<span class="pl-un">app shell</span> (every screen; not in this screen\'s UI model)';
  return '<span class="pl-un">UNLINKED</span>';
}

function legendRow(c, ctx) {
  const t = c.target || {};
  const act = t.action && ctx.screen.actions.find((x) => x.id === t.action);
  let what = targetText(t, act);
  if (t.dialog) what = `dialog ${escHtml(t.dialog)}${act ? ` from ${what}` : ""}`;
  return `<tr data-pl="${c.n}"><td class="pl-num">${c.n}</td><td>${escHtml(c.where)}<div class="pl-cite">${escHtml(c.at)}</div></td><td>${escHtml(short(c.label, 60))}</td><td>${what}</td></tr>`;
}

const PLAN_CSS = `
body.sk-plan { margin: 0; font-family: var(--sk-font-base, sans-serif); background: #fff; }
.pl-top { padding: 8px 14px; border-bottom: 1px solid #ccc; display: flex; gap: 12px; align-items: center; }
.pl-top h1 { font-size: 14pt; margin: 0; flex: 1; }
.pl-wrap { display: flex; align-items: flex-start; }
.pl-screen { flex: 1; min-width: 0; position: relative; padding-bottom: 12px; }
.pl-legend { width: 460px; max-height: 100vh; overflow: auto; position: sticky; top: 0; border-left: 1px solid #ccc; font-size: 10pt; background: #fafafa; }
.pl-legend table { border-collapse: collapse; width: 100%; }
.pl-legend td, .pl-legend th { border-bottom: 1px solid #e3e3e3; padding: 3px 5px; vertical-align: top; text-align: left; }
.pl-cite { color: #888; font-size: 8.5pt; font-family: monospace; }
.pl-steps { color: #555; font-size: 9pt; }
.pl-guard { background: #fff0d9; border: 1px solid #f0ad4e; border-radius: 3px; padding: 0 3px; font-size: 8.5pt; }
.pl-un { color: #a94442; font-weight: bold; }
.pl-n { display: inline-block; min-width: 15px; height: 15px; line-height: 15px; border-radius: 8px; background: #d9534f; color: #fff; font: bold 8pt/15px sans-serif; text-align: center; margin: 0 2px; vertical-align: top; cursor: pointer; position: relative; z-index: 3; }
.pl-num { font-weight: bold; color: #d9534f; }
.pl-ph { color: #6a6a8a; font-style: italic; }
.pl-cond { outline: 1px dashed #9aa7c7; outline-offset: 1px; }
.pl-repeat { box-shadow: inset 3px 0 0 #c5d6f0; }
.pl-ctl.pl-hot, tr.pl-hot { background: #fff3a8 !important; outline: 2px solid #f0ad4e; }
.pl-select { display: inline-block; min-width: 90px; border: 1px solid #aaa; padding: 1px 4px; background: #fff; }
.pl-section { padding: 10px 14px; border-top: 1px solid #ddd; }
.pl-section h3 { margin: 0 0 6px; font-size: 12pt; }
.pl-group h4 { margin: 6px 0 2px; font-size: 10.5pt; }
.pl-menu { list-style: none; padding: 0; margin: 0; display: inline-block; border: 1px solid #bbb; background: #fff; min-width: 260px; }
.pl-menu li { padding: 3px 8px; border-bottom: 1px solid #eee; }
.pl-dialogs { display: flex; flex-wrap: wrap; gap: 12px; }
.pl-dialog__DLG__ { position: static !important; display: inline-block !important; width: 300px; margin: 0; box-shadow: 0 1px 6px rgba(0,0,0,.25); }
.pl-kind { font-size: 9pt; color: #888; }
/* the app is a full-window flex layout: give it a window */
.pl-screen { overflow: auto; }
.pl-frame { position: relative; overflow: hidden; border: 1px solid #888; margin: 10px; box-shadow: 0 2px 8px rgba(0,0,0,.2); background: #fff; }
.pl-frame > #complete-page { position: relative; height: 100%; }
`;

const PLAN_JS = `
(function(){
  function hot(n){document.querySelectorAll('.pl-hot').forEach(function(e){e.classList.remove('pl-hot')});
    document.querySelectorAll('[data-pl="'+n+'"]').forEach(function(e){if(!e.classList.contains('pl-n'))e.classList.add('pl-hot')});}
  document.addEventListener('mouseover',function(e){var t=e.target.closest('[data-pl]');if(t)hot(t.getAttribute('data-pl'));});
  document.addEventListener('click',function(e){
    var o=e.target.closest('[data-open]');
    if(o){e.preventDefault();var msg={type:'screen-plan-open',screen:document.body.dataset.screen,action:o.getAttribute('data-open')};
      if(window.parent!==window)window.parent.postMessage(msg,'*');else location.href='../../diagrams/catalog.html#view=scr:'+msg.screen+'&f='+msg.action;return;}
    var t=e.target.closest('[data-pl]');if(!t)return;e.preventDefault();
    var r=document.querySelector('.pl-legend tr[data-pl="'+t.getAttribute('data-pl')+'"]');if(r)r.scrollIntoView({block:'center'});
  },true);
})();`;

/** Kit font stacks without a generic family get a metric-compatible fallback (the plan may open off Windows). */
function fontFallbacks(fonts = []) {
  const generic = /(^|,)\s*(serif|sans-serif|monospace|cursive|fantasy|system-ui)\s*$/i;
  const keyword = /^\s*(inherit|initial|unset|revert)\s*$/i;
  const lines = fonts.filter((f) => !generic.test(f.value) && !keyword.test(f.value)).map((f) => `  ${f.name}: ${f.value}, Carlito, "Segoe UI", sans-serif;`);
  return lines.length ? `\n:root {\n${lines.join("\n")}\n}\n` : "";
}

export function planPage(p, ctx, kitCss, extraCss = "") {
  const linked = p.controls.length - p.unlinked.length;
  const D = dialectOf(ctx.dialect);
  const css = PLAN_CSS.replace("__DLG__", D.classes.dialog ? `.${D.classes.dialog}` : "");
  return `<!doctype html>
<html lang="${escAttr(D.language)}"><head><meta charset="utf-8"><title>Screen plan — ${escHtml(ctx.screen.id)}</title>
<style>${kitCss}</style><style>${extraCss}</style><style>${css}${fontFallbacks(ctx.kitFonts)}</style></head>
<body class="sk-plan" data-screen="${escAttr(ctx.screen.id)}">
<div class="pl-top"><h1>${escHtml(ctx.screen.id)} — ${escHtml(ctx.screen.name || "")}</h1><span>${p.controls.length} controls, ${linked} linked · source ${escHtml(ctx.templateFile)} + toolbar ${escHtml(ctx.shellFile || "")} · style kit</span></div>
<div class="pl-wrap"><div class="pl-screen"><div class="pl-frame" style="width:${ctx.frame?.[0] ?? 1366}px;height:${ctx.frame?.[1] ?? 768}px"><div id="complete-page">${p.html}</div></div>
${p.others ? `<div class="pl-section"><h3>Other entry points</h3>${p.others}</div>` : ""}
${p.dialogs ? `<div class="pl-section"><h3>Dialogs</h3><div class="pl-dialogs">${p.dialogs}</div></div>` : ""}
</div><aside class="pl-legend"><table><tr><th>#</th><th>Where</th><th>Control</th><th>Links to</th></tr>${p.controls.map((c) => legendRow(c, ctx)).join("")}</table></aside></div>
<script>${PLAN_JS}</script></body></html>
`;
}

// ---------- CLI ----------

const MIME = { ".png": "image/png", ".gif": "image/gif", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2" };
function dataUri(file) {
  if (!existsSync(file) || !MIME[extname(file).toLowerCase()]) return null;
  return `data:${MIME[extname(file).toLowerCase()]};base64,${readFileSync(file).toString("base64")}`;
}

/** Toolbar keys a toolbar action assigns, read from its cited code range by `toolbar.assign`: {key: actionId}. */
function toolbarKeysOf(appDir, actions, toolbar) {
  const keys = {};
  if (!toolbar) return keys;
  for (const a of actions.filter((x) => x.trigger?.kind === "toolbar")) {
    const c = parseCite(a.trigger.cite);
    if (!c) continue;
    const lines = readText(join(appDir, c.file)).split("\n").slice(c.from - 1, c.to);
    for (const m of lines.join("\n").matchAll(new RegExp(toolbar.assign.source, "g"))) keys[m[1]] ??= a.id;
  }
  return keys;
}

/** Shell page around every screen (optional adapter hook): file, text, toolbar element id. */
function shellOf(appDir, shell) {
  if (!shell) return { shellFile: null, shell: "", shellToolbarId: null };
  return { shellFile: shell.file, shell: readText(join(appDir, shell.file)), shellToolbarId: shell.toolbarId ?? null };
}

async function main([appDir, adapterName, pkgDir, screenId, effective]) {
  if (!screenId) {
    process.stderr.write("usage: screen-plan.mjs <appDir> <adapter> <pkgDir> <screenId> [effectiveConfig.json]\n");
    return 2;
  }
  const adapter = await adapterOrExit(adapterName);
  const ui = join(pkgDir, "ui");
  const screen = JSON.parse(readText(join(ui, "screens", `${screenId}.json`)));
  const kit = JSON.parse(readText(join(ui, "style-kit.json")));
  const conf = effective ? JSON.parse(readText(join(ui, "_effective", effective))) : {};
  const formId = (screen.forms || [])[0]?.form;
  const form = formId ? { id: formId, ...JSON.parse(readText(join(ui, "forms", `${formId}.json`))) } : null;
  const kitClasses = {};
  for (const [name, parts] of Object.entries(kit.components))
    for (const p of parts) {
      const m = p.selector.match(/^\.([\w-]+)$/);
      if (m) kitClasses[m[1]] = `sk-${name}`;
    }
  const ctx = {
    screen,
    templateFile: screen.template,
    template: readText(join(appDir, screen.template)),
    ...shellOf(appDir, adapter.shell),
    dialect: adapter.dialect,
    strings: adapter.strings ? adapter.strings(appDir, conf.conf, readText, { parseLiteralAt }) : {},
    toolbar: adapter.toolbar,
    toolbarKeys: toolbarKeysOf(appDir, screen.actions, adapter.toolbar),
    form,
    formViews: adapter.planViews,
    kitClasses,
    kitFonts: kit.tokens.font,
    // images resolve relative to the file they appear in
    asset: (src, file) => dataUri(normalize(join(appDir, dirname(file), src))),
  };
  const p = planScreen(ctx);
  const extraCss = (adapter.planAssets?.(appDir, readText) || []).map(({ css, file }) => css.replace(/url\((['"]?)([^'")]+)\1\)/g, (all, _q, u) => {
    const uri = u.startsWith("data:") ? null : dataUri(normalize(join(appDir, dirname(file), u.split(/[?#]/)[0])));
    return uri ? `url(${uri})` : all;
  })).join("\n");
  mkdirSync(join(ui, "plans"), { recursive: true });
  writeFileSync(join(ui, "plans", `${screenId}.html`), planPage(p, ctx, readText(join(ui, "style-kit.css")), extraCss));
  process.stdout.write(`${screenId}: ${p.controls.length} controls, ${p.unlinked.length} unlinked\n`);
  for (const c of p.unlinked) process.stderr.write(`${screenId}: unlinked control ${c.n} at ${c.at} (${c.label})\n`);
  return p.unlinked.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
