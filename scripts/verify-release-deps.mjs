#!/usr/bin/env node
/**
 * verify-release-deps.mjs — pre-release dependency-shape gate.
 *
 * Asserts the publishable workspace package.json files declare the
 * critical runtime dependencies that, if missing, ship a broken tarball
 * to the npm registry. Each rule corresponds to a real bug captured in
 * `docs/repro/`.
 *
 * Exits non-zero with a human-readable report on any violation.
 *
 * Invoked by the `release-cut` skill in its pre-flight phase and by the
 * Release workflow before `npm publish`. Add new rules here as more
 * "must-have-at-release" invariants are identified.
 *
 * See change: enable-standalone-npm-install (task 7.2).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/**
 * Rules. Each rule: { pkgPath, dep, kind, evidence }.
 *   pkgPath:  path relative to repo root, to a package.json
 *   dep:      name of the dependency to verify
 *   kind:     "dependencies" | "devDependencies" | "peerDependencies"
 *   evidence: docs/repro pointer or change name for context in failures
 */
const RULES = [
  {
    pkgPath: "packages/server/package.json",
    dep: "jiti",
    kind: "dependencies",
    evidence:
      "docs/repro/v0.5.3-clean-node22-linux-x64-2026-05-19.log STEP 3 — " +
      "without jiti as a direct dep, the bin wrapper exits 1 'cannot find jiti' " +
      "on any clean-machine npm install. See change: enable-standalone-npm-install task 7.2.",
  },
  {
    pkgPath: "packages/server/package.json",
    dep: "node-pty",
    kind: "dependencies",
    evidence:
      "docs/repro/v0.5.3-clean-node22-linux-x64-2026-05-19.log STEP 1 — " +
      "node-pty 1.1.0 ships no linux-x64 prebuild; install fails on slim " +
      "Debian. Must remain pinned at 1.2.0-beta.13+ until 1.2.0 stable. " +
      "See change: enable-standalone-npm-install task 7.1.",
    minVersion: "1.2.0-beta.13",
  },
  {
    pkgPath: "packages/server/package.json",
    dep: "@earendil-works/pi-coding-agent",
    kind: "dependencies",
    evidence:
      "eliminate-electron-runtime-install task 1.1.a — pi lifted from " +
      "optional peer to regular dep so `npm install` resolves it for the " +
      "standalone + Electron arms. Floor tracks the deliberate pi bump to " +
      "0.85.1: the 0.85.1 Anthropic UA constant (claude-cli/2.1.251) lifts the " +
      "Anthropic client-version gate that returned 400 claude_code_version_too_old " +
      "for claude-fable-5-1 on Claude Pro/Max OAuth subscriptions, and the " +
      "0.85.0/0.85.1 line carries ZERO upstream breaking changes. 0.85.1 (not " +
      "0.85.0) is the target because 0.85.0 unintentionally published internal " +
      "experimental code and deps (pi#9132), breaking SDK imports; 0.85.1 reverts " +
      "that and restores the ./client compatibility entry point. 0.86.1 adds the " +
      "`meta` OAuth provider, and is the floor the server's OAuth registry " +
      "(ModelRuntime-sourced, delegated to pi-ai) is verified against. " +
      "See change: delegate-provider-oauth-to-pi-ai. 1.0.0 is the single " +
      "supported pi: every @earendil-works pi range (publishable peers, " +
      "devDependencies, the three workspace overrides) joins the lockstep, which " +
      "retires the per-feature version gates and the legacy pi-ai generation; " +
      "1.0.0 also adds the `openai` (ChatGPT) OAuth provider. " +
      "See change: update-pi-core-1-0-adopt-apis.",
    minVersion: "1.0.0",
  },
  {
    pkgPath: "packages/server/package.json",
    dep: "@fission-ai/openspec",
    kind: "dependencies",
    evidence:
      "provision-openspec-cli-in-sessions task 1.4 — floor raised 1.3.0 → 1.6.0 " +
      "to match the version that generated the openspec-* skills " +
      "(generatedBy: 1.6.0). npm hoists the server + extension ranges to one " +
      "installed copy the session shim resolves. Pinned EXACT (not ^1.6.0): the " +
      "vendored .pi/skills/openspec-* carry `generatedBy: 1.6.0`, so the CLI and " +
      "the skills must move together — a caret let a routine install drift the " +
      "CLI out from under them unreviewed. 1.11.0 itself is CLI-compatible with " +
      "openspec-poller.ts (`status --change <name> --json` unchanged, artifact " +
      "shape unchanged + additive isPlanningComplete).",
    minVersion: "1.11.0",
  },
  {
    pkgPath: "packages/extension/package.json",
    dep: "@fission-ai/openspec",
    kind: "dependencies",
    evidence:
      "provision-openspec-cli-in-sessions task 1.4 — the bridge shim " +
      "(openspec-cli-shim.ts) require.resolves this dep, so it must travel with " +
      "the published extension into generic projects (no dashboard copy hoisted " +
      "there). Floor tracks the single-source version 1.11.0.",
    minVersion: "1.11.0",
  },
  {
    pkgPath: "packages/server/package.json",
    dep: "tsx",
    kind: "dependencies",
    evidence:
      "eliminate-electron-runtime-install task 1.1.a — tsx lifted from " +
      "optional peer to regular dep so the server can run TypeScript entry " +
      "points without a separate user install. Floor 4.21.0 matches the " +
      "jiti/tsx loader contract used by packages/server/bin/pi-dashboard.mjs.",
    minVersion: "4.21.0",
  },
  ...["vite", "@vitejs/plugin-react", "@tailwindcss/vite", "tailwindcss"].map((dep) => ({
    pkgPath: "packages/client/package.json",
    dep,
    kind: "dependencies",
    evidence:
      "fix-pi-install-node26-and-omit-dev-build task 1.4 — pi installs via " +
      "`npm install --omit=dev`, which drops devDependencies. The client `prepare` " +
      "script runs a Vite build, so its direct build-time requirements must be " +
      "runtime dependencies or the git-install path dies with " +
      "`Cannot find module 'vite/package.json'` (issue #357).",
  })),
  {
    pkgPath: "packages/client/package.json",
    dep: "tsx",
    kind: "dependencies",
    evidence:
      "fix-pi-install-node26-and-omit-dev-build task 1.2 — `scripts/vite-build.mjs` " +
      "imports `tsx/esm/api`; declared explicitly on the client instead of relying " +
      "on the fragile hoist of the packages/server runtime tsx dep. Floor 4.21.0 " +
      "matches the root/server pin.",
    minVersion: "4.21.0",
  },
];

