/**
 * Faux `pi --mode rpc` process driver — one real pi process per instance, its
 * model scripted by the repo's faux provider fixture (`qa/fixtures/faux-provider.ext.ts`,
 * scenario picked by `FAUX_SCRIPT` or a `[[faux:<id>]]` sentinel in a prompt).
 * No API key, no real model. Multi-session mechanics = N of these.
 *
 * REAL here: process spawn with a hermetic HOME, strict-LF JSONL framing,
 * command send, event capture, `waitFor`, `stop`.
 * STUB (filled by later sections of add-agent-teams-core, do not rely on yet):
 *   - loading the REAL plugin bridge entry (`extensions`): the option is wired
 *     through to `-e`, but the bridge only has a no-op body until section 6;
 *   - the in-process server store / lane stub the bridge talks to (section 3);
 *   - scripted per-test policies beyond the existing fixture scenarios — add a
 *     scenario to `qa/fixtures/faux-scenarios.ts` or use the prompt sentinel.
 *
 * Opt-in: constructing a process needs `pi` on PATH; use `fauxPiAvailable()`
 * with `describe.skipIf(!fauxPiAvailable())`.
 * See change: add-agent-teams-core (test-plan: faux-pi-rpc harness).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ChildProcess,
  execFileSync,
  spawn,
} from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

/** One decoded JSONL record from pi's stdout (event or command response). */
interface PiRpcRecord {
  readonly type?: string;
  readonly id?: string;
  readonly [key: string]: unknown;
}

interface FauxPiOptions {
  /** Working directory of the pi process (default: a fresh temp dir). */
  cwd?: string;
  /** Fallback faux scenario id (`FAUX_SCRIPT`). Default `plain-text`. */
  fauxScript?: string;
  /** Tokens/second of the faux stream (`FAUX_TPS`); set low for abort scenarios. */
  tps?: number;
  /** Extra `-e` extension paths (e.g. the plugin bridge entry; see STUB note). */
  extensions?: readonly string[];
  /** Extra environment for the process. */
  env?: Record<string, string>;
}

const FIXTURE = fileURLToPath(new URL("../../../../../qa/fixtures/faux-provider.ext.ts", import.meta.url));

/** True when a `pi` binary is resolvable on PATH. */
export function fauxPiAvailable(): boolean {
  try {
    execFileSync("pi", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export class FauxPiProcess {
  readonly records: PiRpcRecord[] = [];
  readonly home: string;
  readonly cwd: string;
  private child: ChildProcess | undefined;
  private buffer = "";
  private seq = 0;
  private readonly waiters = new Set<() => void>();

  private readonly opts: FauxPiOptions;

  constructor(opts: FauxPiOptions = {}) {
    this.opts = opts;
    this.home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-teams-faux-"));
    this.cwd = opts.cwd ?? this.home;
  }

  /** Spawn the process. Resolves once the child is running. */
  async start(): Promise<void> {
    const args = ["--mode", "rpc", "-e", FIXTURE];
    for (const ext of this.opts.extensions ?? []) args.push("-e", ext);
    args.push("--model", "faux/faux-1");
    const child = spawn("pi", args, {
      cwd: this.cwd,
      env: {
        ...process.env,
        HOME: this.home,
        FAUX_SCRIPT: this.opts.fauxScript ?? "plain-text",
        ...(this.opts.tps ? { FAUX_TPS: String(this.opts.tps) } : {}),
        ...this.opts.env,
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    this.child = child;
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.onData(chunk));
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
  }

  /** Send one command (adds an `id` when absent); returns the id used. */
  send(command: { type: string; [key: string]: unknown }): string {
    if (!this.child?.stdin) throw new Error("faux pi process is not running");
    const id = typeof command.id === "string" ? command.id : `cmd-${++this.seq}`;
    this.child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    return id;
  }

  /** Send a user prompt (the `[[faux:<id>]]` sentinel selects the scenario). */
  prompt(message: string): string {
    return this.send({ type: "prompt", message });
  }

  /** Resolve with the first record matching `predicate` (already seen or future). */
  waitFor(predicate: (r: PiRpcRecord) => boolean, timeoutMs = 30_000): Promise<PiRpcRecord> {
    const found = this.records.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`faux pi: no matching record within ${timeoutMs} ms (${this.records.length} seen)`));
      }, timeoutMs);
      const check = (): void => {
        const hit = this.records.find(predicate);
        if (!hit) return;
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve(hit);
      };
      this.waiters.add(check);
    });
  }

  /** Kill the process and remove its hermetic HOME. Safe to call repeatedly. */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGKILL");
      });
    }
    fs.rmSync(this.home, { recursive: true, force: true });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    // Strict framing: split on LF only (never U+2028/2029), tolerate CRLF.
    for (let nl = this.buffer.indexOf("\n"); nl >= 0; nl = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, "");
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      try {
        this.records.push(JSON.parse(line) as PiRpcRecord);
      } catch {
        continue; // non-protocol noise
      }
    }
    for (const w of [...this.waiters]) w();
  }
}
