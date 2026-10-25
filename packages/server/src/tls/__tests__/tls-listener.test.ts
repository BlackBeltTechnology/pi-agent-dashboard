import { EventEmitter } from "node:events";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import type { TlsConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCertSourceType, unregisterCertSourceType } from "../source-registry.js";
import { TlsListener } from "../tls-listener.js";
import { CA_PEM, FakeSource, fixture, handshake, handshakeEventually } from "./helpers.js";

/**
 * TlsListener against a plain `http` dispatch (no Fastify): SNI selection, hot
 * swap, bind isolation + retry, plaintext refusal, shutdown, endpoints.
 * (test-plan #E1, #E2, #E6, #E8, #E22–#E25, #X1, #X3, #X7, #X11).
 * See change: add-tailscale-cert-tls.
 */

let root: string;
let cfg: TlsConfig;
let src: FakeSource;
let listener: TlsListener;
const quiet = { info: () => undefined, warn: () => undefined };
let requests: string[];

function makeListener(): TlsListener {
  return new TlsListener({
    dataRoot: root,
    getTlsConfig: () => cfg,
    log: quiet,
    dispatch: {
      request: (req, res) => {
        requests.push(req.url ?? "");
        res.writeHead(200, { "content-type": "text/plain", "content-length": "2" });
        res.end("ok");
      },
      upgrade: (_req, socket) => socket.destroy(),
      clientError: (_err, socket) => socket.destroy(),
    },
  });
}

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tls-listener-"));
  requests = [];
  src = new FakeSource({ names: [] });
  registerCertSourceType({ type: "fake", defaultId: "fake", validate: () => null, create: () => src });
  cfg = { enabled: true, port: 0, host: "127.0.0.1", sources: [{ type: "fake" }], acceptBridges: false };
  listener = makeListener();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await listener.stop();
  unregisterCertSourceType("fake");
  fs.rmSync(root, { recursive: true, force: true });
});

async function up(names: string[]): Promise<number> {
  src.namesValue = names;
  await listener.markReady();
  await waitFor(() => listener.manager.status().certs.length === names.length && listener.manager.status().certs.every((c) => c.held));
  const port = listener.boundTlsPort();
  if (!port) throw new Error("not bound");
  return port;
}

describe("#E1 disabled by default", () => {
  it("binds nothing and reports only {enabled,bound}", async () => {
    cfg = { enabled: false, port: 0, host: "127.0.0.1", sources: [], acceptBridges: false };
    await listener.markReady();
    expect(listener.isBound).toBe(false);
    expect(listener.status(true)).toEqual({ enabled: false, bound: false });
    expect(listener.tlsListenerNames()).toEqual([]);
  });
});

describe("#E2 enabled without sources", () => {
  it("does not bind and reports the no-sources gate", async () => {
    cfg = { enabled: true, port: 0, host: "127.0.0.1", sources: [], acceptBridges: false };
    await listener.markReady();
    expect(listener.isBound).toBe(false);
    const st = listener.status(true);
    expect("gates" in st && st.gates).toContainEqual(expect.objectContaining({ id: "no-sources", ok: false }));
  });
});

describe("#E6 certificate selection per SNI name", () => {
  it("serves exact then single-label wildcard; everything else fails the handshake", async () => {
    const port = await up(["host.example.ts.net", "*.example.com"]);
    expect(await handshakeEventually(port, "host.example.ts.net")).toMatchObject({ ok: true, cn: "host.example.ts.net" });
    expect(await handshakeEventually(port, "dash.example.com")).toMatchObject({ ok: true, cn: "*.example.com" });
    for (const name of ["a.b.example.com", "example.com", "other.test"]) {
      const r = await handshake(port, name);
      expect(r.ok, `${name}: ${JSON.stringify(r)}`).toBe(false);
    }
    const noSni = await handshake(port, undefined); // no SNI (IP URL)
    expect(noSni.ok, `no SNI: ${JSON.stringify(noSni)}`).toBe(false);
    const ipSni = await handshake(port, "127.0.0.1"); // IP literal sends no SNI
    expect(ipSni.ok, `ip SNI: ${JSON.stringify(ipSni)}`).toBe(false);
  });

  it("a session resumed after its name was pruned also fails", async () => {
    const port = await up(["host.example.ts.net"]);
    // TLS 1.2 so the session (ticket) is available right after the handshake.
    const session = await new Promise<Buffer>((resolve, reject) => {
      const s = tls.connect(
        { host: "127.0.0.1", port, servername: "host.example.ts.net", ca: CA_PEM, maxVersion: "TLSv1.2", checkServerIdentity: () => undefined },
        () => {
          const sess = s.getSession();
          s.end();
          if (sess) resolve(sess);
          else reject(new Error("no session"));
        },
      );
      s.on("error", reject);
    });
    src.namesValue = [];
    await listener.manager.reconcile([src]);
    expect(listener.manager.heldExactNames()).toEqual([]);
    const result = await new Promise<boolean>((resolve) => {
      const s = tls.connect({ host: "127.0.0.1", port, servername: "host.example.ts.net", ca: CA_PEM, maxVersion: "TLSv1.2", session, checkServerIdentity: () => undefined }, () => {
        s.end();
        resolve(true);
      });
      s.on("error", () => resolve(false));
    });
    expect(result).toBe(false);
  });
});

