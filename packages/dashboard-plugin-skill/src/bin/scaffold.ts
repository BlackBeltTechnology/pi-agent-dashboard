#!/usr/bin/env node
/**
 * Bin entry: read JSON answers from stdin, render templates to disk.
 *
 * Usage (the SKILL.md drives this from a pi session):
 *   echo '{ "mode": "new", "id": "acme", ... }' | pi-dashboard-plugin-scaffold
 *   pi-dashboard-plugin-scaffold --write-project-id <abs-folder> <id>
 *
 * `--write-project-id` merges the id into `<folder>/.pi/dashboard/project.json`
 * (project-specific app scope), only after the final summary confirm; it prints
 * one JSON result line and exits 1 on a refusal.
 * See change: add-project-scoped-apps.
 */
import * as fs from "node:fs";
import { writeProjectId } from "../project-identity.js";
import type { Answers } from "../render.js";
import { FsSink, render } from "../render.js";

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "--write-project-id") {
    const [, folder, id] = argv;
    if (!folder || !id) {
      console.error("usage: pi-dashboard-plugin-scaffold --write-project-id <abs-folder> <id>");
      process.exit(2);
    }
    const result = writeProjectId(folder, id);
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  }

  const raw = (await readStdin()).trim();
  if (!raw) {
    console.error("usage: echo '<answers-json>' | pi-dashboard-plugin-scaffold");
    process.exit(2);
  }

  let answers: Answers;
  try {
    answers = JSON.parse(raw) as Answers;
  } catch (err) {
    console.error("invalid JSON answers on stdin:", (err as Error).message);
    process.exit(2);
  }

  if (!answers.outDir) {
    console.error("answers.outDir is required");
    process.exit(2);
  }

  // For new mode, refuse to overwrite existing dir.
  if (answers.mode === "new" && fs.existsSync(answers.outDir)) {
    console.error(`outDir already exists: ${answers.outDir}`);
    process.exit(1);
  }

  const sink = new FsSink(answers.outDir);
  try {
    render(answers, sink);
  } catch (err) {
    // Invalid input (e.g. an app scope) is reported in full; nothing was written.
    console.error((err as Error).message);
    process.exit(1);
  }

  console.log(`scaffold complete: ${answers.outDir}`);
}

void main();
