#!/usr/bin/env node
// Thin launcher: run the TypeScript orchestrator via tsx.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "src", "main.ts");
const res = spawnSync("npx", ["tsx", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(res.status ?? 1);