describe("#E8 hot swap", () => {
  /** Read one HTTP/1.1 response (headers + content-length body) from `sock`. */
  const readResponse = (sock: tls.TLSSocket): Promise<string> =>
    new Promise((resolve, reject) => {
      let buf = "";
      const onData = (c: Buffer): void => {
        buf += c.toString("latin1");
        const head = buf.indexOf("\r\n\r\n");
        const len = /content-length: (\d+)/i.exec(buf)?.[1];
        if (head >= 0 && len !== undefined && buf.length >= head + 4 + Number(len)) {
          sock.off("data", onData);
          resolve(buf);
        }
      };
      sock.on("data", onData);
      sock.once("error", reject);
    });

  it("new connections see the new certificate; an open socket keeps working; no restart", async () => {
    const port = await up(["host.example.ts.net"]);
    // One explicit keep-alive socket, used before and after the swap (deterministic reuse).
    const sock = tls.connect({ host: "127.0.0.1", port, servername: "host.example.ts.net", ca: CA_PEM, checkServerIdentity: () => undefined });
    await new Promise<void>((r) => sock.once("secureConnect", () => r()));
    const before = sock.getPeerCertificate().fingerprint256;
    const request = "GET /x HTTP/1.1\r\nHost: host.example.ts.net\r\nConnection: keep-alive\r\n\r\n";
    sock.write(request);
    expect(await readResponse(sock)).toContain("200 OK");

    const pid = process.pid;
    // Swap the stored certificate for the same name (the renewed one).
    const next = fixture("90d-host.example.ts.net");
    const entry = listener.store.get("host.example.ts.net");
    if (!entry) throw new Error("missing entry");
    listener.store.set({ ...entry, ctx: tls.createSecureContext({ cert: next.certPem, key: next.keyPem }) });

    sock.write(request); // the same connection keeps serving across the swap
    const second = await readResponse(sock);
    expect(second).toContain("200 OK");
    expect(second).toContain("ok");
    expect(sock.getPeerCertificate().fingerprint256).toBe(before);
    sock.destroy();

    const fresh = await new Promise<string>((resolve) => {
      const s = tls.connect({ host: "127.0.0.1", port, servername: "host.example.ts.net", ca: CA_PEM, checkServerIdentity: () => undefined }, () => {
        const f = s.getPeerCertificate().fingerprint256;
        s.end();
        resolve(f);
      });
    });
    expect(fresh).not.toBe(before);
    expect(process.pid).toBe(pid);
  });
});

describe("#X3 no plaintext on the TLS port", () => {
  it("never answers application content to a plain HTTP request and closes", async () => {
    const port = await up(["a.test"]);
    const bytes = await new Promise<string>((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => s.write("GET /api/health HTTP/1.1\r\nHost: a.test\r\n\r\n"));
      let data = "";
      s.on("data", (c) => (data += c.toString("latin1")));
      s.on("close", () => resolve(data));
      s.on("error", () => resolve(data));
      setTimeout(() => {
        s.destroy();
        resolve(`TIMEOUT:${data}`);
      }, 2000);
    });
    expect(bytes).not.toContain("HTTP/1.1 200");
    expect(bytes.startsWith("TIMEOUT")).toBe(false);
    expect(requests).toEqual([]);
  });
});

describe("#X7 shutdown closes the TLS listener", () => {
  it("closes an idle keep-alive socket within 2 s and refuses new connections", async () => {
    const port = await up(["a.test"]);
    const sock = tls.connect({ host: "127.0.0.1", port, servername: "a.test", ca: CA_PEM, checkServerIdentity: () => undefined });
    await new Promise<void>((r) => sock.once("secureConnect", () => r()));
    const closed = new Promise<void>((r) => sock.once("close", () => r()));
    await listener.stop();
    await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error("not closed")), 2000))]);
    expect((await handshake(port, "a.test")).ok).toBe(false);
  });
});

describe("#X1 bind failure is isolated and reported", () => {
  it("reports EADDRINUSE as bindError without throwing", async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", () => r()));
    const busy = (blocker.address() as net.AddressInfo).port;
    cfg = { enabled: true, port: busy, host: "127.0.0.1", sources: [{ type: "fake" }], acceptBridges: false };
    await listener.markReady();
    const st = listener.status(true);
    expect(st).toMatchObject({ enabled: true, bound: false });
    expect("bindError" in st && st.bindError).toContain("EADDRINUSE");
    await new Promise<void>((r) => blocker.close(() => r()));
  });
});