/**
 * Extract the version floor from a declared range: strips a leading caret/tilde
 * and any prerelease suffix so `^1.6.0` / `~1.6.0` / `1.6.0` all floor to
 * `1.6.0`. Returns null for a range we cannot parse (e.g. `*`, a git/url dep).
 */
export function floorOf(range) {
  const m = String(range).match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

/** The `@earendil-works` pi packages whose ranges are governed by the floor. */
export const GOVERNED_PI_PACKAGES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
];

/**
 * The publishable manifests that may declare pi ranges: the root
 * `package.json` (a published pi package) plus every `packages/*` manifest.
 * Returns `[{ path, pkg }]` with repo-relative paths. A missing root manifest
 * is skipped (fixture trees). `packages/electron/resources/bundled-extensions/`
 * is never scanned: it is not packaged, so it is not a pin surface.
 * See change: update-pi-core-1-0-adopt-apis.
 */
export function piManifests(repoRoot = REPO_ROOT) {
  const out = [];
  const rootPkg = path.join(repoRoot, "package.json");
  if (existsSync(rootPkg)) out.push({ path: "package.json", pkg: JSON.parse(readFileSync(rootPkg, "utf-8")) });
  const base = path.join(repoRoot, "packages");
  if (!existsSync(base)) return out;
  for (const dir of readdirSync(base).sort()) {
    const rel = `packages/${dir}/package.json`;
    const abs = path.join(repoRoot, rel);
    if (existsSync(abs)) out.push({ path: rel, pkg: JSON.parse(readFileSync(abs, "utf-8")) });
  }
  return out;
}

