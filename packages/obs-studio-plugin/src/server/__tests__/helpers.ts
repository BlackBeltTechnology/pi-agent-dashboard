/**
 * Server-test helpers: a scripted fake `service exec … serve --stdio` child, a
 * recording state CLI, and a Fastify app with the OBS routes mounted.
 * See change: add-obs-studio-plugin.
 */

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import Fastify, { type FastifyInstance } from "fastify";
import type { CliResult, DashboardCli } from "../../core/dashboard-cli.js";
import { BridgeManager } from "../bridge.js";
import { mountObsRoutes, type ObsRouteDeps } from "../routes.js";
import { createStateReader } from "../service-state.js";

export type Responder = (req: { id: number; op: string; args: Record<string, unknown> }, child: FakeChild) => void;

export interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
  stdinEnded: boolean;
  argv: string[];
  kill(): boolean;
  exit(code: number): void;
  reply(id: number, body: Record<string, unknown>): void;
}

function fakeChild(argv: string[], respond: Responder, opts: { exitOnEof?: boolean } = {}): FakeChild {
  const c = new EventEmitter() as FakeChild;
  c.argv = argv;
  c.stdin = new PassThrough();
  c.stdout = new PassThrough();
  c.stderr = new PassThrough();
  c.killed = false;
  c.stdinEnded = false;
  let exited = false;
  c.exit = (code) => {
    if (exited) return;
    exited = true;
    setImmediate(() => c.emit("exit", code, null));
  };
  c.kill = () => {
    c.killed = true;
    c.exit(143);
    return true;
  };
  c.reply = (id, body) => c.stdout.write(`${JSON.stringify({ id, ...body })}\n`);
  let buf = "";
  c.stdin.on("data", (b) => {
    buf += String(b);
    let i = buf.indexOf("\n");
    while (i >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) respond(JSON.parse(line), c);
      i = buf.indexOf("\n");
    }
  });
  c.stdin.on("finish", () => {
    c.stdinEnded = true;
    if (opts.exitOnEof !== false) c.exit(0);
  });
  return c;
}

export const okResponder =
  (results: Record<string, unknown> = {}): Responder =>
  (req, child) =>
    child.reply(req.id, { ok: true, result: results[req.op] ?? { op: req.op } });

function stateCli(states: Record<string, string>): DashboardCli & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(args): Promise<CliResult> {
      calls.push(args);
      const id = args[2];
      const state = states[id];
      if (!state) return { code: 0, stdout: JSON.stringify({ ok: false, data: { error: "not-found" } }), stderr: "" };
      return { code: 0, stdout: JSON.stringify({ ok: true, data: { id, state, exposure: "all-interfaces", secrets: { password: { configured: true } } } }), stderr: "" };
    },
  };
}

export interface AppOpts {
  states?: Record<string, string>;
  instances?: string[];
  defs?: Record<string, { mode: string; ws?: string }>;
  respond?: Responder;
  authority?: ((req: unknown) => boolean) | null;
  requestTimeoutMs?: number;
  disposeGraceMs?: number;
  networkGuard?: ObsRouteDeps["networkGuard"];
  now?: () => number;
  /** Register extra hooks (e.g. the host tier gate) before the routes. */
  before?: (app: FastifyInstance) => Promise<void> | void;
}

export async function obsApp(o: AppOpts = {}) {
  const app = Fastify();
  await o.before?.(app);
  const children: FakeChild[] = [];
  const cli = stateCli(o.states ?? { obs: "healthy" });
  const bridges = new BridgeManager({
    cliArgv: ["/abs/node", "/abs/cli.ts"],
    nodePath: "/abs/node",
    piObsEntry: "/abs/pi-obs.mjs",
    spawn: (argv) => {
      const c = fakeChild(argv, o.respond ?? okResponder());
      children.push(c);
      return c as unknown as ChildProcess;
    },
    requestTimeoutMs: o.requestTimeoutMs,
    disposeGraceMs: o.disposeGraceMs,
  });
  let instances = [...(o.instances ?? ["obs"])];
  const defs = o.defs ?? { obs: { mode: "attached", ws: "ws://127.0.0.1:4455" } };
  const logs: string[] = [];
  await mountObsRoutes(app, {
    bridges,
    states: createStateReader(cli, o.now ?? Date.now),
    instances: () => {
      instances = instances.filter((id) => defs[id] !== undefined);
      return instances;
    },
    definition: (id) => defs[id],
    recoverySuspended: () => false,
    hasOperateAuthority: o.authority === null ? undefined : (o.authority ?? (() => true)),
    networkGuard: o.networkGuard ?? (async () => {}),
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
  });
  await app.ready();
  return { app, children, cli, bridges, logs, instances: () => instances };
}
