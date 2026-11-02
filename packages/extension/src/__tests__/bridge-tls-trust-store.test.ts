/**
 * A remote bridge validates the server certificate against Node's trust store.
 * A spawned node child (the trust store is read at process start) dials a local
 * HTTPS+WSS server whose leaf comes from the committed fixture CA:
 *   (a) without `NODE_EXTRA_CA_CERTS` — TLS error, no register, no bearer reaches the server;
 *   (b) with `NODE_EXTRA_CA_CERTS=<fixture ca.pem>` — ticket minted, registered.
 *
 * See change: prove-vault-bridge-tls (task 6.4, test-plan #X4).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { fixtureLeaf } from "./helpers/fixture-leaf.js";

const FIXTURES = fileURLToPath(new URL("../../../server/src/tls/__tests__/fixtures/", import.meta.url));
const CHILD = fileURLToPath(new URL("./helpers/bridge-tls-child.ts", import.meta.url));
const SHARED_SRC = fileURLToPath(new URL("../../../shared/src/", import.meta.url));
const HOST = "a.test"; // SAN of the fixture leaf `leaf-a.test.pem`
const BEARER = "plain-bearer-for-x4";

interface Observed {
  bearers: string[];
  requests: number;
  tlsErrors: number;
  registered: boolean;
}

let server: https.Server | undefined;
let home: string | undefined;

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server?.close(() => r()));
    server = undefined;
  }
  if (home) fs.rmSync(home, { recursive: true, force: true });
  home = undefined;
});

async function startServer(): Promise<{ port: number; seen: Observed }> {
  const seen: Observed = { bearers: [], requests: 0, tlsErrors: 0, registered: false };
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      if ((JSON.parse(String(raw)) as { type?: string }).type === "session_register") seen.registered = true;
    });
  });
  server = https.createServer(
    fixtureLeaf(HOST),
    (req, res) => {
      seen.requests++;
      if (req.headers.authorization) seen.bearers.push(String(req.headers.authorization));
      req.resume();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ success: true, data: { ticket: "tkt-x4" } }));
    },
  );
  server.on("tlsClientError", () => {
    seen.tlsErrors++;
  });
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "https://x").pathname !== "/ws/bridge") return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  return { port: (server.address() as AddressInfo).port, seen };
}

async function runChild(port: number, extraEnv: Record<string, string>): Promise<{ connected: boolean; err: string }> {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-x4-"));
  // Resolve the shared package from THIS checkout (vitest aliases it; a bare node
  // child would otherwise follow node_modules to whichever checkout installed it).
  const tsconfig = path.join(home, "tsconfig.json");
  fs.writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        module: "esnext",
        moduleResolution: "bundler",
        target: "es2022",
        baseUrl: "/",
        paths: { "@blackbelt-technology/pi-dashboard-shared/*": [`${SHARED_SRC}*`] },
      },
    }),
  );
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--import", tsx, CHILD, `wss://${HOST}:${port}`], {
      // A clean environment: nothing inherited can add a CA or relax validation.
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home as string,
        PI_DASHBOARD_TOKEN: BEARER,
        PI_TEST_RESOLVE_HOST: HOST,
        TSX_TSCONFIG_PATH: tsconfig,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", () => {
      const line = out.split("\n").find((l) => l.startsWith("{"));
      resolve({ connected: line ? (JSON.parse(line) as { connected: boolean }).connected : false, err });
    });
  });
}

describe("bridge TLS trust store (X4)", () => {
  it("(a) without the fixture CA the handshake fails: no register, no bearer reaches the server", async () => {
    const { port, seen } = await startServer();
    const res = await runChild(port, {});
    expect(res.connected).toBe(false);
    expect(seen.tlsErrors).toBeGreaterThan(0);
    expect(seen.requests).toBe(0);
    expect(seen.bearers).toEqual([]);
    expect(seen.registered).toBe(false);
  }, 30_000);

  it("(b) with NODE_EXTRA_CA_CERTS the ticket is minted and the bridge registers", async () => {
    const { port, seen } = await startServer();
    const res = await runChild(port, { NODE_EXTRA_CA_CERTS: path.join(FIXTURES, "ca.pem") });
    expect(res.err).not.toContain("tls-verify-disabled");
    expect(res.connected).toBe(true);
    expect(seen.bearers).toEqual([`Bearer ${BEARER}`]);
    expect(seen.tlsErrors).toBe(0);
    await waitFor(() => seen.registered);
    expect(seen.registered).toBe(true);
  }, 30_000);
});

async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
}
