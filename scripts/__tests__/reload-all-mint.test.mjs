/**
 * `scripts/reload-all.sh` carries an inline copy of the local credential proof
 * mint (it runs under plain node with no build step). This pins it byte-for-byte
 * to the shared `mintProof` with a fixed vector, so the two cannot drift
 * (test-plan E21).
 *
 * See change: loopback-credential-proof (tasks 1.3, 7.5).
 */

import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { mintProof } from "../../packages/shared/src/local-credential-proof.ts";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SCRIPT = readFileSync(path.join(__dirname, "..", "reload-all.sh"), "utf8");

/** Extract the inline mint exactly as the shell will hand it to node (bash leaves `\n` in "..." intact). */
function inlineMint() {
  const start = SCRIPT.indexOf("// --- local credential proof mint");
  const end = SCRIPT.indexOf("// --- end local credential proof mint ---");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const code = SCRIPT.slice(start, end);
  // Inside the script's double-quoted string these must be absent: bash would expand them.
  expect(code).not.toMatch(/[`$"]/);
  return new Function("createHmac", "randomBytes", "Buffer", `${code}\nreturn mintProofHeader;`)(createHmac, randomBytes, Buffer);
}

describe("reload-all.sh inline mint (E21)", () => {
  it("is byte-identical to the shared mint for a fixed vector", () => {
    const mint = inlineMint();
    const vector = {
      token: "vector-token",
      binding: "127.0.0.1:8000",
      purpose: "http GET /api/sessions?a=1",
      now: 1760000000000,
      nonce: "AAAAAAAAAAAAAAAAAAAAAA",
    };
    const inline = mint(vector.token, vector.binding, vector.purpose, vector.now, vector.nonce);
    expect(inline).toBe(mintProof(vector).header);
    // Pinned against an independent reference (the same value the shared test pins).
    expect(inline).toBe("v1.1760000000000.AAAAAAAAAAAAAAAAAAAAAA.Up8ranWviPNpooRhD_OQ0bmm91V27wk-lxCb07z_HKk");
  });

  it("reads the persisted bind host from config.json `bindHost` (the shared DashboardConfig field), not `host`", () => {
    expect(SCRIPT).toContain(".bindHost||''");
    expect(SCRIPT).not.toMatch(/require\('\$CONFIG_FILE'\)\.host\b/);
  });

  it("never sends the raw token header", () => {
    expect(SCRIPT.toLowerCase()).not.toContain("x-pi-local-token");
  });
});