describe("#X11 bind retried until the address exists", () => {
  it("retries +1, +2, +4, +8, +15, +15 min, then binds once the address appears", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let available = false;
    let attempts = 0;
    const realCreate = https.createServer.bind(https);
    vi.spyOn(https, "createServer").mockImplementation(((opts: https.ServerOptions) => {
      if (available) return realCreate(opts);
      const fake = new EventEmitter() as unknown as https.Server;
      Object.assign(fake, {
        keepAliveTimeout: 0,
        requestTimeout: 0,
        setTimeout: () => fake,
        close: () => fake,
        closeAllConnections: () => undefined,
        listen: () => {
          attempts += 1;
          queueMicrotask(() => fake.emit("error", Object.assign(new Error("address not available"), { code: "EADDRNOTAVAIL" })));
          return fake;
        },
      });
      return fake;
    }) as typeof https.createServer);

    cfg = { enabled: true, port: 0, host: "127.0.0.1", sources: [{ type: "fake" }], acceptBridges: false };
    await listener.markReady();
    expect(attempts).toBe(1);
    expect(listener.status(true)).toMatchObject({ bound: false, bindError: expect.stringContaining("EADDRNOTAVAIL") });

    const at: number[] = [];
    let elapsed = 0;
    for (const waitMin of [1, 2, 4, 8, 15, 15]) {
      const before = attempts;
      await vi.advanceTimersByTimeAsync((waitMin * 60_000) - 1);
      expect(attempts).toBe(before); // not a ms early
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(before + 1);
      elapsed += waitMin;
      at.push(elapsed);
    }
    expect(at).toEqual([1, 3, 7, 15, 30, 45]);

    available = true;
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    vi.useRealTimers();
    await waitFor(() => listener.isBound);
    expect(listener.status(true)).toMatchObject({ bound: true });
  });
});

describe("#E22–#E25 endpoints", () => {
  async function upAdvertised(host: string, names: string[], advertise: boolean[] = names.map(() => true)): Promise<void> {
    cfg = { enabled: true, port: 0, host, sources: [{ type: "fake" }], acceptBridges: false };
    src.namesValue = names;
    src.obtainImpl = async (name) => {
      const f = name === "*.b.test" ? fixture("b.test") : name === "*.example.com" ? fixture("wildcard.example.com") : fixture(name as "a.test");
      return { ...f, advertise: advertise[names.indexOf(name)] ?? true, kind: name.endsWith(".ts.net") ? "magicdns" : "domain" };
    };
    await listener.markReady();
    await waitFor(() => {
      const certs = listener.manager.status().certs;
      return certs.length === names.length && certs.every((c) => c.held);
    });
  }

  it("#E22 enumerates https://<name>:<port> with tls:true on a reachable bind", async () => {
    await upAdvertised("0.0.0.0", ["host.example.ts.net"]);
    const port = listener.boundTlsPort();
    expect(listener.tlsListenerUrls()).toEqual([{ kind: "magicdns", url: `https://host.example.ts.net:${port}`, tls: true }]);
    src.namesValue = [];
    await listener.manager.reconcile([src]);
    expect(listener.tlsListenerUrls()).toEqual([]); // no certificate, no secure endpoint
  });

  it("#E23 omits the port when it is 443", async () => {
    await upAdvertised("0.0.0.0", ["host.example.ts.net"]);
    (listener as unknown as { boundPort: number }).boundPort = 443;
    expect(listener.tlsListenerUrls().map((e) => e.url)).toEqual(["https://host.example.ts.net"]);
  });

  it("#E24 a loopback bind advertises nothing and reports the bind-reachable gate", async () => {
    await upAdvertised("127.0.0.1", ["host.example.ts.net"]);
    expect(listener.tlsListenerUrls()).toEqual([]);
    const st = listener.status(true);
    expect("gates" in st && st.gates).toContainEqual(expect.objectContaining({ id: "bind-reachable", ok: false }));
  });

  it("#E25 non-advertisable and wildcard certificates are never enumerated", async () => {
    await upAdvertised("0.0.0.0", ["a.test", "*.b.test"], [false, true]);
    expect(listener.tlsListenerUrls()).toEqual([]);
  });
});

describe("names thunk (#E27 support)", () => {
  it("names are empty while unbound or disabled", async () => {
    await up(["host.example.ts.net"]);
    expect(listener.tlsListenerNames()).toEqual(["host.example.ts.net"]);
    cfg = { ...cfg, enabled: false };
    await listener.reconcile();
    expect(listener.tlsListenerNames()).toEqual([]);
  });
});

describe("status disclosure", () => {
  it("non-detailed callers see only enabled + bound", async () => {
    await up(["a.test"]);
    expect(listener.status(false)).toEqual({ enabled: true, bound: true });
  });
});

