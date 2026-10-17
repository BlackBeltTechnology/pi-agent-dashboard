/**
 * Test harness for `main()` (`src/bin/cli.ts`): temp home + state, recorded
 * stdout/stderr, a recording fake `pi-dashboard` CLI, and injectable process /
 * spawn / clock deps. See change: add-obs-studio-plugin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type CliDeps, main } from "../../bin/cli.js";
import type { CliResult, DashboardCli } from "../dashboard-cli.js";

export interface CliCall {
  args: string[];
  stdin?: string;
  inherit?: boolean;
  /** Snapshot of `--file` contents + mode at call time (for `service add`). */
  file?: { json: unknown; mode: number };
}

export function recordingCli(respond: (args: string[]) => Partial<CliResult> = () => ({})): DashboardCli & { calls: CliCall[] } {
  const calls: CliCall[] = [];
  return {
    calls,
    async run(args, opts = {}) {
      const call: CliCall = { args, stdin: opts.stdin, inherit: opts.inherit };
      const i = args.indexOf("--file");
      if (i >= 0) {
        const f = args[i + 1];
        call.file = { json: JSON.parse(fs.readFileSync(f, "utf8")), mode: fs.statSync(f).mode & 0o777 };
      }
      calls.push(call);
      return { code: 0, stdout: "", stderr: "", ...respond(args) };
    },
  };
}

export function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-obs-home-"));
}

export function writeServices(home: string, services: unknown[]): void {
  const dir = path.join(home, ".pi", "dashboard");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "services.json"), JSON.stringify({ schemaVersion: 1, instanceId: "x", services }));
}

export interface RunOut {
  code: number;
  out: string[];
  err: string[];
  json(): Record<string, unknown>;
}

export function baseDeps(home: string, over: Partial<CliDeps> = {}): CliDeps {
  return {
    host: { home, platform: "darwin", env: {} },
    out: () => {},
    err: () => {},
    readStdin: async () => "",
    isTTY: false,
    findObs: async () => [],
    spawnDetached: async () => {},
    run: async () => ({ code: 1, stdout: "" }),
    isAlive: () => false,
    forceKill: async () => {},
    exposure: async () => "loopback",
    listDisplays: async () => [{ id: "DISP-1", width: 1728, height: 1117, main: true }],
    has: () => true,
    now: Date.now,
    sleep: async () => {},
    nodePath: "/abs/node",
    entryPath: "/abs/pi-obs.mjs",
    exists: () => true,
    cli: recordingCli(),
    ...over,
  };
}

export async function runCli(argv: string[], deps: CliDeps): Promise<RunOut> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { ...deps, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out, err, json: () => JSON.parse(out[out.length - 1] ?? "{}") as Record<string, unknown> };
}
