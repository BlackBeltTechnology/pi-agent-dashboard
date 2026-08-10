import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COOKIE_NAME, signToken } from "../auth/auth.js";
import { validateWsUpgrade } from "../auth/auth-plugin.js";
import { parseBearerHeader } from "../auth/bearer-auth.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { WsTicketStore } from "../auth/ws-ticket.js";

const SECRET = "test-secret-for-bearer";
let tmpDir: string;
let reg: PairedDeviceRegistry;
let token: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bearer-"));
  reg = new PairedDeviceRegistry(path.join(tmpDir, "paired.json"));
  token = reg.add("dev").token;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("bearer header parsing", () => {
  it("extracts a Bearer token (case-insensitive), else null", () => {
    expect(parseBearerHeader("Bearer abc123")).toBe("abc123");
    expect(parseBearerHeader("bearer  xyz ")).toBe("xyz");
    expect(parseBearerHeader("Basic abc")).toBe(null);
    expect(parseBearerHeader(undefined)).toBe(null);
  });
});

describe("validateWsUpgrade — ticket branch is additive (Task 3.3/3.5)", () => {
  it("loopback still bypasses without any credential (unchanged)", () => {
    expect(validateWsUpgrade(undefined, "127.0.0.1", SECRET)).toBe(true);
    expect(validateWsUpgrade(undefined, "::1", SECRET)).toBe(true);
  });

  it("valid cookie still authorizes external requests (unchanged)", () => {
    const cookie = `${COOKIE_NAME}=${signToken({ sub: "u@e.com", name: "U", username: "u", provider: "github" }, SECRET)}`;
    expect(validateWsUpgrade(cookie, "1.2.3.4", SECRET)).toBe(true);
  });

  it("external request with NO credential is still rejected (unchanged)", () => {
    const store = new WsTicketStore();
    const consumeTicket = (t: string, s: any) => store.consume(t, s);
    expect(validateWsUpgrade(undefined, "1.2.3.4", SECRET, [], { scope: "browser", consumeTicket })).toBe(false);
  });

  it("valid single-use ticket authorizes an external request; durable bearer never rides WS", () => {
    const store = new WsTicketStore();
    const consumeTicket = (t: string, s: any) => store.consume(t, s);
    const ticket = store.mint("browser");
    expect(validateWsUpgrade(undefined, "1.2.3.4", SECRET, [], { ticket, scope: "browser", consumeTicket })).toBe(true);
    // Single-use: replaying the same ticket fails.
    expect(validateWsUpgrade(undefined, "1.2.3.4", SECRET, [], { ticket, scope: "browser", consumeTicket })).toBe(false);
  });

  it("a durable bearer token presented as a ticket is rejected", () => {
    const store = new WsTicketStore();
    const consumeTicket = (t: string, s: any) => store.consume(t, s);
    // token is a durable bearer, never minted as a ticket.
    expect(validateWsUpgrade(undefined, "1.2.3.4", SECRET, [], { ticket: token, scope: "browser", consumeTicket })).toBe(false);
  });
});
