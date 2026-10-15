/** Executable stand-ins for photocraft-cli, written to tmp dirs. */
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpDir } from "./fixtures.js";

/** Write a node-script executable (shebang + body). */
export function nodeStub(body: string, name = "photocraft-cli"): string {
  const f = path.join(tmpDir("pcraft-stub-"), name);
  fs.writeFileSync(f, `#!/usr/bin/env node\n${body}\n`);
  fs.chmodSync(f, 0o755);
  return f;
}

/** Echoes its argv as one JSON line on stdout. */
export const ECHO_ARGV = `process.stdout.write(JSON.stringify(process.argv.slice(2)) + "\\n");`;

/**
 * Fake MCP server. Logs `recv`/`send` events with timestamps to $STUB_LOG.
 *  - `initialize` / notifications: answered / ignored immediately
 *  - `tools/call`: answered after 200 ms (optionally preceded by a non-JSON line when $STUB_NOISE is set)
 *  - $STUB_DROP: id of a tools/call that is swallowed (never answered)
 *  - $STUB_HANG: stay alive forever, writing the pid to that file
 *  - argv is dumped to $STUB_ARGV_LOG when set
 */
export const MCP_STUB = `
const fs = require("node:fs");
const readline = require("node:readline");
const log = (o) => process.env.STUB_LOG && fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ t: Date.now(), ...o }) + "\\n");
if (process.env.STUB_ARGV_LOG) fs.writeFileSync(process.env.STUB_ARGV_LOG, JSON.stringify(process.argv.slice(2)));
if (process.env.STUB_HANG) { fs.writeFileSync(process.env.STUB_HANG, String(process.pid)); setInterval(() => {}, 1000); }
else {
  const rl = readline.createInterface({ input: process.stdin });
  const send = (o) => { log({ ev: "send", id: o.id }); process.stdout.write(JSON.stringify(o) + "\\n"); };
  rl.on("line", (line) => {
    const m = JSON.parse(line);
    log({ ev: "recv", key: m.method === "tools/call" ? "call#" + m.id : m.method });
    if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { serverInfo: { name: "photocraft" } } });
    else if (m.method === "tools/call" && String(m.id) === process.env.STUB_DROP) log({ ev: "drop", id: m.id });
    else if (m.method === "tools/call") setTimeout(() => {
      if (process.env.STUB_NOISE) process.stdout.write("warning: x\\n");
      send({ jsonrpc: "2.0", id: m.id, result: { ok: true } });
    }, 200);
  });
}
`;

export function readLog(file: string): { t: number; ev: string; key?: string; id?: number }[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