/**
 * Every governed pi range declared in `manifests`, as `[label, range]` pairs:
 * peer ranges and devDependency ranges for the three governed packages.
 * `@mariozechner/*` ranges are not governed here.
 */
function piRangeSurfaces(manifests) {
  const surfaces = [];
  for (const { path: rel, pkg } of manifests ?? []) {
    for (const field of ["peerDependencies", "devDependencies"]) {
      for (const dep of GOVERNED_PI_PACKAGES) {
        const range = pkg?.[field]?.[dep];
        if (range !== undefined) surfaces.push([`${rel} ${field}.${dep}`, range]);
      }
    }
  }
  return surfaces;
}

/**
 * Range SHAPE for every governed pi range (the lockstep policy): a peer is
 * exactly `>=<floor>`, optional (`peerDependenciesMeta.optional: true`) and
 * carries no upper bound; a devDependency is exactly `^<floor>`. Returns one
 * failure string per offending range, naming the manifest + field + dep, or
 * `[]` when conforming.
 * See change: update-pi-core-1-0-adopt-apis (test-plan #E2, #E3).
 */
export function checkPiRangeShapes(manifests, floor) {
  const failures = [];
  for (const { path: rel, pkg } of manifests ?? []) {
    for (const dep of GOVERNED_PI_PACKAGES) {
      const peer = pkg?.peerDependencies?.[dep];
      if (peer !== undefined) {
        if (peer !== `>=${floor}`) {
          failures.push(
            `${rel} peerDependencies.${dep} = "${peer}" — must be ">=${floor}" (floor-tracking lower bound, no upper bound)`,
          );
        }
        if (pkg?.peerDependenciesMeta?.[dep]?.optional !== true) {
          failures.push(`${rel} peerDependencies.${dep} must be optional (peerDependenciesMeta.optional: true)`);
        }
      }
      const dev = pkg?.devDependencies?.[dep];
      if (dev !== undefined && dev !== `^${floor}`) {
        failures.push(`${rel} devDependencies.${dep} = "${dev}" — must be "^${floor}"`);
      }
    }
  }
  return failures;
}

/**
 * pi pin coherence: the single-source pi-version pins MUST resolve to the
 * same normalized version — the server dependency range, `minimum`,
 * `piCompatibility.recommended`, the docker global-install pin, the three
 * `pnpm-workspace.yaml` overrides (pi-coding-agent, pi-ai, pi-tui), every
 * `@earendil-works` pi peer lower bound and devDependency range in
 * `manifests` (optional; `[{ path, pkg }]`), and the checker's own
 * `minVersion`.
 * Compares normalized floors (via `floorOf`) so the differing syntaxes
 * `^0.85.1` / `0.85.1` / `@0.85.1` are treated equal. Returns an error string
 * naming the drifted site(s), or null when coherent. Exported so the unit test
 * can drive it with fixtures.
 *
 * The `minimum` and workspace-override pins were added by
 * update-pi-core-0-85-adopt-apis: the lockstep floor makes `minimum`
 * semantically equal to `recommended`, and a stale override silently ghosts
 * the tree under `nodeLinker: hoisted` (the harness catches it, no unit test
 * does) — so both join the governed set.
 * See change: update-pi-core-0-85-adopt-apis. update-pi-core-1-0-adopt-apis
 * adds the pi-ai / pi-tui overrides and the manifest ranges.
 */
