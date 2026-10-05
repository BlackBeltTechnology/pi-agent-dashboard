#!/usr/bin/env node
// CLI for the rebuild-package-diagrams skill (Node >= 20, no deps).
//   extract-model <model.md>                 -> JSON {entities:[...]} on stdout
//   render-er <er.json> <model.json>         -> Mermaid erDiagram on stdout; exit 1 + violations on stderr
//   check-trace <file.bpmn> <packageDir>     -> exit 1 when a flow node lacks a resolvable package ref
//   check-use-cases <packageDir>             -> exit 1 when diagrams/use-cases.json does not resolve
//   build-site <packageDir> <out.html> [--bpmn-js f] [--bpmn-css f]... [--mermaid f] -> one self-contained HTML
//   ifml <packageDir> <out.xmi>              -> IFML 1.0 XMI of ui/ (exit 2 without UI model, 1 if non-conforming)
//   check-ifml <file.xmi>                    -> exit 1 listing IFML metamodel violations
// Exit 2 on bad usage / unreadable input. See change: add-rebuild-package-diagrams, add-catalog-ifml.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildIfml, checkIfmlXmi, ifmlToXmi } from "./ifml.mjs";
import { checkTrace, checkUseCases, extractModel, readUi, renderEr } from "./lib.mjs";
import { buildCatalog, packageTitle, renderSite } from "./site.mjs";

const USAGE = `usage:
  diagrams.mjs extract-model <model.md>
  diagrams.mjs render-er <er.json> <model.json>
  diagrams.mjs check-trace <file.bpmn> <packageDir>
  diagrams.mjs check-use-cases <packageDir>
  diagrams.mjs build-site <packageDir> <out.html> [--bpmn-js <file>] [--bpmn-css <file>]... [--mermaid <file>]
  diagrams.mjs ifml <packageDir> <out.xmi>
  diagrams.mjs check-ifml <file.xmi>`;

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
  const libs = { bpmnJs: "", bpmnCss: [], mermaid: "" };
  for (let i = 0; i < args.length; i += 2) {
    const [flag, file] = [args[i], args[i + 1]];
    if (!file) die(USAGE);
    if (flag === "--bpmn-js") libs.bpmnJs = readText(file);
    else if (flag === "--bpmn-css") libs.bpmnCss.push(readText(file));
    else if (flag === "--mermaid") libs.mermaid = readText(file);
    else die(USAGE);
  }
  return libs;
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
  "build-site": ([pkg, out, ...rest]) => {
    if (!out) die(USAGE);
    const libs = parseLibs(rest);
    readText(join(pkg, "model.md"));
    const { data, errors } = buildCatalog(pkg);
    if (errors.length) return report(errors);
    writeFileSync(out, renderSite(data, libs));
    return 0;
  },
  ifml: ([pkg, out]) => {
    const ui = readUi(pkg);
    if (!ui.screens.length) die(`diagrams: no UI model (ui/screens/*.json) in ${pkg}`);
    const xmi = ifmlToXmi(buildIfml(ui), packageTitle(pkg));
    const errors = checkIfmlXmi(xmi);
    if (!errors.length) writeFileSync(out, xmi);
    return report(errors);
  },
  "check-ifml": ([file]) => report(checkIfmlXmi(readText(file))),
};

const ARITY = { "extract-model": 1, "render-er": 2, "check-trace": 2, "check-use-cases": 1, "build-site": 2, ifml: 2, "check-ifml": 1 };

function main([cmd, ...args]) {
  if (!COMMANDS[cmd] || args.length < ARITY[cmd]) die(USAGE);
  return COMMANDS[cmd](args);
}

// exitCode (not process.exit) so piped stdout > 64 KB is fully flushed.
process.exitCode = main(process.argv.slice(2));
