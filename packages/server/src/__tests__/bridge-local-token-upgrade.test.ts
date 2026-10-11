/**
 * The loopback bridge's positive credential (D6, tasks 5.3/5.4), now a local
 * credential PROOF (`X-Pi-Local-Proof`, endpoint-bound) with the raw
 * `X-Pi-Local-Token` kept as a deprecated legacy admission.
 *
 * Windows has no unix-socket transport, so its local bridge dials
 * `127.0.0.1:<piPort>` — an address, and an address is not a credential. The
 * `~/.pi/dashboard/local/token` secret is: only the same OS user can read it,
 * so a relayed peer presenting as loopback cannot forge it.
 *
 * Folds test-plan #X14 (tokenless), #E16 (counter-proof only on proof
 * admissions), #X1 (relay earns nothing) and #X4 (legacy still admitted).
 *
 * See change: add-pi-gateway-transport-identity (tasks 12.33, 12.34);
 * loopback-credential-proof (tasks 4.3-4.5).
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  BRIDGE_PURPOSE,
  canonicalBinding,
  LOCAL_PROOF_SERVER_HEADER,
  mintProof,
  verifyCounterProof,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createLocalCredentialVerifier } from "../auth/local-credential.js";
import { ensureLocalToken, LOCAL_TOKEN_HEADER } from "../auth/local-token.js";
import { decideBridgeUpgrade } from "../pi/bridge-upgrade-auth.js";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createTestServer } from "../test-support/test-server.js";

const refuseTicket = () => ({ ok: false as const, reason: "missing" as const });

let token: string;
let tokenDir: string;

beforeEach(() => {
  tokenDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "local-token-")), "local");
  token = ensureLocalToken(tokenDir);
});

/** The gate as the gateway wires it: the verdict is stamped at the edge. */
function decide(
  headers: Record<string, unknown>,
  opts: { requireTicketOnLoopback?: boolean; localCredential?: "valid" | "legacy" | "absent" | "invalid" } = {},
) {
  return decideBridgeUpgrade({
    transport: "tcp",
    remoteAddress: "127.0.0.1",
    headers,
    consumeTicket: refuseTicket,
    ...opts,
  });
}

