#!/usr/bin/env node
// Thin launcher: run the TypeScript ensure CLI via tsx.
// The tool registry uses ".js" specifiers per repo convention, which bare
// node cannot resolve to ".ts" sources — tsx does.
// See change: add-skill-tool-provisioning (design D5).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "src", "tool-registry", "ensure-cli.ts");
const res = spawnSync("npx", ["tsx", entry, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(res.status ?? 1);
