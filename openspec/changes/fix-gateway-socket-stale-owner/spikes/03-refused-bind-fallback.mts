// Spike #744c: does server.ts's "socket bind refused → loopback" fallback work?
// Replicates the server.ts block verbatim against the real createPiGateway.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createPiGateway } from "APP/packages/server/src/pi/pi-gateway.ts";
import { createMemorySessionManager } from "APP/packages/server/src/session/memory-session-manager.ts";

async function freePort(): Promise<number> {
  return new Promise((r) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => r(p));
    });
  });
}

async function runServerTsFallback(socketPath: string, piPort: number) {
  const piGateway = createPiGateway(createMemorySessionManager(), { pingInterval: 0 });
  const policy = { tcp: undefined as undefined | { port: number; host: string }, socketPath };
  const log: string[] = [];
  let startupAborted: string | null = null;
  try {
    // ---- verbatim shape of server.ts ~L2650 ----
    if (policy.tcp) piGateway.start(policy.tcp.port, policy.tcp.host);
    if (policy.socketPath) {
      try {
        await piGateway.startOnSocket(policy.socketPath);
      } catch (err) {
        log.push(`socket bind refused: ${(err as Error).message.slice(0, 70)}…`);
        if (!policy.tcp) {
          log.push(`falling back to 127.0.0.1:${piPort}`);
          piGateway.start(piPort, "127.0.0.1");
        }
      }
    }
    // ---------------------------------------------
  } catch (err) {
    startupAborted = (err as Error).message;
  }
  // Can a bridge reach the gateway on either transport?
  const tcpReachable = await new Promise<boolean>((r) => {
    const s = net.connect(piPort, "127.0.0.1");
    s.on("connect", () => { s.destroy(); r(true); });
    s.on("error", () => r(false));
  });
  let transport: unknown;
  try { transport = piGateway.transport(); } catch (err) { transport = `THROWS: ${(err as Error).message}`; }
  try { piGateway.stop(); } catch {}
  return { log, startupAborted, transport, tcpReachable };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s744c-"));
fs.chmodSync(dir, 0o700);
const out: Record<string, unknown> = { platform: process.platform };

// A — legitimate refusal: a live incumbent serves the socket
{
  const sock = path.join(dir, "a.sock");
  const incumbent = net.createServer().listen(sock);
  await new Promise((r) => incumbent.once("listening", r));
  out.A_liveIncumbent = await runServerTsFallback(sock, await freePort());
  incumbent.close();
}

// B — issue #744 repro: stale socket, pidfile records a pid that is alive (ours)
{
  const sock = path.join(dir, "b.sock");
  const { spawn } = await import("node:child_process");
  const ghost = spawn(process.execPath, ["-e", `require("net").createServer().listen(${JSON.stringify(sock)},()=>console.log("up"))`], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((r) => ghost.stdout!.once("data", r));
  ghost.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 200));
  fs.writeFileSync(`${sock}.pid`, `${process.pid}\n`);
  out.B_staleSelfPid = { fileExists: fs.existsSync(sock), ...(await runServerTsFallback(sock, await freePort())) };
}

console.log(JSON.stringify(out, null, 2));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(0);
