#!/usr/bin/env node
// @ts-check
// Foreground mock site for humans (`npm run mocks`): same launcher + generated
// inheriting config as `serve_mock_site`, stdio inherited, Ctrl-C stops it.
//   node <pkg>/src/mock-site/serve-cli.mjs [--port 5299] [--lan]
// See change: add-mock-site-exact-env (design D1, D12).
import { spawn } from "node:child_process";
import { findProjectRoot } from "./cli.mjs";
import { prepareMockSite } from "./env.mjs";

const argv = process.argv.slice(2);
const i = argv.indexOf("--port");
const port = i >= 0 ? Number(argv[i + 1]) : 5299;
const lan = argv.includes("--lan");
const root = findProjectRoot(process.cwd());
const prep = await prepareMockSite(root);
if (!prep.ok) {
  process.stderr.write(`mock-site: ${prep.error}\n`);
  process.exit(1);
}
process.stdout.write(`mock-site: launcher ${prep.launcher} (${prep.source}), app config ${prep.config}\n`);
const child = spawn(process.execPath, [prep.launcher, "--config", prep.generated, "--port", String(port), "--strictPort"], {
  cwd: root,
  env: { ...process.env, MOCK_SITE_LAN: lan ? "1" : "0" },
  stdio: "inherit",
});
for (const s of /** @type {const} */ (["SIGINT", "SIGTERM"])) process.on(s, () => child.kill(s));
child.on("exit", (code) => process.exit(code ?? 0));
