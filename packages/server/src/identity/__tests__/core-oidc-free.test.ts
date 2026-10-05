/**
 * I1 grep-guard (task 13.9, test-plan LG-4): dashboard core stays OIDC-free.
 *
 * Core (server / client / shared) must NOT read the resolver plugin's config
 * (`plugins["keycloak-resolver"].*`), import the resolver plugin package, or
 * import an OIDC/JWT library. The browser login descriptor reaches core only
 * through `ctx.registerBrowserLoginConfig`. OIDC mechanics live in
 * `keycloak-resolver-plugin` and `client-utils/src/identity`.
 *
 * Static scan over production sources (tests, fixtures and comments excluded).
 * See change: add-multi-user-identity-plane (I1, D7, D16).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES = path.resolve(__dirname, "../../../..");
const CORE_ROOTS = ["server/src", "client/src", "shared/src"].map((r) => path.join(PACKAGES, r));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "test-support" || entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|fixtures?)\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip block + line comments so prose mentions never trip the guard. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ["reads the resolver plugin's config", /plugins\s*(\[\s*["']keycloak-resolver["']\s*\]|\.keycloak)/],
  ["reads the resolver plugin's config via getPluginConfig", /getPluginConfig(FromFile)?\s*\([^)]*keycloak/],
  ["imports the resolver plugin package", /from\s+["'][^"']*keycloak-resolver-plugin/],
  ["imports an OIDC/JWT library", /from\s+["'](jose|openid-client|oidc-provider|jsonwebtoken)["']/],
];

describe("I1: core stays OIDC-free (LG-4)", () => {
  const files = CORE_ROOTS.flatMap((r) => walk(r));

  it("scans a non-trivial source set", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  // `server/src/auth/` is the LEGACY cookie `auth.providers` connector (D8: coexists,
  // never a principal source for the identity plane). It owns its own OIDC library
  // use and is out of I1's scope; the identity plane (server/src/identity, client
  // identity code, shared) must stay clean.
  const LEGACY_AUTH_DIR = path.join(PACKAGES, "server/src/auth") + path.sep;

  for (const [why, re] of FORBIDDEN) {
    it(`no core source ${why}`, () => {
      const hits = files
        .filter((f) => !f.startsWith(LEGACY_AUTH_DIR))
        .filter((f) => re.test(code(fs.readFileSync(f, "utf8"))));
      expect(hits.map((f) => path.relative(PACKAGES, f))).toEqual([]);
    });
  }

  it("the guard itself catches a violation (self-test)", () => {
    for (const [, re] of FORBIDDEN) expect(re.source.length).toBeGreaterThan(0);
    expect(FORBIDDEN[0][1].test('cfg.plugins["keycloak-resolver"].issuer')).toBe(true);
    expect(FORBIDDEN[3][1].test('import { jwtVerify } from "jose";')).toBe(true);
    expect(FORBIDDEN[2][1].test('import x from "@scope/keycloak-resolver-plugin/server"')).toBe(true);
  });
});
