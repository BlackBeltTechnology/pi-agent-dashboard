/**
 * `pi-obs serve --stdio` — the panel bridge child (design D4). NDJSON
 * `{id, op, args}` → `{id, ok, result|error}`, matched by `id`, handled
 * concurrently (responses may be out of order). Only the fixed panel
 * operations exist; every request goes through the request policy. Leftover
 * probe inputs are swept on the first connection. Exits on stdin EOF (the
 * dashboard side went away) and after 60 s without a request, so `service
 * exec` releases its lease in both cases. stdout carries ONLY protocol lines;
 * diagnostics go to stderr. See change: add-obs-studio-plugin.
 */
import readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import { sweepProbes } from "./devices.js";
import { ObsError } from "./errors.js";
import type { GuardedObs } from "./policy.js";
import { programScreenshot, record, sceneList, sceneSwitch, status, vcam } from "./verbs.js";

const SERVE_IDLE_MS = 60_000;

interface ServeRequest {
  id: number | string;
  op: string;
  args?: Record<string, unknown>;
}

export interface ServeDeps {
  input: Readable;
  output: Writable;
  connect: () => Promise<GuardedObs>;
  idleMs?: number;
  log?: (line: string) => void;
}

async function dispatch(obs: GuardedObs, op: string, args: Record<string, unknown>): Promise<unknown> {
  switch (op) {
    case "status":
      return { ...(await status(obs)), ...(await sceneList(obs)) };
    case "screenshot":
      return programScreenshot(obs, typeof args.width === "number" && args.width > 0 && args.width <= 1920 ? args.width : 640);
    case "scene.list":
      return sceneList(obs);
    case "scene.switch":
      if (typeof args.sceneName !== "string" || !args.sceneName) throw new ObsError("usage", "scene.switch needs sceneName");
      return sceneSwitch(obs, args.sceneName);
    case "vcam.set":
      if (typeof args.on !== "boolean") throw new ObsError("usage", "vcam.set needs on:boolean");
      return vcam(obs, args.on);
    case "record.set":
      if (typeof args.on !== "boolean") throw new ObsError("usage", "record.set needs on:boolean");
      return record(obs, args.on);
    default:
      throw new ObsError("usage", `unknown op ${JSON.stringify(op)}`);
  }
}

export function serve(d: ServeDeps): Promise<void> {
  const log = d.log ?? (() => {});
  const idleMs = d.idleMs ?? SERVE_IDLE_MS;
  let obs: GuardedObs | undefined;
  let connecting: Promise<GuardedObs> | undefined;
  let idle: NodeJS.Timeout | undefined;
  let closed = false;

  const getObs = async (): Promise<GuardedObs> => {
    if (obs) return obs;
    connecting ??= d
      .connect()
      .then(async (o) => {
        await sweepProbes(o).catch((e) => log(`[pi-obs] serve: probe sweep failed: ${(e as Error).message}`));
        obs = o;
        return o;
      })
      .finally(() => {
        connecting = undefined;
      });
    return connecting;
  };

  return new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: d.input, crlfDelay: Number.POSITIVE_INFINITY });
    const finish = () => {
      if (closed) return;
      closed = true;
      clearTimeout(idle);
      rl.close();
      void (obs?.conn.close() ?? Promise.resolve()).finally(() => resolve());
    };
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        log("[pi-obs] serve: idle, exiting");
        finish();
      }, idleMs);
    };
    const reply = (msg: Record<string, unknown>) => {
      if (!closed) d.output.write(`${JSON.stringify(msg)}\n`);
    };
    arm();
    rl.on("line", (line) => {
      if (!line.trim()) return;
      arm();
      let req: ServeRequest;
      try {
        req = JSON.parse(line) as ServeRequest;
      } catch {
        reply({ id: null, ok: false, error: { code: "usage", message: "malformed request line" } });
        return;
      }
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-request dispatch with one error path
      void (async () => {
        try {
          const result = await dispatch(await getObs(), req.op, req.args ?? {});
          reply({ id: req.id, ok: true, result });
        } catch (e) {
          const code = e instanceof ObsError ? e.code : "failed";
          if (code === "timeout" || code === "unreachable") obs = undefined;
          reply({ id: req.id, ok: false, error: { code, message: (e as Error).message, ...(e instanceof ObsError && e.detail?.scenes ? { scenes: e.detail.scenes } : {}) } });
        }
      })();
    });
    rl.on("close", finish);
  });
}
