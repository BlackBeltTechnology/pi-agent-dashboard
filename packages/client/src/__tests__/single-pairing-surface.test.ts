/**
 * E12 (test-plan, collapse-pairing-into-gateway): the duplicate pairing surface
 * and the orphaned QrCodeDialog are GONE — all four deleted files absent, and
 * zero source imports of either symbol remain. ("Typecheck clean" from the
 * manifest row is verified at the ship-gate's build step, not inside this unit
 * test — vitest transpiles per-file and cannot see whole-program types.)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Locate `packages/client` from the cwd (import.meta.url is not file-scheme
 * under this vitest setup). The marker file pins the package root whether the
 * suite was started at the repo root or the package dir.
 */
function findClientRoot(start: string): string {
  const marker = join("src", "lib", "i18n", "i18n.tsx");
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, marker))) return dir;
    if (existsSync(join(dir, "packages", "client", marker))) return join(dir, "packages", "client");
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return start;
}

const CLIENT_ROOT = findClientRoot(process.cwd());

const DELETED = [
  join(CLIENT_ROOT, "src/components/connectivity/PairingView.tsx"),
  join(CLIENT_ROOT, "src/components/__tests__/PairingView.test.tsx"),
  join(CLIENT_ROOT, "src/components/connectivity/QrCodeDialog.tsx"),
  join(CLIENT_ROOT, "src/components/__tests__/QrCodeDialog.test.tsx"),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !p.includes("__tests__")) {
      out.push(p);
    }
  }
  return out;
}

describe("No duplicate pairing surface / orphaned QR dialog (E12)", () => {
  it("all four deleted files are absent", () => {
    for (const f of DELETED) {
      expect(existsSync(f), f).toBe(false);
    }
  });

  it("zero source files import either symbol", () => {
    const importers = walk(CLIENT_ROOT).filter((f) => /PairingView|QrCodeDialog/.test(readFileSync(f, "utf8")));
    expect(importers).toEqual([]);
  });
});
