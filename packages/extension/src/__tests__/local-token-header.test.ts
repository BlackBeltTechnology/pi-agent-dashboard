/**
 * The bridge side of D6 (task 5.3): a loopback TCP dial carries a local
 * credential PROOF — never the token — bound to the address actually reached.
 *
 * Folds test-plan E17 (marker comparison) and E18 (name-addressed dial bound to
 * the reached address).
 *
 * See change: add-pi-gateway-transport-identity; loopback-credential-proof (tasks 5.8-5.10).
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  deriveKey,
  LOCAL_PROOF_SERVER_HEADER,
  parseProof,
  serverCounterProof,
  verifyProofMac,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localCredentialPlan, markerEnforces, readLocalToken } from "../local-token-header.js";

let home: string;
const TOKEN = "s3cret-token";
const opened: net.Socket[] = [];

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-token-"));
});
afterEach(() => {
  for (const s of opened.splice(0)) s.destroy();
});

function writeToken(value: string) {
  const dir = path.join(home, ".pi", "dashboard", "local");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "token"), `${value}\n`);
}

/** A fake connector standing in for `net.connect`: reports a chosen remote address. */
function fakeConnect(remoteAddress: string, calls: Array<{ host: string; port: number }> = []) {
  return async (host: string, port: number) => {
    calls.push({ host, port });
    const socket = new net.Socket();
    Object.defineProperty(socket, "remoteAddress", { value: remoteAddress });
    Object.defineProperty(socket, "remotePort", { value: port });
    opened.push(socket);
    return socket;
  };
}

describe("readLocalToken", () => {
  it("reads the token this HOME's dashboard wrote, trimmed", () => {
    writeToken(TOKEN);
    expect(readLocalToken({ homedir: home })).toBe(TOKEN);
  });

  it("returns undefined when no dashboard has ever written one", () => {
    expect(readLocalToken({ homedir: home })).toBeUndefined();
  });

  it("treats an empty token file as no token, never as an empty credential", () => {
    writeToken("   ");
    expect(readLocalToken({ homedir: home })).toBeUndefined();
  });
});

describe("E17 marker comparison", () => {
  const marker = "ws://127.0.0.1:9999";
  it.each([
    ["ws://127.0.0.1:9999/", true],
    ["WS://127.0.0.1:9999", true],
    ["ws://127.0.0.1:9999/x", true],
    ["ws://127.0.0.1:9998", false],
    ["ws://[::1]:9999", false],
  ])("dial %s → enforce %s", (dial, expected) => {
    expect(markerEnforces(marker, dial)).toBe(expected);
  });

  it("an empty or absent marker means unmarked", () => {
    expect(markerEnforces("", "ws://127.0.0.1:9999")).toBe(false);
    expect(markerEnforces(undefined, "ws://127.0.0.1:9999")).toBe(false);
  });

  it("an unparsable marker enforces on every loopback dial (fail closed)", () => {
    expect(markerEnforces("not a url", "ws://127.0.0.1:1234")).toBe(true);
    expect(markerEnforces("not a url", "ws://localhost:1")).toBe(true);
  });

  it("compares the port after applying the default and the host case-insensitively", () => {
    expect(markerEnforces("ws://LOCALHOST", "ws://localhost:80")).toBe(true);
    expect(markerEnforces("ws://[::1]:9", "ws://[::1]:9/y")).toBe(true);
  });
});