describe("loopback bridge upgrade with a local credential", () => {
  it("admits a loopback bridge with a valid proof, with no ticket", () => {
    const v = decide({}, { requireTicketOnLoopback: true, localCredential: "valid" });
    expect(v.allow).toBe(true);
    // A positive credential, NOT the deprecation grace.
    expect(v).not.toHaveProperty("deprecated", true);
    expect(v.reason).toMatch(/credential proof/i);
  });

  it("refuses a TOKENLESS loopback bridge once the grace window closes (#X14)", () => {
    const v = decide({}, { requireTicketOnLoopback: true, localCredential: "absent" });
    expect(v.allow).toBe(false);
    expect(v).toMatchObject({ cause: "local-token-missing" });
  });

  it("refuses an INVALID proof distinctly from a missing one", () => {
    const v = decide({}, { requireTicketOnLoopback: true, localCredential: "invalid" });
    expect(v.allow).toBe(false);
    expect(v).toMatchObject({ cause: "local-proof-invalid" });
    // The two causes must not collapse into one operational symptom.
    const missing = decide({}, { requireTicketOnLoopback: true });
    expect((missing as { cause?: string }).cause).not.toBe((v as { cause?: string }).cause);
  });

  it("never lets a credential admit a REMOTE peer — the file proves same-user, not same-host", () => {
    const v = decideBridgeUpgrade({
      transport: "tcp",
      remoteAddress: "203.0.113.7",
      headers: {},
      consumeTicket: refuseTicket,
      localCredential: "valid",
      requireTicketOnLoopback: true,
    });
    expect(v.allow).toBe(false);
  });

  it("never lets a credential admit a RELAYED peer presenting as loopback", () => {
    const v = decide(
      { "x-forwarded-for": "203.0.113.7" },
      { requireTicketOnLoopback: true, localCredential: "valid" },
    );
    expect(v.allow).toBe(false);
  });

  it("still admits a tokenless loopback bridge while the deprecation window is open", () => {
    const v = decide({});
    expect(v).toMatchObject({ allow: true, deprecated: true });
  });

  it("prefers the credential over the grace, so the log shows a credential and not a horizon", () => {
    const v = decide({}, { localCredential: "valid" });
    expect(v.allow).toBe(true);
    expect(v).not.toHaveProperty("deprecated", true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Live gateway: counter-proof emission, relay, legacy (tasks 4.3-4.5).
// ──────────────────────────────────────────────────────────────────────────
describe("live gateway counter-proof (E16, X1, X4)", () => {
  const gateways: Array<ReturnType<typeof createPiGateway>> = [];
  const sockets: WebSocket[] = [];
  const servers: net.Server[] = [];
  let tmp: string;
  const logs: string[] = [];

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gw-cp-"));
    logs.length = 0;
  });
  afterEach(async () => {
    for (const w of sockets.splice(0)) w.terminate();
    for (const g of gateways.splice(0)) g.stop();
    for (const sv of servers.splice(0)) sv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const freePort = () =>
    new Promise<number>((resolve) => {
      const srv = net.createServer().listen(0, "127.0.0.1", () => {
        const port = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(port));
      });
    });

  async function startGateway(over: { grace: boolean; socket?: boolean }) {
    const sm = createMemorySessionManager();
    const g = createPiGateway(sm, {
      pingInterval: 0,
      bridgeAuth: {
        consumeTicket: refuseTicket,
        requireTicketOnLoopback: !over.grace,
        verifyCredential: createLocalCredentialVerifier({
          token,
          acceptLegacyToken: true,
          log: (l) => logs.push(l),
        }),
        log: (l) => logs.push(l),
      },
    });
    gateways.push(g);
    const port = await freePort();
    g.start(port, "127.0.0.1");
    let sock: string | undefined;
    if (over.socket) {
      sock = path.join(tmp, "gw.sock");
      await g.startOnSocket(sock);
    }
    await new Promise((r) => setTimeout(r, 50));
    return { g, sm, port, sock };
  }

  interface DialResult {
    status: "open" | number;
    counter?: string | string[];
    ws: WebSocket;
  }
  function dial(url: string, headers: Record<string, string>): Promise<DialResult> {
    return new Promise((resolve) => {
      const ws = new WebSocket(url, { headers });
      sockets.push(ws);
      let counter: string | string[] | undefined;
      ws.on("upgrade", (res) => {
        counter = res.headers[LOCAL_PROOF_SERVER_HEADER.toLowerCase()];
      });
      ws.on("open", () => resolve({ status: "open", counter, ws }));
      ws.on("unexpected-response", (_r, res) => resolve({ status: res.statusCode ?? 0, ws }));
      ws.on("error", () => resolve({ status: 0, ws }));
      setTimeout(() => resolve({ status: 0, ws }), 4000);
    });
  }

  const proofFor = (port: number, purpose = BRIDGE_PURPOSE) =>
    mintProof({ token, binding: canonicalBinding("127.0.0.1", port), purpose });

  it("E16: counter-proof only on a proof admission; never unix, legacy, grace or refused", async () => {
    const { port, sock } = await startGateway({ grace: false, socket: true });
    const p = proofFor(port);
    const ok = await dial(`ws://127.0.0.1:${port}/`, { "X-Pi-Local-Proof": p.header });
    expect(ok.status).toBe("open");
    expect(
      verifyCounterProof({
        token,
        binding: canonicalBinding("127.0.0.1", port),
        nonce: p.nonce,
        mac: p.mac,
        header: ok.counter,
      }),
    ).toBe(true);

    const legacy = await dial(`ws://127.0.0.1:${port}/`, { [LOCAL_TOKEN_HEADER]: token });
    expect(legacy.status).toBe("open");
    expect(legacy.counter).toBeUndefined();

    // A proof carried over the UNIX socket is never stamped and gets no counter-proof.
    const viaUnix = await dial(`ws+unix://${sock}:/`, { "X-Pi-Local-Proof": proofFor(port).header });
    expect(viaUnix.status).toBe("open");
    expect(viaUnix.counter).toBeUndefined();

    // No-grace listener, no credential → refused (no 101, no counter-proof).
    const refused = await dial(`ws://127.0.0.1:${port}/`, {});
    expect(refused.status).toBe(401);
    expect(refused.counter).toBeUndefined();
  });

  it("E16: a grace admission carries no counter-proof", async () => {
    const { port } = await startGateway({ grace: true });
    const r = await dial(`ws://127.0.0.1:${port}/`, {});
    expect(r.status).toBe("open");
    expect(r.counter).toBeUndefined();
  });

  it("X1: a relay earns nothing — binding-mismatch, no counter-proof, 0 registrations", async () => {
    for (const grace of [true, false]) {
      logs.length = 0;
      const { g, port: A } = await startGateway({ grace });
      // TCP relay on B piping to the genuine gateway on A.
      const relay = net.createServer((c) => {
        const up = net.connect(A, "127.0.0.1");
        c.pipe(up);
        up.pipe(c);
        c.on("error", () => up.destroy());
        up.on("error", () => c.destroy());
      });
      servers.push(relay);
      await new Promise<void>((r) => relay.listen(0, "127.0.0.1", () => r()));
      const B = (relay.address() as net.AddressInfo).port;

      const p = proofFor(B); // bound to the relay's endpoint, as a marked bridge would
      const r = await dial(`ws://127.0.0.1:${B}/`, { "X-Pi-Local-Proof": p.header });
      expect(logs.join("\n")).toContain("binding-mismatch");
      expect(r.counter).toBeUndefined();
      if (grace) {
        // Admitted tokenlessly, but the bridge (which demands a counter-proof) aborts
        // on `upgrade` before sending anything.
        expect(r.status).toBe("open");
        r.ws.terminate();
      } else {
        expect(r.status).toBe(401);
      }
      expect(g.isSessionConnected("00000000-0000-4000-8000-0000000000aa")).toBe(false);
    }
  });

  it("X4: a legacy client sending the raw token is admitted on grace and fallback listeners, logged deprecated", async () => {
    for (const grace of [true, false]) {
      logs.length = 0;
      const { port } = await startGateway({ grace });
      const r = await dial(`ws://127.0.0.1:${port}/`, { [LOCAL_TOKEN_HEADER]: token });
      expect(r.status).toBe("open");
      expect(logs.join("\n")).toMatch(/DEPRECATED raw X-Pi-Local-Token/);
    }
  });
});

describe("the token file itself", () => {
  it("is 0600 in a 0700 dir — the guarantee the whole scheme rests on", () => {
    if (process.platform === "win32") return; // chmod is a documented no-op (task 5.5)
    expect(fs.statSync(path.join(tokenDir, "token")).mode & 0o777).toBe(0o600);
    expect(fs.statSync(tokenDir).mode & 0o777).toBe(0o700);
  });
});

/**
 * #E11 — the same refusal through the REAL pi-gateway TCP listener: a browser
 * page dialling `ws://127.0.0.1:<piPort>` gets 401 and registers nothing.
 * See change: fix-ws-origin-cswsh.
 */
describe("pi-gateway TCP listener refuses a browser Origin (#E11)", () => {
  it("401s an origin-bearing dial, registers no session, and names the cause in the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handle = await createTestServer();
    try {
      const before = handle.server.sessionManager.listAll().length;
      const status = await new Promise<number | "open">((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${handle.piPort}/`, {
          headers: { origin: "http://attacker.example" },
        });
        ws.on("open", () => {
          ws.close();
          resolve("open");
        });
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
        ws.on("error", () => resolve(0));
        setTimeout(() => resolve(0), 5000);
      });

      expect(status).toBe(401);
      expect(handle.server.sessionManager.listAll().length).toBe(before);
      const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("[pi-gateway]");
      expect(logged).toContain("browser-origin");
    } finally {
      await handle.stop();
      warn.mockRestore();
    }
  }, 20000);
});
