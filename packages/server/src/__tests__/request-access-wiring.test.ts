/**
 * Source-scan: ONE LAN-interface provider and ONE `knockPeerDeps` feed the
 * pairing routes and the vault / services refusal remedy, so the remedy cannot
 * drift from the knock's gate state.
 * See change: add-request-access-remedy (test-plan E16, design D1/D4).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.ts"), "utf8");

/** The argument block of `registerX(fastify, { ... })`, up to its closing `});`. */
const block = (fn: string): string => {
  const start = source.indexOf(`${fn}(fastify, {`);
  expect(start, fn).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("\n  });", start));
};

describe("E16 one interface provider, one knockPeerDeps", () => {
  it("creates the LAN-interface provider exactly once", () => {
    expect(source.match(/createLanInterfaceProvider\(/g)).toHaveLength(1);
  });

  it("defines knockPeerDeps once", () => {
    expect(source.match(/const knockPeerDeps\b/g)).toHaveLength(1);
  });

  it("the pairing routes read knockPeerDeps; vault + services receive the thunk built from it", () => {
    expect(source).toMatch(/const requestAccessAvailable = createRequestAccessAvailable\(\s*knockPeerDeps\b/);
    expect(block("registerPairingRoutes")).toContain("knockPeerDeps");
    expect(block("registerVaultRoutes")).toContain("requestAccessAvailable");
    expect(block("registerServiceRoutes")).toContain("requestAccessAvailable");
  });
});
