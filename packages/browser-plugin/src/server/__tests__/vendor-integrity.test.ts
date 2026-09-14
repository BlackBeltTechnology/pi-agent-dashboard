// @vitest-environment node
/**
 * Vendored relay tree integrity — scenario X14 (test-plan add-browser-relay,
 * task 2.2): every file under relay/vendor/playwright-core/ must hash-match
 * the recorded manifest, and NOTICE must carry the upstream SHA. This is what
 * makes "never edit vendor/" enforceable: refresh = re-copy + regenerate
 * vendor-hashes.json.
 *
 * Also pins the authored-shim contracts (see vendor/NOTICE): the vendored
 * CDPRelayServer must LOAD (aliases + relative imports resolve) and its
 * transport must throw loudly, never silently no-op.
 *
 * See change: add-browser-relay (task 2.2).
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { registry } from "../relay/vendor/playwright-core/src/server/registry/index.js";
// Vendored upstream code — bare specifiers resolve via vitest resolve.alias
// (see ../../../vitest.config.ts) exactly as they will for relay-instance.ts.
import { CDPRelayServer } from "../relay/vendor/playwright-core/src/tools/mcp/cdpRelay.js";
import { ManualPromise } from "../relay/vendor/shims/manualPromise.js";
import { WSServer } from "../relay/vendor/shims/wsServer.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "..");
const vendorRoot = path.join(serverDir, "relay", "vendor");
const playwrightCoreDir = path.join(vendorRoot, "playwright-core");

const manifest = JSON.parse(
  readFileSync(path.join(here, "vendor-hashes.json"), "utf-8"),
) as { upstreamCommit: string; files: Record<string, string> };

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
  );
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("vendored relay integrity (X14)", () => {
  it("NOTICE exists and carries the upstream commit SHA", () => {
    const notice = readFileSync(path.join(vendorRoot, "NOTICE"), "utf-8");
    expect(notice).toContain(manifest.upstreamCommit);
    expect(notice).toContain("Apache License, Version 2.0");
  });

  it("every file under playwright-core/ matches the recorded hash manifest", () => {
    const onDisk = walk(playwrightCoreDir)
      .map((f) => path.relative(serverDir, f).split(path.sep).join("/"))
      .sort();
    expect(onDisk).toEqual(Object.keys(manifest.files).sort());

    for (const [relPath, expected] of Object.entries(manifest.files)) {
      expect(sha256(path.join(serverDir, relPath)), `${relPath} unchanged (refresh = re-copy)`).toBe(expected);
    }
  });

  it("importing the vendored cdpRelay resolves every shim (alias wiring works)", () => {
    expect(typeof CDPRelayServer).toBe("function");
    // Constructing is side-effect-free: the WSServer shim's constructor is
    // inert, only listen() would transport.
    const server = new CDPRelayServer("chrome");
    expect(typeof server.cdpEndpoint).toBe("function");
  });

  it("shims throw loudly where the plugin supplies the real behaviour", async () => {
    const server = new CDPRelayServer("chrome");
    // Transport comes from ctx.registerWsRoute in relay-instance (D2) — the
    // vendored listener must never bind a port.
    await expect(server.start()).rejects.toThrow(/not supported — transport is supplied by relay-instance\.ts/);
    // Browser launch comes from the host systemOpen capability — the registry
    // shim (isChromiumAlias / findExecutable) must not pretend to know.
    expect(() => registry.isChromiumAlias("chromium")).toThrow(
      /not supported — browser launch is supplied by relay-instance\.ts/,
    );
    await expect(new WSServer({} as never).close()).rejects.toThrow(
      /not supported — transport is supplied by relay-instance\.ts/,
    );
  });

  it("ManualPromise is a real implementation (used by ExtensionProtocolV2)", async () => {
    const p = new ManualPromise<string>();
    const value = p.then((v) => `resolved:${v}`);
    expect(p.isDone()).toBe(false);
    p.resolve("ok");
    expect(p.isDone()).toBe(true);
    await expect(value).resolves.toBe("resolved:ok");

    const r = new ManualPromise<void>();
    r.reject(new Error("boom"));
    await expect(r).rejects.toThrow("boom");
  });
});
