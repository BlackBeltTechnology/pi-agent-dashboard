#!/usr/bin/env node
// Plain-JS shim: runs src/cli.ts through tsx, the way the workspace's other tsx
// tools do. packages/shared's `./*.js` export map resolves to `.ts` only under
// tsx. See change: add-memory-eval-tier-r (design M1).
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const r = spawnSync(process.execPath, [tsxCli, resolve(root, "src/cli.ts"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --experimental-sqlite`.trim() },
});
process.exit(r.status ?? 1);
