/**
 * deck3d CLI entry — `parse | validate | render | build | check | snapshot`,
 * plus the `fx` and `props` sub-trees.
 *
 * Exit codes: 0 success, 1 failure (with a one-line reason on stderr), 2 usage.
 * `render`/`build`/`check`/`snapshot`/`fx`/`props` land with their modules
 * (sections 4-7d); `parse` and `validate` are browser-free and live here.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { formatIssue, validate } from "./ir/validate.js";
import { type DeriveOptions, parseDeck } from "./parse/derive.js";

export const VERSION = "0.1.0";

export interface CliIO {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export const defaultIO: CliIO = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

export const HELP = `deck3d — deterministic markdown → self-contained 3D presentation

Usage: deck3d <command> [options]

Commands:
  parse <deck.md> [-o deck.json] [--fresh]   Markdown (+ mermaid) → Deck IR
  validate <deck.json>                       Schema + derived-edit checks
  render <deck.json> -o deck.html            Deck IR → self-contained HTML
  build <deck.md> -o deck.html               parse → render (writes .json beside it)
  check <deck.html>                          Measure fit/legibility in headless chromium
  snapshot <deck.html> [--slide n] [-o png]  Screenshot a slide to PNG
  fx <list|preview>                          Inspect the effects corpus
  props <search|fetch|generate>              Illustrate slides with glTF models

Options:
  -h, --help                                 Show this help
  -v, --version                              Print the version
`;

interface Flags {
  positional: string[];
  bool: Set<string>;
  value: Record<string, string>;
}

function parseArgs(args: string[]): Flags {
  const flags: Flags = { positional: [], bool: new Set(), value: {} };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-o" || arg === "--out" || arg === "--viewport" || arg === "--slide") {
      const key = arg === "-o" ? "out" : arg.replace(/^--?/, "");
      flags.value[key] = args[++i] ?? "";
    } else if (arg.startsWith("-")) {
      flags.bool.add(arg.replace(/^--?/, ""));
    } else {
      flags.positional.push(arg);
    }
  }
  return flags;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function cmdParse(args: string[], io: CliIO): Promise<number> {
  const flags = parseArgs(args);
  const mdPath = flags.positional[0];
  if (!mdPath) {
    io.stderr("deck3d parse: missing <deck.md>");
    return 2;
  }
  const outPath = flags.value.out ?? `${mdPath.replace(/\.md$/i, "")}.json`;
  const source = readFileSync(mdPath, "utf8");

  const opts: DeriveOptions = { source: mdPath };
  if (flags.bool.has("fresh")) opts.fresh = true;
  else if (existsSync(outPath)) {
    try {
      opts.previous = JSON.parse(readFileSync(outPath, "utf8"));
    } catch {
      // A corrupt prior file is not fatal for parse — start fresh.
    }
  }
  if (source.includes("```mermaid")) {
    const { harvestDiagram } = await import("./parse/harvest/index.js");
    opts.harvest = (mermaidSource, slideId) => harvestDiagram(mermaidSource, slideId);
  }

  try {
    const { ir, warnings } = await parseDeck(source, opts);
    for (const warning of warnings) io.stderr(warning);
    writeJson(outPath, ir);
    io.stdout(`wrote ${outPath}`);
    return 0;
  } catch (err) {
    io.stderr(`deck3d parse: ${(err as Error).message}`);
    return 1;
  }
}

function cmdValidate(args: string[], io: CliIO): number {
  const file = parseArgs(args).positional[0];
  if (!file) {
    io.stderr("deck3d validate: missing <deck.json>");
    return 2;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    io.stderr(`deck3d validate: invalid JSON in ${file}: ${(err as Error).message}`);
    return 1;
  }
  const result = validate(parsed);
  for (const issue of result.errors) io.stderr(formatIssue("error", issue));
  for (const warning of result.warnings) io.stderr(formatIssue("warn", warning));
  if (result.errors.length === 0) io.stdout(`${file}: valid`);
  return result.ok ? 0 : 1;
}

export async function run(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
    case "-h":
    case "--help":
    case "help":
      io.stdout(HELP);
      return 0;
    case "-v":
    case "--version":
    case "version":
      io.stdout(VERSION);
      return 0;
    case "parse":
      return cmdParse(rest, io);
    case "validate":
      return cmdValidate(rest, io);
    default:
      io.stderr(`deck3d: unknown command '${command}' (try --help)`);
      return 2;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  process.exit(await run(process.argv.slice(2)));
}
