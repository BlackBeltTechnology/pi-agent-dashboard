/**
 * A knock pairs the whole SPA onto a plain-http LAN origin — a NON-secure
 * context where `crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard`
 * and `navigator.mediaDevices` are undefined. No dashboard client bundle
 * (client, client-utils, the plugin runtime's client surface, every plugin
 * client root) may reference them bare: request ids go through `randomUuid()`,
 * copy through `copyText()`; capture (`mediaDevices`) has no fallback, so any
 * caller must be capability-checked AND allowlisted here with a justification.
 *
 * Roots are derived from plugin manifests (`pi-dashboard-plugin.client`) plus
 * every `packages/*\/src/client` tree, so new plugins are covered automatically.
 *
 * See change: add-lan-knock-pairing (test-plan #E30, design D17);
 * audit-plugin-bundles-non-secure-context (design D3, D4).
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const PKG_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

/** Paths (relative to `packages/`) allowed to touch the secure-context APIs. */
const ALLOWLIST = new Set([
  "dashboard-plugin-runtime/src/secure-context.ts", // randomUuid()/copyText(): guarded native call + fallback
  "client/src/lib/pairing/pair-protocol.ts", // QR pairing only runs in a secure context
  "client-utils/src/identity/dpop.ts", // DPoP is inherently secure-context; capability-checked (D17)
  "client-utils/src/identity/pkce.ts", // already guards `crypto.subtle` with a pure-JS fallback
  "client-utils/src/identity/login-flow.ts", // guarded `crypto?.subtle` capability check (reports insecure-context)
]);

/** Four secure-context APIs, member / quoted-global / destructuring / bare-method forms. */
const SECURE_API = new RegExp(
  [
    String.raw`\b(?:navigator|crypto)\s*(?:\?\.\s*|\.\s*|(?:\?\.\s*)?\[\s*["'\x60]\s*)(?:clipboard|randomUUID|subtle|mediaDevices)\b`,
    String.raw`(?:window|globalThis|self)\s*\[\s*["'\x60](?:navigator|crypto)["'\x60]`,
    String.raw`\}\s*=\s*(?:(?:window|globalThis|self)\s*\.\s*)?(?:navigator|crypto)\b(?:\s*\.\s*(?:navigator|crypto))?\s*(?=[;,)\n]|$)`,
    String.raw`\}\s*=\s*(?:window|globalThis|self)\s*\.\s*(?:navigator|crypto)\b`,
    String.raw`\b(?:getUserMedia|getDisplayMedia)\s*(?:\?\.\s*)?\(`,
  ].join("|"),
  "g",
);

