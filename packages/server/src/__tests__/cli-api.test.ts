/**
 * `pi-dashboard api <METHOD> <path>` — a shell-friendly, proof-minting REST call — and the
 * subcommand-word scan that dispatches it.
 * See change: close-container-loopback-impersonation (D4; test-plan #E16, #E17, #E18).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { classifyArgv, cmdApi } from "../cli.js";

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}
const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(undefined)))));
});

/** A recording loopback server answering with `reply`. */
async function fake(reply: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ port: number; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString() });
      reply(req, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return { port: (server.address() as AddressInfo).port, seen };
}

function run(argv: string[], port: number) {
  const out: string[] = [];
  const err: string[] = [];
  return cmdApi(argv, { port, host: "127.0.0.1" }, { out: (t) => out.push(t), err: (l) => err.push(l), localToken: "tok-for-api-tests", timeoutMs: 5000 }).then((code) => ({ code, out, err }));
}

describe("E16 — path rule: only a same-origin path is ever sent", () => {
  it.each([
    ["/api/health", true],
    ["/api/file?path=a", true],
    ["api/health", false],
    ["//evil.example/x", false],
    ["/\\evil", false],
    ["https://x/api", false],
    ["/a\u0007", false],
    ["/a#b", false],
  ])("%j → sent=%s", async (target, sent) => {
    const { port, seen } = await fake((_q, res) => res.end("{}"));
    const { code, err } = await run(["GET", target], port);
    if (sent) {
      expect(code).toBe(0);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.url).toBe(target);
    } else {
      expect(code).toBe(2);
      expect(seen).toHaveLength(0);
      expect(err.join("\n")).toContain("usage:");
    }
  });

  it("carries a proof bound to this method + target, and never the raw token", async () => {
    const { port, seen } = await fake((_q, res) => res.end("{}"));
    await run(["POST", "/api/restart", "--data", '{"dev":true}'], port);
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.headers["x-pi-local-proof"]).toMatch(/^v1\./);
    expect(JSON.stringify(seen[0]?.headers).toLowerCase()).not.toContain("x-pi-local-token");
    expect(seen[0]?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(seen[0]?.body ?? "")).toEqual({ dev: true });
  });

  it("an unsupported method, a missing path, a third positional and non-JSON --data are usage errors with nothing sent", async () => {
    const { port, seen } = await fake((_q, res) => res.end("{}"));
    for (const argv of [["TRACE", "/x"], ["GET"], ["GET", "/x", "/y"], ["POST", "/x", "--data", "{not json"], []]) {
      expect((await run(argv, port)).code, JSON.stringify(argv)).toBe(2);
    }
    expect(seen).toHaveLength(0);
  });
});

describe("E17 — exit codes", () => {
  it("2xx → 0 with the body on stdout; 404 → 1 with the body on stderr; not listening → 2 naming the server", async () => {
    const ok = await fake((_q, res) => res.end('{"ok":true}'));
    const a = await run(["GET", "/x"], ok.port);
    expect(a).toMatchObject({ code: 0, out: ['{"ok":true}'], err: [] });

    const missing = await fake((_q, res) => {
      res.statusCode = 404;
      res.end('{"error":"nope"}');
    });
    const b = await run(["GET", "/x"], missing.port);
    expect(b.code).toBe(1);
    expect(b.out).toEqual([]);
    expect(b.err.join("\n")).toContain("nope");

    const dead = await fake((_q, res) => res.end());
    const closedPort = dead.port;
    await new Promise((r) => servers[servers.length - 1]!.close(() => r(undefined)));
    const c = await run(["GET", "/x"], closedPort);
    expect(c.code).toBe(2);
    expect(c.err.join("\n")).toMatch(/not running/);
  });

  it("a 302 to another origin is not followed: exit 1, and the target receives no request", async () => {
    const evil = await fake((_q, res) => res.end("pwned"));
    const redirecting = await fake((_q, res) => {
      res.statusCode = 302;
      res.setHeader("location", `http://127.0.0.1:${evil.port}/stolen`);
      res.end();
    });
    const r = await run(["GET", "/x"], redirecting.port);
    expect(r.code).toBe(1);
    expect(redirecting.seen).toHaveLength(1);
    expect(evil.seen).toHaveLength(0);
  });
});

describe("E18 — one scan finds the subcommand word", () => {
  it.each([
    [["--port", "9000", "api", "GET", "/x"], { kind: "command", word: "api" }],
    [["frobnicate"], { kind: "unknown", word: "frobnicate" }],
    [["--port", "9000"], { kind: "none" }],
    [["token", "list"], { kind: "command", word: "token" }],
    [["pair"], { kind: "command", word: "pair" }],
    [["api"], { kind: "command", word: "api" }],
    [["--port", "9000", "stop", "--force"], { kind: "subcommand", word: "stop" }],
    [["--host", "0.0.0.0", "login", "--local"], { kind: "command", word: "login" }],
    [["open", "--url", "http://127.0.0.1:8000", "--print"], { kind: "subcommand", word: "open" }],
    [["service", "exec", "x"], { kind: "command", word: "service" }],
    [["--dev", "--no-tunnel"], { kind: "none" }],
  ])("%j → %j", (argv, want) => {
    expect(classifyArgv(argv)).toMatchObject(want);
  });

  it("a flag VALUE is never mistaken for the word (--port 9000 api …, --url http://… open)", () => {
    expect(classifyArgv(["--pi-port", "9999", "--port", "8000", "status"])).toMatchObject({ kind: "subcommand", word: "status" });
    expect(classifyArgv(["--url", "http://127.0.0.1:8000", "open"])).toMatchObject({ kind: "subcommand", word: "open" });
  });
});
