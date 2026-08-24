/**
 * The bridge's pin store: record the server fingerprint at pairing time (7.1),
 * and resolve it by IDENTITY rather than by address, so a pinned server reached
 * at a new address still verifies without re-pairing (7.4).
 *
 * See change: add-pi-gateway-transport-identity (D8).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadServerPins,
  notePinEndpoint,
  recordServerPin,
  resolvePinForEndpoint,
  serverPinsPath,
} from "../server-pin-store.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pin-store-"));
  file = path.join(dir, "pinned-servers.json");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const PIN_A = { fingerprint: "sha256:AAA", publicKeyB64: "keyA" };
const PIN_B = { fingerprint: "sha256:BBB", publicKeyB64: "keyB" };

describe("serverPinsPath", () => {
  it("lives under the dashboard config dir of the given HOME", () => {
    const p = serverPinsPath({ homedir: "/home/someone" });
    expect(p.startsWith("/home/someone")).toBe(true);
    expect(path.basename(p)).toBe("pinned-servers.json");
  });
});

describe("recordServerPin", () => {
  it("persists the fingerprint and key at pairing time", () => {
    recordServerPin(file, { ...PIN_A, endpoint: "http://dash:8000", label: "laptop" });
    const store = loadServerPins(file);
    expect(store.servers).toHaveLength(1);
    expect(store.servers[0]).toMatchObject({
      fingerprint: "sha256:AAA",
      publicKeyB64: "keyA",
      lastEndpoint: "http://dash:8000",
      label: "laptop",
    });
  });

  it("writes the store 0600 — the pin is integrity-critical", () => {
    recordServerPin(file, { ...PIN_A, endpoint: "http://dash:8000" });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("re-pairing the same identity updates in place instead of duplicating", () => {
    recordServerPin(file, { ...PIN_A, endpoint: "http://dash:8000" });
    recordServerPin(file, { ...PIN_A, endpoint: "http://moved:9000" });
    const store = loadServerPins(file);
    expect(store.servers).toHaveLength(1);
    expect(store.servers[0].lastEndpoint).toBe("http://moved:9000");
  });

  it("keeps distinct identities side by side", () => {
    recordServerPin(file, { ...PIN_A, endpoint: "http://a:8000" });
    recordServerPin(file, { ...PIN_B, endpoint: "http://b:8000" });
    expect(loadServerPins(file).servers).toHaveLength(2);
  });
});

describe("loadServerPins", () => {
  it("returns an empty store when nothing was ever paired", () => {
    expect(loadServerPins(file)).toEqual({ servers: [] });
  });

  it("returns an empty store rather than throwing on corrupt content", () => {
    fs.writeFileSync(file, "{ not json");
    expect(loadServerPins(file)).toEqual({ servers: [] });
  });
});

describe("resolvePinForEndpoint", () => {
  it("matches the pin last seen at that endpoint", () => {
    recordServerPin(file, { ...PIN_A, endpoint: "http://a:8000" });
    recordServerPin(file, { ...PIN_B, endpoint: "http://b:8000" });
    expect(resolvePinForEndpoint(loadServerPins(file), "http://b:8000")?.fingerprint).toBe("sha256:BBB");
  });

  it("still resolves the sole pin at an address never seen before (7.4)", () => {
    recordServerPin(file, { ...PIN_A, endpoint: "http://a:8000" });
    expect(resolvePinForEndpoint(loadServerPins(file), "http://elsewhere:9100")?.fingerprint).toBe("sha256:AAA");
  });

  it("refuses to guess between several pins at an unknown address", () => {
    recordServerPin(file, { ...PIN_A, endpoint: "http://a:8000" });
    recordServerPin(file, { ...PIN_B, endpoint: "http://b:8000" });
    expect(resolvePinForEndpoint(loadServerPins(file), "http://unknown:9100")).toBeUndefined();
  });

  it("returns nothing when nothing is pinned", () => {
    expect(resolvePinForEndpoint(loadServerPins(file), "http://a:8000")).toBeUndefined();
  });
});

describe("notePinEndpoint", () => {
  it("remembers the address a verified identity answered at", () => {
    recordServerPin(file, { ...PIN_A, endpoint: "http://a:8000" });
    notePinEndpoint(file, "sha256:AAA", "http://moved:9100");
    expect(loadServerPins(file).servers[0].lastEndpoint).toBe("http://moved:9100");
  });

  it("is inert for an unknown fingerprint — it never pins on sight", () => {
    recordServerPin(file, { ...PIN_A, endpoint: "http://a:8000" });
    notePinEndpoint(file, "sha256:ZZZ", "http://impostor:9100");
    const store = loadServerPins(file);
    expect(store.servers).toHaveLength(1);
    expect(store.servers[0].lastEndpoint).toBe("http://a:8000");
  });
});
