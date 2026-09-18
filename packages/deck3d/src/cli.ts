/**
 * deck3d CLI entry — `parse | validate | render | build | check | snapshot`,
 * plus the `fx` and `props` sub-trees.
 *
 * Section 7.1 owns the full surface (exit codes, one-line stderr reasons).
 * This entry establishes the dispatcher and the two flags every CLI must
 * honour. Subcommands are wired in as their modules land.
 */
import { pathToFileURL } from "node:url";

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
  parse <deck.md> [-o deck.json]   Markdown (+ mermaid) → Deck IR
  validate <deck.json>             Schema + derived-edit checks
  render <deck.json> -o deck.html  Deck IR → self-contained HTML
  build <deck.md> -o deck.html     parse → render (writes .json beside it)
  check <deck.html>                Measure fit/legibility in headless chromium
  snapshot <deck.html>             Screenshot a slide to PNG
  fx <list|preview>                Inspect the effects corpus
  props <search|fetch|generate>    Illustrate slides with glTF models

Options:
  -h, --help                       Show this help
  -v, --version                    Print the version
`;

export function run(argv: string[], io: CliIO = defaultIO): number {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help" || command === "help") {
    io.stdout(HELP);
    return 0;
  }
  if (command === "-v" || command === "--version" || command === "version") {
    io.stdout(VERSION);
    return 0;
  }
  io.stderr(`deck3d: unknown command '${command}' (try --help)`);
  void rest;
  return 2;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  process.exit(run(process.argv.slice(2)));
}
