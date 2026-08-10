/**
 * S2 — every generated verb resolves to a server receiver.
 * Exemplar: packages/server/src/__tests__/browser-gateway-register-handler.test.ts
 * Triple: generated verb set · enumerate helpers · each resolves to a server
 * receiver, fail if none (test-plan #S2).
 *
 * Receivers are collected statically from the four places the server accepts a
 * `BrowserToServerMessage`:
 *   1. `browser-gateway.ts`      — `case "<verb>":` in the dispatch switch
 *   2. `directory-handler.ts`    — `case "<verb>":` in `handlePiGatewayForward`
 *   3. `server.ts`               — `registerHandler("<verb>", …)`
 *   4. `<plugin>/src/server/*`   — `registerBrowserHandler("<verb>", …)`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_VERBS } from "../generated/verbs.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

function collectReceivers(): Set<string> {
  const recv = new Set<string>();
  const gw = read("packages/server/src/pairing/browser-gateway.ts");
  const dh = read("packages/server/src/browser-handlers/directory-handler.ts");
  const srv = read("packages/server/src/server.ts");
  for (const m of `${gw}${dh}`.matchAll(/case\s+"([a-zA-Z_]+)"/g)) recv.add(m[1]);
  for (const m of srv.matchAll(/registerHandler\(\s*"([a-zA-Z_]+)"/g)) recv.add(m[1]);

  // Plugin server entries register handlers via the plugin runtime.
  const pkgsDir = path.join(REPO_ROOT, "packages");
  for (const pkg of fs.readdirSync(pkgsDir)) {
    const entry = path.join(pkgsDir, pkg, "src", "server", "index.ts");
    if (!fs.existsSync(entry)) continue;
    const src = fs.readFileSync(entry, "utf8");
    for (const m of src.matchAll(/registerBrowserHandler\(\s*"([a-zA-Z_]+)"/g)) recv.add(m[1]);
  }
  return recv;
}

describe("verb completeness (S2)", () => {
  it("every generated verb has a server-side receiver", () => {
    const receivers = collectReceivers();
    const missing = GENERATED_VERBS.filter((v) => !receivers.has(v));
    expect(missing).toEqual([]);
  });
});
