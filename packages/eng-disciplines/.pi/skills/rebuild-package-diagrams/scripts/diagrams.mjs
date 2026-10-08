#!/usr/bin/env node
// CLI for the rebuild-package-diagrams skill (Node >= 20, no deps).
//   extract-model <model.md>                 -> JSON {entities:[...]} on stdout
//   render-er <er.json> <model.json>         -> Mermaid erDiagram on stdout; exit 1 + violations on stderr
//   check-trace <file.bpmn> <packageDir>     -> exit 1 when a flow node lacks a resolvable package ref
//   check-use-cases <packageDir>             -> exit 1 when diagrams/use-cases.json does not resolve
//   build-site <packageDir> <out.html> [--bpmn-js f] [--bpmn-css f]... [--mermaid f] -> one self-contained HTML
//   ifml <packageDir> <out.xmi>              -> IFML 1.0 XMI of ui/ (exit 2 without UI model, 1 if non-conforming)
//   check-ifml <file.xmi>                    -> exit 1 listing IFML metamodel violations
//   ifml-to-ui <file.xmi> <outDir>           -> ui/screens + ui/forms from any IFML XMI
//   ifml-diff <packageDir> <file.xmi> [--apply] -> element diff vs the package UI model (exit 1 if different);
//                                               --apply merges additions/renames/guards/validations, never deletes
//   check-sequences | check-states <packageDir> [--app <appDir>] -> exit 1 listing behaviour-record violations
//   check-objects <packageDir> [--local]      -> exit 1 listing object-diagram violations
//   sequence-from-ui <packageDir> <SCR#ACT> <out.json> -> deterministic draft sequence of a UI action
//   objects-synth <packageDir> <Entity> <out.json> [--depth n] [--fanout n] -> synthetic object diagram
//   objects-from-db <packageDir> <job.json> <out.json> -> masked object diagram from a JSON DB snapshot
//   behaviour <packageDir> <outDir>          -> <id>.mmd per diagram (+ <id>.collab.mmd, <id>.part-<n>.mmd) and <id>.scxml per state machine
//   ifml-parts <packageDir> <outDir>         -> overview.mmd + <part>.xmi per IFML part
//   check-size <packageDir> [--strict]       -> size of every diagram and its split; --strict: exit 1 if a part is over budget
//   crud-draft <packageDir> <SCR-id> <out.json> -> write/read/export effects of a screen with entity candidates
//   check-crud <packageDir> [--complete]     -> exit 1 listing CRUD-record violations (--complete: every screen with data effects)
//   crud <packageDir> <outDir>               -> crud.csv (entity x use case), crud-screens.csv, crud-findings.md
//   uc-link-draft <packageDir> <UC-id> <out.json> -> BPMN steps + UI actions sharing refs with the use case
//   check-uc-links <packageDir> [--complete] -> exit 1 listing use-case link violations (--complete: every use case)
//   variability-draft <packageDir> <out.json> -> config paths read by code x value per variant (ui/_config-reads.json)
//   check-variability <packageDir> <appDir> [--complete] -> exit 1 listing feature violations (--complete: every varying path)
//   variability <packageDir> <outDir>        -> variability.csv, variability-customers.csv, variability-findings.md, feature-model.xml
//   usage-draft <packageDir> <appDir> <job.json> <out.json> -> log types with counts per customer + code candidates
//   check-usage <packageDir> <appDir> <job.json> [--complete] -> exit 1 listing log-type mapping violations
//   usage <packageDir> <job.json> <outDir>   -> LOCAL usage.json, usage-findings.md, usage-by-usecase.csv (pseudonymized)
//   check-usage-output <dir> <job.json>      -> exit 1 when an output file contains a source value
//   build-site / behaviour / ifml-parts / check-size take [--max-nodes n] [--max-edges n] (default 30 / 40)
// Exit 2 on bad usage / unreadable input. See change: add-rebuild-package-diagrams, add-catalog-ifml, add-behaviour-diagrams.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { checkArch, readArch, toMermaidC4, toStructurizr } from "./arch.mjs";
import { behaviourData, checkObjects, checkSequences, checkStates, objectsFromDb, objectsSynth, readBehaviour, sequenceFromUi } from "./behaviour.mjs";
import { checkCrud, crudCsv, crudDraft, findingsMd, readCrud } from "./crud.mjs";
import { buildIfml, checkIfmlXmi, ifmlIdErrors, ifmlToXmi, parseIfmlXmi } from "./ifml.mjs";
import { applyUi, diffGraphs, graphToUi, writeUi } from "./ifml-import.mjs";
import { checkTrace, checkUi, checkUseCases, csvRows, extractModel, readUi, renderEr } from "./lib.mjs";
import { checkLinks, linkDraft, readLinks, useCasesWithXml } from "./links.mjs";
import { buildCatalog, packageTitle, renderSite } from "./site.mjs";
import { budgetOf, ifmlParts, sizeReport } from "./split.mjs";
import { aggregateUsage, checkUsage, ignoreLocal, jobEvents, leakErrors, mappingLeakErrors, readJob, readMapping, sourceSecrets, typeProblems, usageDraft, usageMd } from "./usage.mjs";
import { checkVariability, customersCsv, featureModelXml, readConfigInputs, readVariability, variabilityDraft, variabilityMd, variantsCsv } from "./variability.mjs";