describe("localCredentialPlan", () => {
  beforeEach(() => writeToken(TOKEN));

  it("gets NO plan and no pre-connect for a unix socket or a remote endpoint", async () => {
    const calls: Array<{ host: string; port: number }> = [];
    const connect = fakeConnect("127.0.0.1", calls);
    for (const ep of ["ws+unix:///tmp/gateway-9999.sock", "wss://remote.example", "ws://dash.example:9999"]) {
      expect(await localCredentialPlan(ep, { env: { homedir: home }, marker: "ws://127.0.0.1:9999", connect })).toBeUndefined();
    }
    expect(calls).toHaveLength(0);
  });

  it("is undefined when there is no token to prove with and nothing demands a server proof", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "no-token-"));
    expect(
      await localCredentialPlan("ws://127.0.0.1:9999", { env: { homedir: empty }, marker: undefined, connect: fakeConnect("127.0.0.1") }),
    ).toBeUndefined();
  });

  it("sends a proof — never the raw token — and no verifyUpgrade when unmarked", async () => {
    const plan = await localCredentialPlan("ws://127.0.0.1:9999", {
      env: { homedir: home },
      marker: undefined,
      connect: fakeConnect("127.0.0.1"),
    });
    expect(plan?.headers).toBeDefined();
    expect(Object.keys(plan!.headers!)).toEqual(["X-Pi-Local-Proof"]);
    expect(JSON.stringify(plan!.headers)).not.toContain(TOKEN);
    expect(plan!.verifyUpgrade).toBeUndefined();
    expect(plan!.createConnection).toBeTypeOf("function");
  });

  it("E18: a name-addressed dial is bound to the address actually reached", async () => {
    for (const reached of ["::1", "127.0.0.1"]) {
      const calls: Array<{ host: string; port: number }> = [];
      const connect = fakeConnect(reached, calls);
      const plan = await localCredentialPlan("ws://localhost:4242", { env: { homedir: home }, marker: undefined, connect });
      // resolved exactly as before: the connector is handed the NAME
      expect(calls).toEqual([{ host: "localhost", port: 4242 }]);
      const proof = parseProof(plan!.headers!["X-Pi-Local-Proof"])!;
      const binding = reached === "::1" ? "[::1]:4242" : "127.0.0.1:4242";
      expect(verifyProofMac(deriveKey(TOKEN), proof, binding, "bridge")).toBe(true);
      // the socket given to ws is the one that was connected
      const sock = plan!.createConnection!() as net.Socket;
      expect(opened).toContain(sock);
      expect(plan!.headers).not.toHaveProperty("X-Pi-Local-Token");
    }
  });

  it("mints a fresh nonce for every plan", async () => {
    const mk = () =>
      localCredentialPlan("ws://127.0.0.1:9999", { env: { homedir: home }, marker: undefined, connect: fakeConnect("127.0.0.1") });
    const a = parseProof((await mk())!.headers!["X-Pi-Local-Proof"])!;
    const b = parseProof((await mk())!.headers!["X-Pi-Local-Proof"])!;
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("a marked dial verifies the counter-proof: missing and wrong fail, the right one passes", async () => {
    const plan = await localCredentialPlan("ws://127.0.0.1:9999/", {
      env: { homedir: home },
      marker: "ws://127.0.0.1:9999",
      connect: fakeConnect("127.0.0.1"),
    });
    const verify = plan!.verifyUpgrade!;
    expect(verify({ headers: {} })).toEqual({ ok: false, cause: "server-proof-missing" });
    expect(verify({ headers: { [LOCAL_PROOF_SERVER_HEADER.toLowerCase()]: `v1.${"x".repeat(43)}` } })).toEqual({
      ok: false,
      cause: "server-proof-invalid",
    });
    const proof = parseProof(plan!.headers!["X-Pi-Local-Proof"])!;
    const good = serverCounterProof({ token: TOKEN, binding: "127.0.0.1:9999", nonce: proof.nonce, mac: proof.mac });
    expect(verify({ headers: { [LOCAL_PROOF_SERVER_HEADER.toLowerCase()]: good } })).toEqual({ ok: true });
  });

  it("a marked dial with no token to verify against fails closed", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "no-token-"));
    const plan = await localCredentialPlan("ws://127.0.0.1:9999", {
      env: { homedir: empty },
      marker: "ws://127.0.0.1:9999",
      connect: fakeConnect("127.0.0.1"),
    });
    expect(plan!.verifyUpgrade!({ headers: {} })).toMatchObject({ ok: false });
  });

  it("a marked 127/8 endpoint other than 127.0.0.1 still gets a proof and server verification", async () => {
    const plan = await localCredentialPlan("ws://127.0.0.5:9999", {
      env: { homedir: home },
      marker: "ws://127.0.0.5:9999",
      connect: fakeConnect("127.0.0.5"),
    });
    expect(plan?.headers?.["X-Pi-Local-Proof"]).toBeTruthy();
    expect(plan?.verifyUpgrade).toBeTypeOf("function");
    const proof = parseProof(plan!.headers!["X-Pi-Local-Proof"])!;
    expect(verifyProofMac(deriveKey(TOKEN), proof, "127.0.0.5:9999", "bridge")).toBe(true);
  });

  it("a non-loopback address gets no plan even when it is marked", async () => {
    const calls: Array<{ host: string; port: number }> = [];
    expect(
      await localCredentialPlan("ws://10.1.2.3:9999", {
        env: { homedir: home },
        marker: "ws://10.1.2.3:9999",
        connect: fakeConnect("10.1.2.3", calls),
      }),
    ).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("a marker for another endpoint does not demand a counter-proof here", async () => {
    const plan = await localCredentialPlan("ws://127.0.0.1:7777", {
      env: { homedir: home },
      marker: "ws://127.0.0.1:9999",
      connect: fakeConnect("127.0.0.1"),
    });
    expect(plan!.verifyUpgrade).toBeUndefined();
  });
});
