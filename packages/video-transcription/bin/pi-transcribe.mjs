#!/usr/bin/env node
// pi-transcribe launcher: run src/bin/transcribe.ts through tsx.
// A raw-TS bin does not run from a shell: bare node cannot resolve the
// ".js" import specifiers to ".ts" sources (ERR_MODULE_NOT_FOUND). tsx can.
// Arguments, stdio, exit code and signals pass through.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "bin", "transcribe.ts");

let tsxCli;
try {
  tsxCli = join(dirname(createRequire(import.meta.url).resolve("tsx/package.json")), "dist", "cli.mjs");
} catch {
  console.error("pi-transcribe: tsx not found. Install it: npm install -g tsx (or run via npx tsx " + entry + ")");
  process.exit(1);
}

const child = spawn(process.execPath, [tsxCli, entry, ...process.argv.slice(2)], { stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 1)));
