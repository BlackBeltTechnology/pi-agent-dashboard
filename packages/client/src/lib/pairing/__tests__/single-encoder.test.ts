/**
 * E10 (test-plan, collapse-pairing-into-gateway): pairing payload encoding has
 * exactly ONE implementation in the web client — the shared codec module
 * `lib/pairing/pairing-qr.ts`. Two encoders is how the Security/Gateway
 * surfaces drifted; this pins the "Single pairing-QR encoder" requirement.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/** Locate `packages/client/src` from the cwd (import.meta.url is not file-scheme here). */
function findSrcRoot(start: string): string {
  const marker = join("src", "lib", "pairing", "pairing-qr.ts");
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, marker))) return join(dir, "src");
    if (existsSync(join(dir, "packages", "client", marker))) return join(dir, "packages", "client", "src");
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return start;
}

const SRC_ROOT = findSrcRoot(process.cwd()); // packages/client/src

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

describe("Single pairing-QR encoder (E10)", () => {
  it("exactly one module defines encodePayloadString, and it is the shared codec", () => {
    const defining = walk(SRC_ROOT).filter((f) =>
      /(function|const)\s+encodePayloadString\b/.test(readFileSync(f, "utf8")),
    );
    expect(defining).toEqual([join(SRC_ROOT, "lib/pairing/pairing-qr.ts")]);
  });
});