const USAGE = `usage:
  diagrams.mjs extract-model <model.md>
  diagrams.mjs render-er <er.json> <model.json>
  diagrams.mjs check-trace <file.bpmn> <packageDir>
  diagrams.mjs check-use-cases <packageDir>
  diagrams.mjs build-site <packageDir> <out.html> [--bpmn-js <file>] [--bpmn-css <file>]... [--mermaid <file>]
  diagrams.mjs ifml <packageDir> <out.xmi>
  diagrams.mjs check-ifml <file.xmi>
  diagrams.mjs ifml-to-ui <file.xmi> <outDir>
  diagrams.mjs ifml-diff <packageDir> <file.xmi> [--apply]
  diagrams.mjs check-architecture <packageDir> [--app <appDir>]
  diagrams.mjs arch <packageDir> <outDir>
  diagrams.mjs check-sequences|check-states <packageDir> [--app <appDir>]
  diagrams.mjs check-objects <packageDir> [--local]
  diagrams.mjs sequence-from-ui <packageDir> <SCR-id#ACT-id> <out.json>
  diagrams.mjs objects-synth <packageDir> <Entity> <out.json> [--depth <n>] [--fanout <n>]
  diagrams.mjs objects-from-db <packageDir> <job.json> <out.json>
  diagrams.mjs behaviour <packageDir> <outDir>
  diagrams.mjs ifml-parts <packageDir> <outDir>
  diagrams.mjs check-size <packageDir> [--strict]
  diagrams.mjs crud-draft <packageDir> <SCR-id> <out.json>
  diagrams.mjs check-crud <packageDir> [--complete]
  diagrams.mjs crud <packageDir> <outDir>
  diagrams.mjs uc-link-draft <packageDir> <UC-id> <out.json>
  diagrams.mjs check-uc-links <packageDir> [--complete]
  diagrams.mjs variability-draft <packageDir> <out.json>
  diagrams.mjs check-variability <packageDir> <appDir> [--complete]
  diagrams.mjs variability <packageDir> <outDir>
  diagrams.mjs usage-draft <packageDir> <appDir> <job.json> <out.json>
  diagrams.mjs check-usage <packageDir> <appDir> <job.json> [--complete]
  diagrams.mjs usage <packageDir> <job.json> <outDir>
  diagrams.mjs check-usage-output <dir> <job.json>
  build-site also takes [--ifml-js <file>] [--ifml-css <file>]... [--local]
  build-site, behaviour, ifml-parts, check-size take [--max-nodes <n>] [--max-edges <n>] (default 30 / 40)`;

/** Split budget flags off argv: {budget, rest}; bad value is bad usage. */
function takeBudget(args) {
  let budget;
  try {
    budget = budgetOf(args);
  } catch (e) {
    die(`diagrams: ${e.message}`);
  }
  const rest = args.filter((a, i) => !["--max-nodes", "--max-edges"].includes(a) && !["--max-nodes", "--max-edges"].includes(args[i - 1]));
  return { budget, rest };
}

