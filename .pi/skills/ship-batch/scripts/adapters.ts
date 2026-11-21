/**
 * Real adapters for the ship-batch runner: REST via `fetch` + the dashboard
 * skill's local-proof headers, the typed bus client (with disconnect
 * detection), the `openspec` CLI and docker teardown. Kept apart from
 * `runner.ts` so the tests never load the bus client / `ws`.
 *
 * See change: add-ship-batch-orchestrator.
 */
import { execFile, spawnSync } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import { BusClient } from "../../../../packages/bus-client/src/client.ts";
import { discoverPort } from "../../../../packages/bus-client/src/port-discovery.ts";
import { dialHost, proofHeaders } from "../../../../packages/extension/.pi/skills/pi-dashboard/scripts/local-proof.ts";
import { type BusPort, type Deps, dockerDownScript, type RestResponse } from "./runner.ts";

const run = promisify(execFile);

/** The init hook may install dependencies for minutes; everything else is quick. */
const timeoutFor = (path: string): number => (path.includes("/worktree/init") ? 20 * 60_000 : 60_000);

export function createRest(): Deps["rest"] {
  return async (method, path, body): Promise<RestResponse> => {
    const url = `http://${dialHost()}:${discoverPort()}${path}`;
    const headers: Record<string, string> = { ...proofHeaders(method, url) };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutFor(path)),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, json };
  };
}

/** `BusClient` wrapped so a dropped socket is observable (`connected()`), one client per connection. */
export function createBus(): BusPort {
  let client: BusClient | null = null;
  let open = false;
  let generation = 0;
  return {
    async connect() {
      client?.close();
      const mine = ++generation;
      class TrackedWebSocket extends WebSocket {
        constructor(url: string) {
          super(url);
          this.on("close", () => {
            if (mine === generation) open = false;
          });
        }
      }
      const c = new BusClient({
        host: dialHost(),
        proofHeaders,
        // biome-ignore lint/suspicious/noExplicitAny: the bus client types its own socket shape
        WebSocketCtor: TrackedWebSocket as any,
      });
      open = false;
      await c.connect();
      client = c;
      open = true;
    },
    connected: () => open,
    sessions: () =>
      (client?.read.sessions() ?? []).map((s) => ({ id: s.id, cwd: s.cwd, status: s.status, startedAt: s.startedAt })),
    spawn: async (opts) => {
      if (!client) throw new Error("bus not connected");
      return client.spawn(opts);
    },
    prompt: (id, text) => {
      if (!client) throw new Error("bus not connected");
      client.prompt(id, text);
    },
    close: () => {
      open = false;
      client?.close();
      client = null;
    },
  };
}

export function createDeps(): Deps {
  return {
    rest: createRest(),
    bus: createBus(),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    hostname: os.hostname(),
    pid: process.pid,
    dockerDown: dockerDownScript,
    listChanges: async (repo) => {
      const { stdout } = await run("openspec", ["list", "--json"], { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
      const parsed = JSON.parse(stdout) as { changes?: { name: string; status: string }[] };
      return (parsed.changes ?? []).map((c) => ({ name: c.name, status: c.status }));
    },
    hasTool: (name) => spawnSync(name, ["--version"], { stdio: "ignore" }).status === 0,
  };
}
