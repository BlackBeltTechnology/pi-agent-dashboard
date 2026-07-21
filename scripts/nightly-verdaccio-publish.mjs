#!/usr/bin/env node
/**
 * nightly-verdaccio-publish.mjs — publish every non-private workspace to an
 * ephemeral private registry (Verdaccio) for the nightly Electron round-trip.
 *
 * Runs INSIDE `_electron-build.yml` on each leg when `registry_url` is set.
 * Pipeline (mirrors the release `tag-and-push` version-coherence machinery,
 * so the nightly exercises the exact cross-workspace specifier-sync path a
 * real release uses):
 *
 *   (a) bump every workspace + root to `<base>-nightly.<YYYYMMDD>.<sha7>`
 *       (`<base>` = next patch of the current package.json version) via
 *       `npm pkg set version` — field-only edit, no lifecycle scripts.
 *   (b) `node scripts/sync-versions.js`         — rewrite ^<base> cross-refs
 *   (c) `npm install --package-lock-only`        — regen lockfile
 *   (d) `node scripts/verify-lockfile-versions.mjs` — assert coherence
 *   (e) publish every non-private workspace to `$REGISTRY`, sub-packages
 *       first (topological on @blackbelt-technology/* deps), root last.
 *
 * The publish SET is DERIVED from the filesystem (every non-private
 * workspace under packages/* + the root), not a hand-maintained allowlist —
 * the same criterion `publish-allowlist-complete.test.ts` enforces against
 * publish.yml. A new workspace is therefore published automatically and can
 * never be silently omitted (design.md Risk: "publish all, not a computed
 * closure — robust by construction").
 *
 * MUST NOT reach public npm: `$REGISTRY` defaults to http://localhost:4873
 * and every `npm publish` carries `--registry $REGISTRY`.
 *
 * See change: add-nightly-verdaccio-build.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_META = "@blackbelt-technology/pi-agent-dashboard";
const SCOPE = "@blackbelt-technology/";

/**
 * Next patch of a SemVer core `X.Y.Z` (any prerelease/build suffix ignored).
 * `0.6.1` → `0.6.2`. Chosen so a `X.Y.Z-nightly.*` prerelease sorts ABOVE the
 * last release instead of below it (design Decision 3).
 */
