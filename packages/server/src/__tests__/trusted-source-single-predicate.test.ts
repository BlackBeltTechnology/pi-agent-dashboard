/**
 * Single predicate, no drift (test-plan #E16) — static scan over
 * `packages/server/src`. Every peer-IP trust decision must go through
 * `isTrustedSource`; the raw matcher `isBypassedHost(` may be CALLED only in
 * its home module and in `cors-origin.ts` (which matches the Origin host, not
 * a socket peer). Comment lines are stripped before scanning.
 *
 * See change: fix-trusted-network-tunnel-bypass (D1).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = path.resolve(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
      const idx = line.indexOf("//");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

const ALLOWED = new Set([path.join("auth", "localhost-guard.ts"), path.join("auth", "cors-origin.ts")]);

/**
 * @structural-pin single-predicate lint: isBypassedHost( may be called only in two modules; a static scan over server source
 */
describe("E16 single peer-IP trust predicate", () => {
  it("calls isBypassedHost( only in localhost-guard.ts and cors-origin.ts", () => {
    const offenders: string[] = [];
    for (const file of walk(serverSrc)) {
      const rel = path.relative(serverSrc, file);
      if (rel.split(path.sep).includes("__tests__") || /\.test\.tsx?$/.test(rel)) continue;
      if (ALLOWED.has(rel)) continue;
      if (stripComments(fs.readFileSync(file, "utf-8")).includes("isBypassedHost(")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

describe("E18 single local-trust predicate (requireLocalProof)", () => {
  it("calls isGenuinelyLocal( only in localhost-guard.ts", () => {
    const offenders: string[] = [];
    for (const file of walk(serverSrc)) {
      const rel = path.relative(serverSrc, file);
      if (rel.split(path.sep).includes("__tests__") || /\.test\.tsx?$/.test(rel)) continue;
      if (rel === path.join("auth", "localhost-guard.ts")) continue;
      if (stripComments(fs.readFileSync(file, "utf-8")).includes("isGenuinelyLocal(")) offenders.push(rel);
    }
    // See change: harden-trust-and-credential-boundaries (D2).
    expect(offenders).toEqual([]);
  });
});

// ── E13: one admission list (retire-trusted-networks-bypass, design D1) ──────
// Every ADMISSION site (something that lets a request/upgrade in because the
// peer matched the list) must read `admissionTrustedNetworks` — the live,
// mode-dependent list (`[]` under `pair`). A site handed the raw list
// (`liveTrustedNetworks(` / `resolvedTrustedNetworks`) would keep admitting in
// `pair`. The raw accessors may appear only in the named, justified places.
// See change: retire-trusted-networks-bypass.

/** Source files (relative to `packages/server/src`) that may mention the raw list, and why. */
const RAW_LIST_FILES: Record<string, string> = {
  [path.join("config-snapshot.ts")]: "defines liveTrustedNetworks (the raw snapshot accessor)",
  [path.join("auth", "trust-mode.ts")]: "admissionTrustedNetworks itself: picks the raw list in legacy, [] in pair",
  [path.join("auth", "trust-mode-boot.ts")]: "the one-time boot decision reads the list to classify it (not admission)",
  [path.join("config-api.ts")]: "strips the derived key before persisting (never reads it for admission)",
  [path.join("cli.ts")]: "passes the loaded boot config into ServerConfig (a value, not an admission decision)",
  [path.join("auth", "auth-plugin.ts")]:
    "embedder/test FALLBACK for readAdmissionTrustedNetworks; server.ts always passes the thunk (asserted below)",
  [path.join("routes", "system-routes.ts")]:
    "health trustPosture fallback for `trustedHasLoopback` (advisory, never admits)",
};

/** `server.ts` lines that may mention the raw list, each with the reason it is exempt. */
const SERVER_RAW_LIST_EXEMPTIONS: Array<{ re: RegExp; why: string }> = [
  { re: /^\s*resolvedTrustedNetworks\?: string\[\];/, why: "ServerConfig field declaration" },
  { re: /const corsTrustedNetworks = \(\) => liveTrustedNetworks\(config\.resolvedTrustedNetworks \?\? \[\]\);/, why: "CORS origin allowlist (non-goal: no credential follows)" },
  { re: /const admissionList = \(\) => admissionTrustedNetworks\(config\.resolvedTrustedNetworks \?\? \[\]\);/, why: "the admission list's own boot fallback" },
  { re: /^\s*resolvedTrustedNetworks: config\.resolvedTrustedNetworks,/, why: "registerAuthPlugin boot fallback; readAdmissionTrustedNetworks overrides it" },
  { re: /readTrustedNetworks: \(\) => liveTrustedNetworks\(config\.resolvedTrustedNetworks \?\? \[\]\)/, why: "health trustPosture thunk (advisory)" },
  { re: /getKnockEligibleNetworks: \(\) => liveTrustedNetworks\(config\.resolvedTrustedNetworks \?\? \[\]\)/, why: "knock eligibility reads the RAW list in both modes (design D7)" },
  { re: /noteTrustedList\(liveTrustedNetworks\(config\.resolvedTrustedNetworks \?\? \[\]\)\);/, why: "boot inert-entry warning" },
];

const RAW_LIST_RE = /liveTrustedNetworks\(|resolvedTrustedNetworks/;

/** The balanced `name( … )` call text starting at `from` (naive paren depth; no string-aware parsing). */
function callBlock(src: string, from: number): string {
  const open = src.indexOf("(", from);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error("unbalanced call");
}

function callsOf(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`(?<![\\w.])${name}\\(`, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(callBlock(src, m.index));
  return out;
}

/** Calls of `name` whose text must match `required`; missing call or mismatch is a violation. */
function requireWiring(src: string, name: string, required: RegExp, why: string): string[] {
  const blocks = callsOf(src, name);
  if (blocks.length === 0) return [`${name}( not found`];
  return blocks.filter((b) => !required.test(b)).map(() => `${name}( ${why}`);
}

/** The value fed to every `authorizeWsUpgrade({ trustedNetworks: … })` must be `admissionList()`. */
function wsUpgradeViolations(src: string): string[] {
  const blocks = callsOf(src, "authorizeWsUpgrade");
  if (blocks.length === 0) return ["authorizeWsUpgrade( not found"];
  const out: string[] = [];
  for (const b of blocks) {
    const value = /trustedNetworks:\s*([A-Za-z_]\w*(?:\(\))?)/.exec(b)?.[1];
    if (!value) out.push("authorizeWsUpgrade( has no trustedNetworks value");
    else if (value !== "admissionList()" && !new RegExp(`const ${value.replace(/\(\)$/, "")} = admissionList\\(\\)`).test(src)) {
      out.push(`authorizeWsUpgrade trustedNetworks: ${value} is not admissionList()`);
    }
  }
  return out;
}

/** Raw-list mentions in server.ts are allowed only on the named exempt lines. */
function rawListLineViolations(src: string): string[] {
  return src
    .split("\n")
    .filter((line) => RAW_LIST_RE.test(line) && !SERVER_RAW_LIST_EXEMPTIONS.some((e) => e.re.test(line)))
    .map((line) => `raw list on a non-exempt line: ${line.trim().slice(0, 120)}`);
}

/** Every admission-wiring violation in a `server.ts` text. Empty ⇒ all sites read `admissionList`. */
function admissionViolations(rawSource: string): string[] {
  const src = stripComments(rawSource);
  const v: string[] = [];
  // The one list: defined through admissionTrustedNetworks.
  if (!/const admissionList = \(\) => admissionTrustedNetworks\(/.test(src)) {
    v.push("admissionList is not defined via admissionTrustedNetworks(");
  }
  v.push(
    ...requireWiring(src, "registerAuthPlugin", /readAdmissionTrustedNetworks:\s*admissionList\b/, "is not handed admissionList"),
    ...requireWiring(src, "createRouteTierGate", /getTrustedNetworks:\s*admissionList\b/, "is not handed admissionList"),
    ...requireWiring(src, "createNetworkGuardHook", /trustedNetworks:\s*admissionList\b/, "is not handed admissionList"),
    ...requireWiring(src, "createNetworkGuard", /^createNetworkGuard\(\s*admissionList\b/, "first arg is not admissionList"),
  );
  // Session-API / service routes (and any other `getTrustedNetworks:` option).
  const getters = [...src.matchAll(/getTrustedNetworks:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
  if (getters.length === 0) v.push("no getTrustedNetworks: option found");
  v.push(...getters.filter((g) => g !== "admissionList").map((g) => `getTrustedNetworks: ${g}`));
  v.push(...wsUpgradeViolations(src), ...rawListLineViolations(src));
  return v;
}

describe("E13 single admission list (admissionTrustedNetworks)", () => {
  const serverTs = fs.readFileSync(path.join(serverSrc, "server.ts"), "utf-8");

  it("references the raw list (liveTrustedNetworks( / resolvedTrustedNetworks) only from the named allow-list", () => {
    const offenders: string[] = [];
    for (const file of walk(serverSrc)) {
      const rel = path.relative(serverSrc, file);
      if (rel.split(path.sep).includes("__tests__") || /\.test\.tsx?$/.test(rel)) continue;
      if (rel === "server.ts" || rel in RAW_LIST_FILES) continue; // server.ts: line-level, below
      if (RAW_LIST_RE.test(stripComments(fs.readFileSync(file, "utf-8")))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("the allow-list has no stale entries (each named file still mentions the raw list)", () => {
    for (const rel of Object.keys(RAW_LIST_FILES)) {
      const src = stripComments(fs.readFileSync(path.join(serverSrc, rel), "utf-8"));
      expect(RAW_LIST_RE.test(src), `${rel}: ${RAW_LIST_FILES[rel]}`).toBe(true);
    }
    for (const e of SERVER_RAW_LIST_EXEMPTIONS) {
      expect(stripComments(serverTs).split("\n").some((l) => e.re.test(l)), e.why).toBe(true);
    }
  });

  it("every admission wiring in server.ts is handed admissionList", () => {
    expect(admissionViolations(serverTs)).toEqual([]);
  });

  // Prove the scan has teeth: mutate an in-memory COPY of server.ts (never disk).
  const mutations: Array<[string, (s: string) => string]> = [
    [
      "registerAuthPlugin handed a raw list",
      (s) => s.replace("readAdmissionTrustedNetworks: admissionList", "readAdmissionTrustedNetworks: () => liveTrustedNetworks(config.resolvedTrustedNetworks ?? [])"),
    ],
    ["registerAuthPlugin loses the thunk", (s) => s.replace("readAdmissionTrustedNetworks: admissionList,", "")],
    ["createRouteTierGate handed a raw list", (s) => s.replace(/(createRouteTierGate\(\{\s*getTrustedNetworks:\s*)admissionList/, "$1corsTrustedNetworks")],
    ["createNetworkGuard handed a raw list", (s) => s.replace(/createNetworkGuard\(\s*admissionList/, "createNetworkGuard(corsTrustedNetworks")],
    ["createNetworkGuardHook handed a raw list", (s) => s.replace(/(createNetworkGuardHook\(\{[^}]*?trustedNetworks:\s*)admissionList/, "$1corsTrustedNetworks")],
    ["a getTrustedNetworks: option handed a raw list", (s) => s.replace("getTrustedNetworks: admissionList", "getTrustedNetworks: corsTrustedNetworks")],
    ["WS upgrade uses the boot list", (s) => s.replace("const trusted = admissionList();", "const trusted = config.resolvedTrustedNetworks ?? [];")],
    ["WS upgrade passes a raw thunk inline", (s) => s.replace(/(authorizeWsUpgrade\(\{[^}]*?)trustedNetworks: trusted/, "$1trustedNetworks: corsTrustedNetworks()")],
    ["admissionList no longer mode-aware", (s) => s.replace("const admissionList = () => admissionTrustedNetworks(", "const admissionList = () => liveTrustedNetworks(")],
    ["a new raw-list use sneaks in", (s) => `${s}\nconst leak = liveTrustedNetworks([]);\n`],
  ];
  for (const [name, mutate] of mutations) {
    it(`FAILS when ${name}`, () => {
      const mutated = mutate(serverTs);
      expect(mutated, "mutation did not apply — the pattern drifted").not.toBe(serverTs);
      expect(admissionViolations(mutated).length).toBeGreaterThan(0);
    });
  }
});