/** Blank out comments using the TS parser (string/template/regex aware). */
function code(src: string): string {
  const sf = ts.createSourceFile("x.tsx", src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const ranges: Array<[number, number]> = [];
  const visit = (node: ts.Node): void => {
    for (const r of ts.getLeadingCommentRanges(src, node.getFullStart()) ?? []) ranges.push([r.pos, r.end]);
    for (const r of ts.getTrailingCommentRanges(src, node.getEnd()) ?? []) ranges.push([r.pos, r.end]);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  let out = src;
  for (const [a, b] of ranges) out = out.slice(0, a) + out.slice(a, b).replace(/[^\n]/g, " ") + out.slice(b);
  return out;
}

export function matchSecureApi(src: string): string[] {
  return code(src).match(SECURE_API) ?? [];
}

function isTestFile(path: string): boolean {
  return /(^|\/)(__tests__|test-support)\//.test(path) || /\.(test|spec)\.[tj]sx?$/.test(path);
}

function walk(dir: string, skip: Set<string>, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (skip.has(realpathSync(p))) continue;
    if (statSync(p).isDirectory()) walk(p, skip, out);
    else if (/\.[tj]sx?$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

interface Roots {
  roots: string[];
  excluded: Set<string>;
}

/** Manifest-derived client roots (design D3). Real paths, deduplicated. */
export function deriveRoots(pkgRoot = PKG_ROOT): Roots {
  const roots = new Set<string>();
  const excluded = new Set<string>();
  const add = (d: string): void => {
    if (existsSync(d) && statSync(d).isDirectory()) roots.add(realpathSync(d));
  };
  const entryDir = (pkg: string, entry: string): string => dirname(resolve(pkg, entry));
  for (const name of readdirSync(pkgRoot)) {
    const pkg = join(pkgRoot, name);
    if (!existsSync(join(pkg, "package.json"))) continue;
    const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"))["pi-dashboard-plugin"] as
      | { client?: string; server?: string; bridge?: string }
      | undefined;
    if (manifest?.client) {
      add(entryDir(pkg, manifest.client));
      for (const other of [manifest.server, manifest.bridge]) {
        if (other && existsSync(entryDir(pkg, other))) excluded.add(realpathSync(entryDir(pkg, other)));
      }
    }
    add(join(pkg, "src", "client"));
  }
  add(join(pkgRoot, "client/src"));
  add(join(pkgRoot, "client-utils/src"));
  add(join(pkgRoot, "dashboard-plugin-runtime/src"));
  for (const d of ["server", "bridge", "vite-plugin", "test-support"]) {
    const p = join(pkgRoot, "dashboard-plugin-runtime/src", d);
    if (existsSync(p)) excluded.add(realpathSync(p));
  }
  return { roots: [...roots], excluded };
}

function offendersFor(files: string[], pkgRoot = PKG_ROOT): string[] {
  const out: string[] = [];
  for (const file of files) {
    const rel = relative(realpathSync(pkgRoot), file).split("\\").join("/");
    if (isTestFile(rel) || ALLOWLIST.has(rel)) continue;
    const hits = matchSecureApi(readFileSync(file, "utf8"));
    if (hits.length) out.push(`${rel}: ${[...new Set(hits)].join(", ")}`);
  }
  return out;
}

describe("matcher fixtures (E9/E10)", () => {
  const caught = [
    "navigator.clipboard.writeText(s)",
    "navigator?.clipboard",
    'navigator["clipboard"]',
    'navigator?.["clipboard"]',
    "crypto.randomUUID()",
    "crypto?.subtle",
    "globalThis.crypto.subtle",
    'window["navigator"]',
    "const { clipboard } = navigator;",
    "const { randomUUID } = globalThis.crypto;",
    "navigator.mediaDevices",
    "m.getUserMedia(x)",
    "m?.getUserMedia?.(x)",
    "x.getDisplayMedia()",
  ];
  it.each(caught)("E9: catches %s", (f) => {
    expect(matchSecureApi(f).length).toBeGreaterThanOrEqual(1);
  });

  const real = "navigator.clipboard.writeText(s);";
  it.each([
    "// navigator.clipboard.writeText(s)",
    "/* crypto.randomUUID() */",
    "const u = `${p}//${h}`;",
    "const r = /\\/\\//;",
    'const s = "/*";',
  ])("E10: %s is not a hit, and does not hide a following real call", (f) => {
    expect(matchSecureApi(f)).toHaveLength(0);
    expect(matchSecureApi(`${f}\n${real}`)).toHaveLength(1);
  });
});

describe("root derivation (E11/E12/E15)", () => {
  const { roots, excluded } = deriveRoots();
  const rel = roots.map((r) => relative(realpathSync(PKG_ROOT), r).split("\\").join("/"));

  it("E11: includes manifest client dirs outside src/client, excludes server/bridge, no dupes", () => {
    for (const r of [
      "quota-plugin/src",
      "demo-plugin/src",
      "flows-anthropic-bridge-plugin/src",
      "grammar-plugin/src",
      "roles-plugin/src",
      "gmail-plugin/src/client",
      "kb-plugin/src/client",
    ]) {
      expect(rel, r).toContain(r);
    }
    const ex = [...excluded].map((r) => relative(realpathSync(PKG_ROOT), r).split("\\").join("/"));
    for (const d of ["server", "bridge", "vite-plugin", "test-support"]) {
      expect(ex).toContain(`dashboard-plugin-runtime/src/${d}`);
    }
    expect(new Set(roots).size).toBe(roots.length);
  });

  it("E12: packages without a client contribute no root and do not throw", () => {
    for (const p of ["fixture-policy-plugin", "keycloak-resolver-plugin", "mcp-server-plugin"]) {
      expect(rel.some((r) => r === `${p}/src/client` || r === `${p}/src`)).toBe(false);
    }
  });

  it("E15: a mediaDevices caller in a plugin client root is an offender unless allowlisted", () => {
    const src = "navigator.mediaDevices.getUserMedia({audio:true})";
    expect(matchSecureApi(src).length).toBeGreaterThan(0);
    const path = "gmail-plugin/src/client/Mic.tsx";
    expect(rel.some((r) => path.startsWith(`${r}/`))).toBe(true);
    expect(ALLOWLIST.has(path)).toBe(false);
  });
});

describe("no bare secure-context API in the dashboard client bundles (E30/E13)", () => {
  it("has zero hits outside the allowlist", () => {
    const { roots, excluded } = deriveRoots();
    const files = [...new Set(roots.flatMap((r) => walk(r, excluded)))];
    const offenders = offendersFor(files);
    expect(
      offenders,
      `secure-context API used outside randomUuid()/copyText()/allowlist:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("E14: every allowlisted file still exists (no stale allowlist entries)", () => {
    for (const rel of ALLOWLIST) expect(() => statSync(join(PKG_ROOT, rel)), rel).not.toThrow();
    expect(ALLOWLIST.has("client/src/lib/util/random-uuid.ts")).toBe(false);
    expect(ALLOWLIST.has("client/src/lib/util/clipboard.ts")).toBe(false);
  });
});
