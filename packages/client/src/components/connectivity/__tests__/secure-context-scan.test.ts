/**
 * A knock pairs the whole SPA onto a plain-http LAN origin — a NON-secure
 * context where `crypto.randomUUID`, `crypto.subtle` and `navigator.clipboard`
 * are undefined. No client/client-utils source may call them bare: request ids
 * go through `randomUuid()`, copy through `copyText()`, and the only legitimate
 * `crypto.subtle` users are QR pairing (secure-context only) and the guarded
 * DPoP/PKCE identity helpers (see allowlist).
 *
 * Plugin client bundles are out of scope (known follow-up).
 *
 * See change: add-lan-knock-pairing (test-plan #E30, design D17).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const PKG_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");
const ROOTS = ["client/src", "client-utils/src"].map((r) => join(PKG_ROOT, r));

/** Paths (relative to `packages/`) allowed to touch the secure-context APIs. */
const ALLOWLIST = new Set([
  "client/src/lib/util/random-uuid.ts", // randomUuid(): guarded native call + fallback
  "client/src/lib/util/clipboard.ts", // copyText(): guarded + manual-copy fallback
  "client/src/lib/pairing/pair-protocol.ts", // QR pairing only runs in a secure context
  "client-utils/src/identity/dpop.ts", // DPoP is inherently secure-context; capability-checked (D17)
  "client-utils/src/identity/pkce.ts", // already guards `crypto.subtle` with a pure-JS fallback
]);

const SECURE_API = /\bcrypto\.(?:randomUUID|subtle)\b|\bnavigator\.clipboard\b/g;

/** Drop comments so prose that names an API cannot match. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function isTestFile(path: string): boolean {
  return /(^|\/)(__tests__|test-support)\//.test(path) || /\.(test|spec)\.[tj]sx?$/.test(path);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.[tj]sx?$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

describe("no bare secure-context API in the dashboard client (E30)", () => {
  it("has zero hits outside the allowlist", () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap((r) => walk(r))) {
      const rel = relative(join(PKG_ROOT), file).split("\\").join("/");
      if (isTestFile(rel) || ALLOWLIST.has(rel)) continue;
      const hits = code(readFileSync(file, "utf8")).match(SECURE_API);
      if (hits) offenders.push(`${rel}: ${[...new Set(hits)].join(", ")}`);
    }
    expect(
      offenders,
      `secure-context API used outside randomUuid()/copyText()/allowlist:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("every allowlisted file still exists (no stale allowlist entries)", () => {
    for (const rel of ALLOWLIST) expect(() => statSync(join(PKG_ROOT, rel)), rel).not.toThrow();
  });
});
