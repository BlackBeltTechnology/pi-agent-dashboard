/**
 * `pi-obs` process entry: wires real host deps into `main` (`./cli.ts`).
 * Launched by `bin/pi-obs.mjs` (native TypeScript loader). Spawns go through
 * `@blackbelt-technology/pi-dashboard-shared/platform/exec.js`; process lookup
 * through the managed-services exact-executable matcher.
 * See change: add-obs-studio-plugin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { execFileAsync, spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { isProcessAlive, killProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { findListenAddresses, findProcessesByExecutable } from "@blackbelt-technology/pi-dashboard-shared/platform/process-scan.js";
import { JXA_DISPLAYS, parseDisplays } from "../core/devices.js";
import { type Platform, processName } from "../core/paths.js";
import { main } from "./cli.js";

const platform = process.platform as Platform;
const here = path.dirname(fileURLToPath(import.meta.url));
/** The launcher `bin/pi-obs.mjs` — what the service start argv names. */
const entryPath = path.resolve(here, "..", "..", "bin", "pi-obs.mjs");

async function run(file: string, args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const r = await execFileAsync(file, args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, stdout: String(r.stdout) };
  } catch (e) {
    const x = e as { code?: unknown; stdout?: unknown };
    return { code: typeof x.code === "number" ? x.code : 1, stdout: String(x.stdout ?? "") };
  }
}

function has(cmd: string): boolean {
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  const exts = platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  return dirs.some((d) => exts.some((x) => fs.existsSync(path.join(d, cmd + x))));
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function ask(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(/^y(es)?$/i.test(a.trim()));
    }),
  );
}

const code = await main(process.argv.slice(2), {
  host: { home: os.homedir(), platform, env: process.env },
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
  readStdin,
  isTTY: Boolean(process.stdin.isTTY && process.stderr.isTTY),
  ask,
  stdin: process.stdin,
  stdout: process.stdout,
  findObs: () => findProcessesByExecutable(processName(platform), { platform }),
  spawnDetached: async (argv, cwd) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, detached: true, stdio: "ignore", shell: false });
    child.on("error", () => {});
    child.unref();
  },
  run,
  isAlive: (pid) => isProcessAlive(pid),
  forceKill: async (pid) => {
    await killProcess(pid, { timeoutMs: 2000 });
  },
  exposure: (port) => findListenAddresses(port, { platform }),
  listDisplays: async () => {
    if (platform !== "darwin") return "unsupported";
    const r = await run("osascript", ["-l", "JavaScript", "-e", JXA_DISPLAYS]);
    if (r.code !== 0) throw new Error("osascript display listing failed");
    return parseDisplays(r.stdout);
  },
  has,
  fetchJson: async (url) => (await fetch(url, { headers: { accept: "application/vnd.github+json" } })).json() as never,
  fetchBytes: async (url) => Buffer.from(await (await fetch(url)).arrayBuffer()),
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  nodePath: process.execPath,
  entryPath,
});
// Exit explicitly once stdout is flushed: an open stdin pipe (serve, readStdin) must not keep us alive.
process.stdout.write("", () => process.exit(code));
