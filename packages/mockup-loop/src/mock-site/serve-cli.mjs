#!/usr/bin/env node
// @ts-check
// Foreground mock site for humans (`npm run mocks`): same launcher + generated
// inheriting config as `serve_mock_site`, stdio inherited, Ctrl-C stops it.
//   node <pkg>/src/mock-site/serve-cli.mjs [--port 5299] [--lan] [--base /some/prefix/]
// See change: add-mock-site-exact-env (design D1, D12).
import { spawn } from "node:child_process";
import { validateBase } from "./base.mjs";
import { findProjectRoot } from "./cli.mjs";
import { prepareMockSite } from "./env.mjs";

const argv = process.argv.slice(2);
const i = argv.indexOf("--port");
const port = i >= 0 ? Number(argv[i + 1]) : 5299;
if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 8000) {
  process.stderr.write(`mock-site: --port must be an integer 1-65535 other than the reserved 8000 (got ${argv[i + 1]})\n`);
  process.exit(2);
}
const lan = argv.includes("--lan");
const bi = argv.indexOf("--base");
const baseArg = bi >= 0 ? validateBase(argv[bi + 1]) : { ok: true, base: null };
if (!baseArg.ok) {
  process.stderr.write(`mock-site: ${baseArg.error}\n`);
  process.exit(2);
}
const root = findProjectRoot(process.cwd());
const prep = await prepareMockSite(root);
if (!prep.ok) {
  process.stderr.write(`mock-site: ${prep.error}\n`);
  process.exit(1);
}
process.stdout.write(`mock-site: launcher ${prep.launcher} (${prep.source}), app config ${prep.config}\n`);
if (baseArg.base && !prep.baseFlag) {
  process.stderr.write(`mock-site: the ${prep.adapter} adapter cannot apply a base; start without --base\n`);
  process.exit(1);
}
const child = spawn(process.execPath, [prep.launcher, "--config", prep.generated, "--port", String(port), "--strictPort", ...(baseArg.base && prep.baseFlag ? [prep.baseFlag, baseArg.base] : [])], {
  cwd: root,
  env: { ...process.env, MOCK_SITE_LAN: lan ? "1" : "0" },
  stdio: "inherit",
});
for (const s of /** @type {const} */ (["SIGINT", "SIGTERM"])) process.on(s, () => child.kill(s));
child.on("exit", (code) => process.exit(code ?? 0));