export function checkPiPinCoherence(
  serverPkg,
  dockerfileText,
  workspaceYamlText,
  checkerMinVersion,
  manifests = [],
) {
  const depRange = serverPkg?.dependencies?.["@earendil-works/pi-coding-agent"];
  const recommended = serverPkg?.piCompatibility?.recommended;
  const minimum = serverPkg?.piCompatibility?.minimum;
  const dockerMatch = String(dockerfileText ?? "").match(
    /@earendil-works\/pi-coding-agent@(\S+)/,
  );
  const dockerPin = dockerMatch ? dockerMatch[1] : undefined;
  const overridePins = GOVERNED_PI_PACKAGES.map((dep) => {
    const m = String(workspaceYamlText ?? "").match(new RegExp(`^\\s*"${dep}":\\s*(\\S+)`, "m"));
    return [`pnpm-workspace.yaml overrides ${dep}`, m ? m[1] : undefined];
  });
  const checkerPin = checkerMinVersion;

  const missing = [];
  if (!depRange) missing.push("server dep");
  if (!recommended) missing.push("piCompatibility.recommended");
  if (!minimum) missing.push("piCompatibility.minimum");
  if (!dockerPin) missing.push("docker/Dockerfile");
  for (const [name, pin] of overridePins) if (!pin) missing.push(name);
  if (!checkerPin) missing.push("verify-release-deps.mjs minVersion");
  if (missing.length > 0) {
    return (
      "pi pin coherence: missing a governed pi pin " +
      `(${missing.join(", ")} absent)`
    );
  }

  const surfaces = [
    ["server dep", depRange],
    ["piCompatibility.recommended", recommended],
    ["piCompatibility.minimum", minimum],
    ["docker/Dockerfile", dockerPin],
    ...overridePins,
    ["verify-release-deps.mjs minVersion", checkerPin],
    ...piRangeSurfaces(manifests),
  ];
  const recFloor = floorOf(recommended);
  const floors = surfaces.map(([name, value]) => [name, floorOf(value)]);
  if (recFloor === null || floors.some(([, floor]) => floor === null)) {
    return (
      "pi pin drift: (unparseable pin) — " +
      floors.map(([name, floor]) => `${name}="${floor}"`).join(", ")
    );
  }

  const drifted = floors.filter(([, floor]) => floor !== recFloor);
  if (drifted.length === 0) return null;
  return (
    "pi pin drift: the governed pi-version pins must resolve to one version — " +
    `piCompatibility.recommended "${recommended}" (floor ${recFloor}); drifted: ` +
    drifted.map(([name, floor]) => `${name} ("${floor}")`).join(", ")
  );
}

/**
 * Cross-consistency: the server and extension `@fission-ai/openspec` ranges MUST
 * share one version floor (single-source governance). Returns an error string
 * naming the drifted sites, or null when consistent. Exported so the T-S1 unit
 * test can drive it with package.json fixtures.
 * See change: provision-openspec-cli-in-sessions.
 */
export function checkOpenspecFloorConsistency(serverPkg, extensionPkg) {
  const serverRange = serverPkg?.dependencies?.["@fission-ai/openspec"];
  const extensionRange = extensionPkg?.dependencies?.["@fission-ai/openspec"];
  if (!serverRange || !extensionRange) {
    return (
      "openspec floor consistency: missing @fission-ai/openspec dependency " +
      `(server=${serverRange ?? "absent"}, extension=${extensionRange ?? "absent"})`
    );
  }
  const serverFloor = floorOf(serverRange);
  const extensionFloor = floorOf(extensionRange);
  if (serverFloor === null || extensionFloor === null || serverFloor !== extensionFloor) {
    return (
      "openspec floor drift: server and extension @fission-ai/openspec floors must match — " +
      `server "${serverRange}" (floor ${serverFloor}) vs extension "${extensionRange}" (floor ${extensionFloor})`
    );
  }
  return null;
}

