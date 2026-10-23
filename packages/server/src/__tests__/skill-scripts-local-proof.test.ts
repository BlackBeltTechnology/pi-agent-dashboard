/**
 * The dev-loop skill scripts reach the local dashboard with a proof, by address literal.
 * See change: close-container-loopback-impersonation (D5).
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localFetch } from "../../../../.pi/skills/implement/scripts/local-proof-fetch.js";
import { createLocalCredentialVerifier, hasLocalCredential } from "../auth/local-credential.js";

let home: string;
let orig: string | undefined;
let server: http.Server | undefined;
beforeEach(() => {
  orig = process.env.HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "skill-proof-"));
  process.env.HOME = home;
  fs.mkdirSync(path.join(home, ".pi", "dashboard", "local"), { recursive: true });
  fs.writeFileSync(path.join(home, ".pi", "dashboard", "local", "token"), "skill-script-token\n");
});
afterEach(async () => {
  process.env.HOME = orig;
  fs.rmSync(home, { recursive: true, force: true });
  await new Promise((r) => (server ? server.close(() => r(undefined)) : r(undefined)));
  server = undefined;
});

describe("implement/scripts/local-proof-fetch", () => {
  it("dials the loopback literal and the proof verifies for exactly that method + target; no raw token header", async () => {
    const verifier = createLocalCredentialVerifier({ token: "skill-script-token", acceptLegacyToken: false, log: () => {} });
    const verdicts: boolean[] = [];
    const hosts: Array<string | undefined> = [];
    server = http.createServer((req, res) => {
      hosts.push(req.headers.host);
      verifier.stamp(req as never, { kind: "http", boundAt: 0 });
      verdicts.push(hasLocalCredential(req.headers));
      res.setHeader("content-type", "application/json");
      res.end("{}");
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;

    expect((await localFetch(port, "/api/restart", { method: "POST" })).status).toBe(200);
    expect((await localFetch(port, "/api/health")).status).toBe(200);
    expect(verdicts).toEqual([true, true]);
    expect(hosts.every((h) => h?.startsWith("127.0.0.1:"))).toBe(true); // never `localhost`
  });

  it("with no token on this host it sends no proof header (the server's refusal is then the honest answer)", async () => {
    fs.rmSync(path.join(home, ".pi", "dashboard", "local", "token"));
    let seen: http.IncomingHttpHeaders | undefined;
    server = http.createServer((req, res) => {
      seen = req.headers;
      res.end("{}");
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    await localFetch((server.address() as AddressInfo).port, "/api/health");
    expect(seen?.["x-pi-local-proof"]).toBeUndefined();
  });
});