export function nextPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version));
  if (!m) throw new Error(`nextPatch: '${version}' is not a SemVer X.Y.Z`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** Throwaway nightly version slug: `<base>-nightly.<YYYYMMDD>.<sha7>`. */
export function computeNightlyVersion(base, date, sha) {
  const stamp = String(date).replace(/-/g, "");
  const sha7 = String(sha).slice(0, 7);
  return `${base}-nightly.${stamp}.${sha7}`;
}

/** `X.Y.Z-nightly.<8 digits>.<7 hex>` — the shape the nightly workflow emits. */
export const NIGHTLY_VERSION_RE =
  /^\d+\.\d+\.\d+-nightly\.\d{8}\.[0-9a-f]{7}$/;

/**
 * Enumerate every non-private workspace (packages/* + the root metapackage).
 * Returns `{ name, dir, scopedDeps }` where `scopedDeps` are the
 * @blackbelt-technology/* deps (prod + dev) that are themselves workspaces.
 */
export function discoverWorkspaces(repoRoot) {
  const out = [];
  const packagesDir = join(repoRoot, "packages");
  const push = (dir, pkgJsonPath) => {
    if (!existsSync(pkgJsonPath)) return;
    const raw = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    if (typeof raw.name !== "string" || raw.private === true) return;
    const scopedDeps = [
      ...Object.keys(raw.dependencies || {}),
      ...Object.keys(raw.devDependencies || {}),
    ].filter((d) => d.startsWith(SCOPE));
    out.push({ name: raw.name, dir, scopedDeps });
  };
  for (const e of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    push(e.name, join(packagesDir, e.name, "package.json"));
  }
  push(".", join(repoRoot, "package.json"));
  return out;
}

/**
 * Topological publish order: every package appears AFTER the workspace
 * @blackbelt-technology/* deps it declares, and the root metapackage is
 * ALWAYS last (its `npm install` at bundle time resolves the sub-packages,
 * so they must already be served). Deterministic (alpha tie-break).
 */
export function orderPublishSet(workspaces) {
  const byName = new Map(workspaces.map((w) => [w.name, w]));
  const visited = new Set();
  const order = [];
  const visit = (name, stack) => {
    if (visited.has(name)) return;
    if (stack.has(name)) return; // tolerate cycles defensively
    const w = byName.get(name);
    if (!w) return; // dep not a workspace (external) — ignore
    stack.add(name);
    for (const dep of [...w.scopedDeps].sort()) {
      if (dep !== name) visit(dep, stack);
    }
    stack.delete(name);
    visited.add(name);
    order.push(name);
  };
  for (const w of [...workspaces].sort((a, b) => a.name.localeCompare(b.name))) {
    if (w.name === ROOT_META) continue; // root forced last
    visit(w.name, new Set());
  }
  if (byName.has(ROOT_META)) {
    visited.add(ROOT_META);
    order.push(ROOT_META);
  }
  return order;
}

// ── main (only when executed directly, not when imported by the test) ───────
function main() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const registry = process.env.REGISTRY || "http://localhost:4873";
  // Anchor the loopback check so `http://localhost.evil.com` cannot slip
  // through (host must be followed by an optional port then `/` or end).
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(registry)) {
    throw new Error(
      `Refusing to publish: REGISTRY='${registry}' is not a loopback registry. ` +
        "The nightly MUST NOT reach public npm.",
    );
  }
  const run = (cmd, args) =>
    execFileSync(cmd, args, { cwd: repoRoot, stdio: "inherit" });

  // Single source of truth: the nightly workflow's `resolve` job computes the
  // slug and passes it in via NIGHTLY_VERSION so the version the bundle's
  // `npm install` requests is exactly the version published to Verdaccio.
  // Fallback (standalone / local runs): compute it here from the current
  // package.json version.
  let version = process.env.NIGHTLY_VERSION;
  if (version) {
    console.log(`Nightly version (from NIGHTLY_VERSION): ${version}`);
  } else {
    const current = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ).version;
    const base = nextPatch(current);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const sha = (process.env.GITHUB_SHA || process.env.SHA || "0000000").slice(0, 7);
    version = computeNightlyVersion(base, date, sha);
    console.log(`Nightly version (computed): ${version} (base ${base}, from ${current})`);
  }
  if (!NIGHTLY_VERSION_RE.test(version)) {
    throw new Error(`Refusing to publish: '${version}' is not a nightly slug (${NIGHTLY_VERSION_RE}).`);
  }

  // (a) bump every workspace + root — field-only edit, no lifecycle scripts.
  run("npm", [
    "pkg",
    "set",
    `version=${version}`,
    "--workspaces",
    "--include-workspace-root",
  ]);
  // (b) rewrite inter-package specifiers to ^<version>.
  run("node", ["scripts/sync-versions.js"]);
  // (c) regenerate the lockfile with the bumped versions.
  run("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"]);
  // (d) assert lockfile cross-ref coherence.
  run("node", ["scripts/verify-lockfile-versions.mjs"]);

  // (e) publish every non-private workspace to the private registry.
  // npm refuses to publish without an auth token (ENEEDAUTH) even when the
  // registry allows anonymous publish ($all in verdaccio config). Provide a
  // dummy per-registry token via the environment (NOT `npm config set`, which
  // would mutate the user's global ~/.npmrc) so it is scoped to these publish
  // subprocesses only; Verdaccio accepts it under $all.
  const regHost = new URL(registry).host;
  const publishEnv = {
    ...process.env,
    [`npm_config_//${regHost}/:_authToken`]: "nightly-verdaccio",
  };
  const publish = (args) =>
    execFileSync("npm", args, { cwd: repoRoot, stdio: "inherit", env: publishEnv });

  const order = orderPublishSet(discoverWorkspaces(repoRoot));
  console.log(`Publishing ${order.length} workspace(s) to ${registry}`);
  for (const name of order) {
    const args =
      name === ROOT_META
        ? ["publish", "--registry", registry, "--no-provenance"]
        : ["publish", "--workspace", name, "--registry", registry, "--no-provenance"];
    console.log(`::group::npm ${args.join(" ")}`);
    publish(args);
    console.log("::endgroup::");
  }
  console.log(`✓ Published ${order.length} workspace(s) to ${registry}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
