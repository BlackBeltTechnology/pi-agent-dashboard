/**
 * deck3d CLI entry — `parse | validate | render | build | check | snapshot`,
 * plus the `fx` and `props` sub-trees.
 *
 * Exit codes: 0 success, 1 failure (with a one-line reason on stderr), 2 usage.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import type { DeckIR } from "./ir/types.js";
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

function defaultJsonPath(mdPath: string): string {
  return `${mdPath.replace(/\.md$/i, "")}.json`;
}

/** Shared parse: markdown (+ mermaid harvest when present) → IR on disk. */
async function parseToFile(mdPath: string, outPath: string, flags: Flags, io: CliIO): Promise<number> {
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
  const { ir, warnings } = await parseDeck(source, opts);
  for (const warning of warnings) io.stderr(warning);
  writeJson(outPath, ir);
  return 0;
}

async function cmdParse(args: string[], io: CliIO): Promise<number> {
  const flags = parseArgs(args);
  const mdPath = flags.positional[0];
  if (!mdPath) {
    io.stderr("deck3d parse: missing <deck.md>");
    return 2;
  }
  const outPath = flags.value.out ?? defaultJsonPath(mdPath);
  try {
    const code = await parseToFile(mdPath, outPath, flags, io);
    io.stdout(`wrote ${outPath}`);
    return code;
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

/** Load + validate a deck.json; returns undefined on failure (already reported). */
function loadValidated(file: string, io: CliIO): DeckIR | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    io.stderr(`deck3d: invalid JSON in ${file}: ${(err as Error).message}`);
    return undefined;
  }
  const result = validate(parsed);
  if (!result.ok) {
    for (const issue of result.errors) io.stderr(formatIssue("error", issue));
    return undefined;
  }
  return parsed as DeckIR;
}

async function renderFile(jsonPath: string, outPath: string, io: CliIO): Promise<number> {
  const ir = loadValidated(jsonPath, io);
  if (!ir) return 1;
  const { ensureRuntime, renderDeck, fontBase64 } = await import("./render/index.js");
  const runtime = await ensureRuntime();
  const html = renderDeck(ir, { runtime, font: fontBase64(), title: basename(jsonPath, ".json") });
  writeFileSync(outPath, html);
  return 0;
}

async function cmdRender(args: string[], io: CliIO): Promise<number> {
  const flags = parseArgs(args);
  const jsonPath = flags.positional[0];
  if (!jsonPath) {
    io.stderr("deck3d render: missing <deck.json>");
    return 2;
  }
  const outPath = flags.value.out ?? jsonPath.replace(/\.json$/i, ".html");
  try {
    const code = await renderFile(jsonPath, outPath, io);
    if (code === 0) io.stdout(`wrote ${outPath}`);
    return code;
  } catch (err) {
    io.stderr(`deck3d render: ${(err as Error).message}`);
    return 1;
  }
}

async function cmdBuild(args: string[], io: CliIO): Promise<number> {
  const flags = parseArgs(args);
  const mdPath = flags.positional[0];
  if (!mdPath) {
    io.stderr("deck3d build: missing <deck.md>");
    return 2;
  }
  const outPath = flags.value.out ?? mdPath.replace(/\.md$/i, ".html");
  try {
    await parseToFile(mdPath, defaultJsonPath(mdPath), flags, io);
    const code = await renderFile(defaultJsonPath(mdPath), outPath, io);
    if (code === 0) io.stdout(`wrote ${outPath}`);
    return code;
  } catch (err) {
    io.stderr(`deck3d build: ${(err as Error).message}`);
    return 1;
  }
}

async function cmdSnapshot(args: string[], io: CliIO): Promise<number> {
  const flags = parseArgs(args);
  const html = flags.positional[0];
  if (!html) {
    io.stderr("deck3d snapshot: missing <deck.html>");
    return 2;
  }
  const out = flags.value.out ?? "snapshot.png";
  const slide = flags.value.slide ? Number.parseInt(flags.value.slide, 10) : 1;
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page.goto(`${pathToFileURL(html).href}#${slide}`);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => window.__deck3d?.ready());
      await page.waitForTimeout(400);
      await page.screenshot({ path: out });
    } finally {
      await browser.close();
    }
    io.stdout(`wrote ${out}`);
    return 0;
  } catch (err) {
    io.stderr(`deck3d snapshot: ${(err as Error).message}`);
    return 1;
  }
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
    case "render":
      return cmdRender(rest, io);
    case "build":
      return cmdBuild(rest, io);
    case "snapshot":
      return cmdSnapshot(rest, io);
    default:
      io.stderr(`deck3d: unknown command '${command}' (try --help)`);
      return 2;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  process.exit(await run(process.argv.slice(2)));
}
