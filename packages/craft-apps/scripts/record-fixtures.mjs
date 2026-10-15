/**
 * Record per-app command-list fixtures (`src/__tests__/fixtures/commands/<app>.json`)
 * from real provisioned binaries: the version, every command id (the dialect's list
 * command: `commands`, `commands --json` or `tools`) and the MCP `tools/list` names.
 * The offline skill-drift test checks command ids quoted in skills against these.
 *
 *   CRAFT_HOME=/tmp/craft-home node --import tsx scripts/record-fixtures.mjs [app…]
 *
 * Binaries come from `pi-craft install --all`. Run again when a pinned version moves.
 * See change: add-craft-apps-core (task 0.5, skill drift check).
 */
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { extractCommandIds } from "../src/command-ids.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "src", "__tests__", "fixtures", "commands");
const piCraft = path.join(root, "bin", "pi-craft");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "craft-fixtures-"));

/** `list` args per app, mirroring registry.ts dialects (kept literal: this script has no TS loader). */
const LIST = {
  photocraft: ["commands", "--json"],
  vectorcraft: ["commands", "--json"],
  filmcraft: ["commands", "--json"],
  lightcraft: ["commands", "--json"],
  pdfcraft: ["tools"],
  effectcraft: ["commands", "--json"],
  designcraft: ["commands"],
  figcraft: ["commands", "--json"],
  wordcraft: ["commands", "--json"],
  soundcraft: ["commands"],
  deckcraft: ["commands"],
  cadcraft: ["commands"],
  gridcraft: ["commands", "--json"],
};

function binary(app) {
  const r = spawnSync(process.execPath, [piCraft, app, "path"], { encoding: "utf8", env: process.env });
  if (r.status !== 0) throw new Error(`${app}: ${r.stderr}`);
  return r.stdout.trim();
}

async function mcpTools(bin, app) {
  const args = app === "pdfcraft" ? ["mcp", "--root", work] : ["mcp"];
  const p = spawn(bin, args, { cwd: work, stdio: ["pipe", "pipe", "ignore"] });
  const send = (o) => p.stdin.write(`${JSON.stringify(o)}\n`);
  const lines = [];
  let buf = "";
  p.stdout.on("data", (d) => {
    buf += d;
    let i = buf.indexOf("\n");
    while (i >= 0) {
      lines.push(buf.slice(0, i));
      buf = buf.slice(i + 1);
      i = buf.indexOf("\n");
    }
  });
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "record-fixtures", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    for (const l of lines) {
      try {
        const m = JSON.parse(l);
        if (m.id === 2) {
          p.kill();
          return m.result.tools.map((t) => t.name).sort();
        }
      } catch {
        /* non-JSON noise */
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  p.kill();
  return [];
}

fs.mkdirSync(outDir, { recursive: true });
const wanted = process.argv.slice(2);
for (const app of Object.keys(LIST)) {
  if (wanted.length && !wanted.includes(app)) continue;
  const bin = binary(app);
  const v = spawnSync(bin, ["--version"], { encoding: "utf8" });
  const version = /\b(\d+\.\d+\.\d+)\b/.exec(v.stdout + v.stderr)?.[1] ?? "unknown";
  const l = spawnSync(bin, LIST[app], { encoding: "utf8", cwd: work, maxBuffer: 256 * 1024 * 1024 });
  const commandIds = extractCommandIds(l.stdout);
  const tools = await mcpTools(bin, app);
  fs.writeFileSync(
    path.join(outDir, `${app}.json`),
    `${JSON.stringify({ app, version, list: `${app}-cli ${LIST[app].join(" ")}`, commandIds, mcpTools: tools }, null, 1)}\n`,
  );
  console.log(`${app.padEnd(12)} ${version.padEnd(8)} commands=${commandIds.length} mcpTools=${tools.length}`);
}
fs.rmSync(work, { recursive: true, force: true });
