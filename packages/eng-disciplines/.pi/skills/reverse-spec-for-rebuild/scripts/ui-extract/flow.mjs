#!/usr/bin/env node
// Usage: node flow.mjs <pkgDir> <flows-job.json> <flowId> <outDir>
// Derives a BPMN package (semantic only, no DI) from UI-model actions:
//   action            -> userTask (actor role; `form` bound via package.yaml kind: form)
//   action.guards     -> exclusiveGateway "Allowed?" + end event "Blocked"
//   effect validate   -> businessRuleTask + exclusiveGateway "Valid?" (no -> back to the userTask)
//   effect open-dialog-> userTask (actor)
//   effect state      -> scriptTask (UI state);  call/write/read/export/notify/navigate -> serviceTask
// Every non-start/end node documents its refs (check-trace) and its code cite.
// Layout afterwards: bpmn-package-explorer generate-cli.mjs <absOutDir>.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [pkgDir, jobFile, flowId, outDir] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: flow.mjs <pkgDir> <flows-job.json> <flowId> <outDir>");
  process.exit(2);
}
const job = JSON.parse(readFileSync(jobFile, "utf8")).flows.find((f) => f.id === flowId);
if (!job) {
  console.error(`no flow '${flowId}' in ${jobFile}`);
  process.exit(2);
}
const screens = new Map();
const screen = (id) => {
  if (!screens.has(id)) screens.set(id, JSON.parse(readFileSync(join(pkgDir, "ui", "screens", `${id}.json`), "utf8")));
  return screens.get(id);
};

