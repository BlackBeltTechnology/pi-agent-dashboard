/**
 * Canary for createTestServer(): verifies that port:0 end-to-end resolution
 * works and the helper returns non-zero, distinct ports.
 *
 * This test exists to de-risk the integration-test migration (tasks 4.x).
 * If createServer / piGateway ever stop propagating resolved ports, this
 * fails loudly before the other tests are touched.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;

/**
 * Guard: no server-boot test may bind a hardcoded port. Server boots must use
 * `createServer({ port: 0, piPort: 0 })` (or createTestServer) so OS-assigned
 * ports keep parallel forks collision-free. See change: parallelize-test-suite.
 *
 * Scans only the object literal passed to `createServer(` — so inert `port:`
 * data elsewhere (recovery-mode HTML payloads, editor-keeper sidecar records)
 * never false-positives.
 */
function listTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listTestFiles(full));
    else if (ent.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Extract the createServer({...}) object-literal bodies from source. */
function createServerConfigBlocks(src: string): string[] {
  const blocks: string[] = [];
  const marker = "createServer(";
  let from = 0;
  for (;;) {
    const call = src.indexOf(marker, from);
    if (call === -1) break;
    from = call + marker.length;
    const open = src.indexOf("{", call);
    if (open === -1 || open > src.indexOf(")", call) + 1) continue;
    // Walk braces from the first { to its match.
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push(src.slice(open, i + 1));
  }
  return blocks;
}

describe("no server-boot test binds a hardcoded port (parallelism guard)", () => {
  it("every createServer({...}) uses port: 0 / piPort: 0", () => {
    const testsRoot = path.dirname(fileURLToPath(import.meta.url));
    const srcRoot = path.resolve(testsRoot, "..");
    const offenders: string[] = [];
    for (const file of listTestFiles(srcRoot)) {
      const src = readFileSync(file, "utf8");
      for (const block of createServerConfigBlocks(src)) {
        for (const m of block.matchAll(/\b(port|piPort)\s*:\s*(\d+)/g)) {
          if (m[2] !== "0") {
            offenders.push(`${path.relative(srcRoot, file)}: ${m[1]}: ${m[2]}`);
          }
        }
      }
    }
    expect(offenders, `hardcoded server-boot ports found:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("createTestServer (port:0 canary)", () => {
  afterAll(async () => {
    if (handle) await handle.stop();
  });

  it("resolves non-zero distinct ports and answers /api/health", async () => {
    handle = await createTestServer();

    expect(handle.httpPort).toBeGreaterThan(0);
    expect(handle.piPort).toBeGreaterThan(0);
    expect(handle.httpPort).not.toBe(handle.piPort);

    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  }, 15000);
});