/** `--app <dir>` (or nothing) -> appDir; anything else is bad usage. */
function appFlag(flag, app) {
  if (flag && (flag !== "--app" || !app)) die(USAGE);
  return app ?? null;
}

/** Record id from its output file (`OBJ-x.json` -> `OBJ-x`). */
const idOf = (out) => basename(out).replace(/\.json$/, "");

/** Write a JSON record, creating its directory. */
function writeRecord(out, record) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(record, null, 1)}\n`);
}

function die(msg, code = 2) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

function readText(path) {
  if (!existsSync(path)) die(`diagrams: not found: ${path}`);
  return readFileSync(path, "utf8");
}

function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch (e) {
    return die(`diagrams: invalid JSON: ${path}: ${e.message}`);
  }
}

/** Print violations; return the exit code. */
function report(errors) {
  if (errors.length) process.stderr.write(`${errors.join("\n")}\n`);
  return errors.length ? 1 : 0;
}

function parseLibs(args) {
  const libs = { bpmnJs: "", bpmnCss: [], mermaid: "", ifmlJs: "", ifmlCss: [] };
  for (let i = 0; i < args.length; i += 2) {
    const [flag, file] = [args[i], args[i + 1]];
    if (!file) die(USAGE);
    if (flag === "--bpmn-js") libs.bpmnJs = readText(file);
    else if (flag === "--bpmn-css") libs.bpmnCss.push(readText(file));
    else if (flag === "--mermaid") libs.mermaid = readText(file);
    else if (flag === "--ifml-js") libs.ifmlJs = readText(file);
    else if (flag === "--ifml-css") libs.ifmlCss.push(readText(file));
    else die(USAGE);
  }
  return libs;
}

/** Events of a usage job, or the source-reading errors (malformed CSV rows) as gate lines. */
function loadEvents(job) {
  try {
    return { events: jobEvents(job), errors: [] };
  } catch (e) {
    return { events: [], errors: [e.message] };
  }
}

const COMMANDS = {
  "extract-model": ([model]) => {
    process.stdout.write(`${JSON.stringify(extractModel(readText(model)), null, 1)}\n`);
    return 0;
  },
  "render-er": ([er, model]) => {
    const { errors, mermaid } = renderEr(readJson(er), readJson(model));
    if (!errors.length) process.stdout.write(mermaid);
    return report(errors);
  },
  "check-trace": ([bpmn, pkg]) => {
    if (!existsSync(pkg)) die(`diagrams: not found: ${pkg}`);
    return report(checkTrace(readText(bpmn), pkg));
  },
  "check-use-cases": ([pkg]) => {
    const useCases = readJson(join(pkg, "diagrams", "use-cases.json"));
    return report(checkUseCases(pkg, useCases, extractModel(readText(join(pkg, "model.md")))));
  },
  "build-site": ([pkg, out, ...args]) => {
    if (!out) die(USAGE);
    const { budget, rest } = takeBudget(args);
    const local = rest.includes("--local");
    const libs = parseLibs(rest.filter((a) => a !== "--local"));
    readText(join(pkg, "model.md"));
    const { data, errors } = buildCatalog(pkg, { local, budget });
    if (errors.length) return report(errors);
    writeFileSync(out, renderSite(data, libs));
    return 0;
  },
  ifml: ([pkg, out]) => {
    const ui = readUi(pkg);
    if (!ui.screens.length) die(`diagrams: no UI model (ui/screens/*.json) in ${pkg}`);
    const idErrors = ifmlIdErrors(ui);
    if (idErrors.length) return report(idErrors);
    const xmi = ifmlToXmi(buildIfml(ui), packageTitle(pkg));
    const errors = checkIfmlXmi(xmi);
    if (!errors.length) writeFileSync(out, xmi);
    return report(errors);
  },
  "check-ifml": ([file]) => report(checkIfmlXmi(readText(file))),
  "ifml-to-ui": ([file, outDir]) => {
    const xml = readText(file);
    const errors = checkIfmlXmi(xml);
    if (errors.length) return report(errors);
    writeUi(outDir, graphToUi(parseIfmlXmi(xml)));
    return 0;
  },
  "check-architecture": ([pkg, flag, app]) => {
    if (flag && (flag !== "--app" || !app)) die(USAGE);
    const model = readArch(pkg);
    if (!model) die(`diagrams: no diagrams/architecture.json in ${pkg}`);
    return report(checkArch(pkg, model, app ?? null));
  },
  arch: ([pkg, outDir]) => {
    const model = readArch(pkg);
    if (!model) die(`diagrams: no diagrams/architecture.json in ${pkg}`);
    const errors = checkArch(pkg, model);
    if (errors.length) return report(errors);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "workspace.dsl"), toStructurizr(model, packageTitle(pkg)));
    writeFileSync(join(outDir, "c4.md"), toMermaidC4(model, packageTitle(pkg)));
    return 0;
  },
  "check-sequences": ([pkg, flag, app]) => report(checkSequences(pkg, readBehaviour(pkg).sequences, appFlag(flag, app))),
  "check-states": ([pkg, flag, app]) => report(checkStates(pkg, readBehaviour(pkg).states, appFlag(flag, app))),
  "check-objects": ([pkg, flag]) => {
    if (flag && flag !== "--local") die(USAGE);
    return report(checkObjects(pkg, readBehaviour(pkg, { local: !!flag }).objects));
  },
  "sequence-from-ui": ([pkg, ref, out]) => {
    let seq;
    try {
      seq = sequenceFromUi(pkg, ref);
    } catch (e) {
      return report([e.message]);
    }
    const errors = checkSequences(pkg, [seq]);
    if (!errors.length) writeRecord(out, seq);
    return report(errors);
  },
  "objects-synth": ([pkg, entity, out, ...opts]) => {
    const num = (f, d) => (opts.includes(f) ? Number(opts[opts.indexOf(f) + 1]) : d);
    let o;
    try {
      o = { ...objectsSynth(pkg, entity, { depth: num("--depth", 2), fanout: num("--fanout", 2) }), id: idOf(out) };
    } catch (e) {
      return report([e.message]);
    }
    const errors = checkObjects(pkg, [o]);
    if (!errors.length) writeRecord(out, o);
    return report(errors);
  },
  "objects-from-db": ([pkg, jobFile, out]) => {
    const job = readJson(jobFile);
    if (job.source && !isAbsolute(job.source)) job.source = resolve(dirname(jobFile), job.source);
    if (!existsSync(job.source || "")) die("diagrams: job source not found");
    const { errors, diagram } = objectsFromDb(pkg, job);
    if (errors.length) return report(errors);
    diagram.id = job.id || idOf(out);
    const gate = checkObjects(pkg, [diagram]);
    if (!gate.length) writeRecord(out, diagram);
    return report(gate);
  },
  behaviour: ([pkg, outDir, ...args]) => {
    const { budget } = takeBudget(args);
    const { errors, behaviour } = behaviourData(pkg, { budget });
    if (errors.length) return report(errors);
    mkdirSync(outDir, { recursive: true });
    for (const s of behaviour.sequences) {
      writeFileSync(join(outDir, `${s.id}.mmd`), s.mermaid);
      writeFileSync(join(outDir, `${s.id}.collab.mmd`), s.collab.mermaid);
      for (const p of s.parts || []) writeFileSync(join(outDir, `${s.id}.part-${p.n}.mmd`), p.mermaid);
    }
    for (const m of behaviour.states) {
      writeFileSync(join(outDir, `${m.id}.mmd`), m.mermaid);
      writeFileSync(join(outDir, `${m.id}.scxml`), m.scxml);
    }
    for (const o of behaviour.objects) writeFileSync(join(outDir, `${o.id}.mmd`), o.mermaid);
    return 0;
  },
  "ifml-parts": ([pkg, outDir, ...args]) => {
    const { budget } = takeBudget(args);
    const ui = readUi(pkg);
    if (!ui.screens.length) die(`diagrams: no UI model (ui/screens/*.json) in ${pkg}`);
    const idErrors = ifmlIdErrors(ui);
    if (idErrors.length) return report(idErrors);
    const split = ifmlParts(ui, budget, packageTitle(pkg));
    const errors = split.parts.flatMap((p) => checkIfmlXmi(p.xmi).map((e) => `${p.id}: ${e}`));
    if (errors.length) return report(errors);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "overview.mmd"), split.overview.mermaid);
    for (const p of split.parts) writeFileSync(join(outDir, `${p.id}.xmi`), p.xmi);
    return 0;
  },
  "check-size": ([pkg, ...args]) => {
    const { budget, rest } = takeBudget(args);
    if (rest.some((a) => a !== "--strict")) die(USAGE);
    const { data, errors } = buildCatalog(pkg, { budget });
    if (errors.length) return report(errors);
    const { lines, over } = sizeReport({ ui: data.ui, behaviour: readBehaviour(pkg), er: data.er.clusters }, budget, data.meta.title);
    process.stdout.write(`budget: ${budget.nodes} nodes, ${budget.edges} edges\n${lines.join("\n")}\n${over} over budget\n`);
    return rest.includes("--strict") && over ? 1 : 0;
  },
  "crud-draft": ([pkg, screen, out]) => {
    try {
      writeRecord(out, crudDraft(readUi(pkg), extractModel(readText(join(pkg, "model.md"))), screen));
    } catch (e) {
      return report([e.message]);
    }
    return 0;
  },
  "check-crud": ([pkg, flag]) => {
    if (flag && flag !== "--complete") die(USAGE);
    const records = readCrud(pkg);
    if (!records) die(`diagrams: no diagrams/crud in ${pkg}`);
    return report(checkCrud(readUi(pkg), extractModel(readText(join(pkg, "model.md"))), records, { complete: !!flag }));
  },
  crud: ([pkg, outDir]) => {
    if (!readCrud(pkg)) die(`diagrams: no diagrams/crud in ${pkg}`);
    const { data, errors } = buildCatalog(pkg);
    if (errors.length) return report(errors);
    const c = data.crud;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "crud.csv"), crudCsv(c.byUseCase, c.useCases));
    writeFileSync(join(outDir, "crud-screens.csv"), crudCsv(c.byScreen, c.screens));
    writeFileSync(join(outDir, "crud-findings.md"), findingsMd(c.findings, data.meta.title));
    return 0;
  },
  "uc-link-draft": ([pkg, uc, out]) => {
    try {
      writeRecord(out, linkDraft(readUi(pkg), useCasesWithXml(pkg), uc));
    } catch (e) {
      return report([e.message]);
    }
    return 0;
  },
  "check-uc-links": ([pkg, flag]) => {
    if (flag && flag !== "--complete") die(USAGE);
    const records = readLinks(pkg);
    if (!records) die(`diagrams: no diagrams/uc-links in ${pkg}`);
    return report(checkLinks(readUi(pkg), useCasesWithXml(pkg), records, { complete: !!flag }));
  },
  "variability-draft": ([pkg, out]) => {
    const inputs = readConfigInputs(pkg);
    if (!inputs) return report([`no ui/_config-reads.json in ${pkg} (run config-reads.mjs)`]);
    if (inputs.missing.length) return report(inputs.missing.map((id) => `ui/_effective/${id}.json missing (run config.mjs for variant ${id})`));
    writeRecord(out, variabilityDraft(inputs));
    return 0;
  },
  "check-variability": ([pkg, app, flag]) => {
    if (flag && flag !== "--complete") die(USAGE);
    const rec = readVariability(pkg);
    if (!rec) die(`diagrams: no diagrams/variability/features.json in ${pkg}`);
    return report(checkVariability(pkg, readUi(pkg), readConfigInputs(pkg), rec, { appDir: app, complete: !!flag }));
  },
  variability: ([pkg, outDir]) => {
    if (!readVariability(pkg)) die(`diagrams: no diagrams/variability/features.json in ${pkg}`);
    const { data, errors } = buildCatalog(pkg);
    if (errors.length) return report(errors);
    const v = data.variability;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "variability.csv"), variantsCsv(v));
    writeFileSync(join(outDir, "variability-customers.csv"), customersCsv(v));
    writeFileSync(join(outDir, "variability-findings.md"), variabilityMd(v, data.meta.title));
    writeFileSync(join(outDir, "feature-model.xml"), featureModelXml(v, data.meta.title));
    return 0;
  },
  "usage-draft": ([pkg, app, jobFile, out]) => {
    const job = readJob(jobFile);
    const { events, errors } = loadEvents(job);
    if (errors.length) return report(errors);
    const problems = typeProblems(events, job).errors;
    if (problems.length) return report(problems);
    ignoreLocal(out);
    writeRecord(out, usageDraft(app, job, events));
    return 0;
  },
  "check-usage": ([pkg, app, jobFile, flag]) => {
    if (flag && flag !== "--complete") die(USAGE);
    if (!jobFile || jobFile.startsWith("--")) die(USAGE);
    const mapping = readMapping(pkg);
    if (!mapping) die(`diagrams: no diagrams/usage/mapping.json in ${pkg}`);
    const job = readJob(jobFile);
    const { events, errors } = loadEvents(job);
    if (errors.length) return report(errors);
    const { errors: problems, leaky } = typeProblems(events, job);
    const gate = checkUsage(readUi(pkg), useCasesWithXml(pkg), mapping, { appDir: app, events: flag ? events : null, complete: !!flag, leaky });
    return report([...problems, ...mappingLeakErrors(mapping, events, job), ...gate]);
  },
  usage: ([pkg, jobFile, outDir]) => {
    const mapping = readMapping(pkg);
    if (!mapping) die(`diagrams: no diagrams/usage/mapping.json in ${pkg}`);
    const { data, errors } = buildCatalog(pkg);
    if (errors.length) return report(errors);
    const u = aggregateUsage(jobEvents(readJob(jobFile)), mapping, data.ui, data.useCases);
    const ucs = data.useCases.map((x) => x.id);
    const custs = Object.keys(u.customers);
    mkdirSync(outDir, { recursive: true });
    ignoreLocal(outDir);
    writeFileSync(join(outDir, "usage.json"), `${JSON.stringify(u, null, 1)}\n`);
    writeFileSync(join(outDir, "usage-findings.md"), usageMd(u, data.meta.title));
    writeFileSync(join(outDir, "usage-by-usecase.csv"), csvRows([["use case", ...custs], ...ucs.map((id) => [id, ...custs.map((c) => u.customers[c].byUseCase[id] ?? 0)])]));
    return 0;
  },
  "check-usage-output": ([dir, jobFile]) => {
    const job = readJob(jobFile);
    return report(leakErrors(dir, sourceSecrets(jobEvents(job), { publicValues: job.publicValues })));
  },
  "ifml-diff": ([pkg, file, flag]) => {
    if (flag && flag !== "--apply") die(USAGE);
    const edited = parseIfmlXmi(readText(file));
    const idErrors = ifmlIdErrors(readUi(pkg));
    if (idErrors.length) return report(idErrors);
    const lines = diffGraphs(buildIfml(readUi(pkg)), edited);
    process.stdout.write(`${lines.length ? lines.join("\n") : "no differences"}\n`);
    if (!flag) return lines.length ? 1 : 0;
    applyUi(pkg, graphToUi(edited));
    const left = diffGraphs(buildIfml(readUi(pkg)), edited);
    process.stdout.write(`applied; remaining (deletions are never applied):\n${left.join("\n") || "none"}\n`);
    return report(checkUi(pkg, readUi(pkg)));
  },
};

const ARITY = { "extract-model": 1, "render-er": 2, "check-trace": 2, "check-use-cases": 1, "build-site": 2, ifml: 2, "check-ifml": 1, "ifml-to-ui": 2, "ifml-diff": 2, "check-architecture": 1, arch: 2, "check-sequences": 1, "check-states": 1, "check-objects": 1, "sequence-from-ui": 3, "objects-synth": 3, "objects-from-db": 3, behaviour: 2, "ifml-parts": 2, "check-size": 1, "crud-draft": 3, "uc-link-draft": 3, "check-uc-links": 1, "variability-draft": 2, "check-variability": 2, variability: 2, "usage-draft": 4, "check-usage": 3, usage: 3, "check-usage-output": 2, "check-crud": 1, crud: 2 };

function main([cmd, ...args]) {
  if (!COMMANDS[cmd] || args.length < ARITY[cmd]) die(USAGE);
  return COMMANDS[cmd](args);
}

// exitCode (not process.exit) so piped stdout > 64 KB is fully flushed.
process.exitCode = main(process.argv.slice(2));