/**
 * Evaluate every gate against a repo tree. Exported (with an injectable
 * `repoRoot`) so the unit test can drive it against a tmp fixture tree instead
 * of mutating tracked files or spawning the CLI.
 * See change: fix-pi-install-node26-and-omit-dev-build (task 4.7).
 */
export function collectFailures({ repoRoot = REPO_ROOT } = {}) {
  const failures = [];

  for (const rule of RULES) {
  const abs = path.join(repoRoot, rule.pkgPath);
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(abs, "utf-8"));
  } catch (err) {
    failures.push(`Cannot read ${rule.pkgPath}: ${err.message}`);
    continue;
  }
  const bucket = pkg[rule.kind];
  if (!bucket || !bucket[rule.dep]) {
    failures.push(
      `Missing: ${rule.pkgPath} → ${rule.kind}.${rule.dep}\n  Why: ${rule.evidence}`,
    );
    continue;
  }
  if (rule.minVersion) {
    const declared = String(bucket[rule.dep]);
    // Loose check: declared range must mention >= rule.minVersion (any caret/tilde/exact accepted).
    // We do not do full semver math here — we just want a clear signal that the
    // pin hasn't reverted to an older release. The rule's evidence is the
    // authority on which versions are acceptable.
    if (!declared.includes(rule.minVersion.split("-")[0])) {
      failures.push(
        `Stale pin: ${rule.pkgPath} → ${rule.kind}.${rule.dep} = "${declared}"\n` +
          `  Expected: range covering at least ${rule.minVersion}\n` +
          `  Why: ${rule.evidence}`,
      );
    }
  }
}

// Cross-consistency gate: server ↔ extension openspec floors must not drift.
try {
  const serverPkg = JSON.parse(
    readFileSync(path.join(repoRoot, "packages/server/package.json"), "utf-8"),
  );
  const extensionPkg = JSON.parse(
    readFileSync(path.join(repoRoot, "packages/extension/package.json"), "utf-8"),
  );
  const drift = checkOpenspecFloorConsistency(serverPkg, extensionPkg);
  if (drift) failures.push(drift);
  } catch (err) {
    failures.push(`Cannot check openspec floor consistency: ${err.message}`);
  }

  // pi pin coherence gate: every governed surface must resolve to one pi version,
  // and every governed pi range must have the lockstep shape.
  try {
    const serverPkg = JSON.parse(
      readFileSync(path.join(repoRoot, "packages/server/package.json"), "utf-8"),
    );
    const dockerfileText = readFileSync(path.join(repoRoot, "docker/Dockerfile"), "utf-8");
    const workspaceYamlText = readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf-8");
    const piRule = RULES.find(
      (r) => r.pkgPath === "packages/server/package.json" && r.dep === "@earendil-works/pi-coding-agent",
    );
    const manifests = piManifests(repoRoot);
    const piDrift = checkPiPinCoherence(
      serverPkg,
      dockerfileText,
      workspaceYamlText,
      piRule?.minVersion,
      manifests,
    );
    if (piDrift) failures.push(piDrift);
    const floor = serverPkg?.piCompatibility?.minimum;
    if (floor) failures.push(...checkPiRangeShapes(manifests, floor));
  } catch (err) {
    failures.push(`Cannot check pi pin coherence: ${err.message}`);
  }

  return failures;
}

function main() {
  const failures = collectFailures();

  if (failures.length > 0) {
    console.error("verify-release-deps.mjs: pre-release dependency gate FAILED");
    console.error("");
    for (const f of failures) {
      console.error("  ✗ " + f.replace(/\n/g, "\n    "));
      console.error("");
    }
    console.error(
      `Total failures: ${failures.length}. Fix the workspace package.json files before cutting a release.`,
    );
    process.exit(1);
  }

  console.log(`verify-release-deps.mjs: OK — ${RULES.length} rules passed.`);
}

// Run only when invoked directly (CLI), not when imported by a unit test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