// --- naming (bpmn-package-explorer identifiers.md: <Prefix>_<slug(deburr(name))>) ---
const slug = (s) =>
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const PREFIX = { startEvent: "Start", endEvent: "End", userTask: "Task", serviceTask: "Service", scriptTask: "Script", businessRuleTask: "Rule", exclusiveGateway: "Gateway" };
const VERB = { validate: "Validate", call: "Call", write: "Write", read: "Read", export: "Export", notify: "Notify", navigate: "Navigate", state: "Update", "open-dialog": "Show" };
const short = (e) => {
  if (e.step) return e.step;
  const fn = /([A-Za-z_$][\w$]*(?:\.[\w$]+)+)\(/.exec(e.target)?.[1] ?? /\b([a-z]\w*[A-Z]\w*)\(/.exec(e.target)?.[1];
  const words = e.target.replace(/[^\p{L}\p{N}_.' ]+/gu, " ").trim().split(/\s+/).slice(0, 5).join(" ");
  return `${VERB[e.kind] ?? e.kind} ${fn ?? words}`;
};

const nodes = [];
const flows = [];
const names = new Set();
const node = (type, name, docs = []) => {
  let n = name;
  for (let i = 2; names.has(n); i++) n = `${name} (${i})`; // unique names => unique deterministic ids
  names.add(n);
  const id = `${PREFIX[type]}_${slug(n)}`;
  nodes.push({ id, type, name: n, docs: [...new Set(docs.filter(Boolean))] });
  return id;
};
const flow = (from, to, name) => flows.push({ id: `Flow_${slug(from)}_${slug(to)}`, from, to, name });
const doc = (refs, cite) => [refs.join("; "), cite && `cite: ${cite}`].filter(Boolean).join("\n"); // spec: refs end at ; or newline
const _specOf = (refs) => refs.filter((r) => r.startsWith("spec:"));

const roles = [];
const bindings = [];
let prev = node("startEvent", job.start);
for (const step of job.steps) {
  const s = screen(step.screen);
  const a = s.actions.find((x) => x.id === step.action);
  if (!a) throw new Error(`${step.screen}: no action ${step.action}`);
  const aRefs = [...(a.guards ?? []), ...(a.refs ?? [])];
  const fallback = aRefs.length ? aRefs : [`spec:${job.capability}`];
  const uiLine = `ui: ${step.screen}#${a.id}`; // links the BPMN node to the UI action (catalog / IFML)
  if (a.guards?.length) {
    const g = node("exclusiveGateway", `${step.name ?? a.label} allowed?`, [doc(a.guards, a.trigger?.cite)]);
    flow(prev, g);
    flow(g, node("endEvent", `${step.name ?? a.label} refused`), "no");
    prev = g;
  }
  const task = node("userTask", step.name ?? a.label, [doc(fallback, a.trigger?.cite ?? a.handler?.cite), uiLine]);
  roles.push({ element: task, role: job.actor });
  if (step.form) bindings.push({ kind: "form", ref: `forms/${step.form}.form`, element: task, form: step.form });
  flow(prev, task);
  prev = task;
  for (const [i, e] of (a.effects ?? []).entries()) {
    if (step.skip?.includes(i)) continue; // effect indexes outside this flow's path
    const refs = e.refs?.length ? e.refs : fallback;
    if (e.kind === "validate") {
      const r = node("businessRuleTask", short(e), [doc(refs, e.cite), uiLine]);
      const g = node("exclusiveGateway", `${short(e)} passed?`, [doc(refs, e.cite)]);
      roles.push({ element: r, role: job.system });
      flow(prev, r);
      flow(r, g);
      flow(g, task, "no");
      prev = g;
      continue;
    }
    const type = e.kind === "open-dialog" ? "userTask" : e.kind === "state" ? "scriptTask" : "serviceTask";
    const n = node(type, short(e), [doc(refs, e.cite), uiLine]);
    roles.push({ element: n, role: type === "userTask" ? job.actor : job.system });
    flow(prev, n, prev.startsWith("Gateway_") ? "yes" : undefined);
    prev = n;
  }
}
flow(prev, node("endEvent", job.end), prev.startsWith("Gateway_") ? "yes" : undefined);

// --- emit ---
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const proc = `Process_${slug(job.name)}`;
const xmlNode = (n) => {
  const inc = flows.filter((f) => f.to === n.id).map((f) => `      <bpmn:incoming>${f.id}</bpmn:incoming>`);
  const out = flows.filter((f) => f.from === n.id).map((f) => `      <bpmn:outgoing>${f.id}</bpmn:outgoing>`);
  const docs = n.docs.length ? [`      <bpmn:documentation>${esc(n.docs.join("\n"))}</bpmn:documentation>`] : [];
  return [`    <bpmn:${n.type} id="${n.id}" name="${esc(n.name)}">`, ...docs, ...inc, ...out, `    </bpmn:${n.type}>`].join("\n");
};
const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_${slug(job.name)}" targetNamespace="urn:ui-extract">`,
  `  <bpmn:process id="${proc}" name="${esc(job.name)}" isExecutable="false">`,
  ...nodes.map(xmlNode),
  ...flows.map((f) => `    <bpmn:sequenceFlow id="${f.id}" sourceRef="${f.from}" targetRef="${f.to}"${f.name ? ` name="${f.name}"` : ""} />`),
  "  </bpmn:process>",
  "</bpmn:definitions>",
  "",
].join("\n");

const file = `${slug(job.name).replace(/_/g, "-")}.bpmn`;
mkdirSync(join(outDir, "forms"), { recursive: true });
writeFileSync(join(outDir, file), xml);
for (const b of bindings) copyFileSync(join(pkgDir, "ui", "forms", `${b.form}.form`), join(outDir, b.ref));
const nameOf = (id) => nodes.find((n) => n.id === id).name;
const yaml = [
  `name: ${job.name}`,
  `entry: ${file}`,
  bindings.length ? "bindings:" : "bindings: []",
  ...bindings.flatMap((b) => [`  - kind: form`, `    ref: ${b.ref}`, `    element: ${b.element}`, `    name: ${JSON.stringify(nameOf(b.element))}`]),
  "roles:",
  ...roles.flatMap((r) => [`  - element: ${r.element}`, `    role: ${r.role}`, `    name: ${JSON.stringify(nameOf(r.element))}`]),
  "",
].join("\n");
writeFileSync(join(outDir, "package.yaml"), yaml);
console.log(JSON.stringify({ file: join(outDir, file), nodes: nodes.length, flows: flows.length, forms: bindings.map((b) => b.ref) }));
