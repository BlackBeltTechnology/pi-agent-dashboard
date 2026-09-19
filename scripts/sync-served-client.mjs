#!/usr/bin/env node
/**
 * Verify (and if needed deploy) one coherent served-client artifact set.
 *
 * Resolves the served destination the SAME way the server does
 * (`packages/server/src/lib/client-dist.ts`), so the rebuild can never deploy to
 * a directory other than the one the server serves. Between `npm run build` and
 * the restart, this step:
 *
 *   - no-ops when the destination IS the workspace build output;
 *   - mirrors the freshly built workspace output into a differing destination
 *     (superseded hashed assets removed, not accumulated), then verifies both
 *     sides carry identical declarations;
 *   - adopts a legacy destination that has no declaration yet (it can only gain
 *     one through this copy — refusing would be a deadlock);
 *   - reports the API-only host as an explicit success;
 *   - REFUSES (non-zero) on a missing/invalid source declaration, a destination
 *     that is not a client build, a non-writable destination, or a post-copy
 *     mismatch — never a silent success.
 *
 * Wired into both `scripts/rebuild-restart.sh` and
 * `scripts/rebuild-and-restart.sh`, so `set -euo pipefail` aborts the rebuild
 * BEFORE any server restart or bridge reload.
 *
 * Known limitation (dev layout, not the single-checkout deployment this step
 * targets): the resolver anchors at the server package it is imported from, so
 * when the restarted dashboard is a DIFFERENT install (e.g. a global dashboard
 * while you build inside a worktree), this verifies the local checkout's
 * directory, not that install's. Detecting that would need a destination lookup
 * from the restart target, which is outside this change; real deployment stays a
 * separately authorized action (see proposal.md — Impact).
 *
 * See change: add-served-build-coherence-and-hash-parity (design D5).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The freshly built workspace client output — always the sync source. */
export const SOURCE_DIR = path.join(repoRoot, "packages/client/dist");

/** Statuses the sync can return. `refused` is the only failure. */
export const SYNC_STATUS = Object.freeze({
  NO_OP: "no-op",
  API_ONLY: "api-only",
  MIRRORED: "mirrored",
  REFUSED: "refused",
});

let _tsDeps = null;
/**
 * Lazily load the TypeScript helpers through jiti (the same precedent as
 * `scripts/generate-plugin-registry.mjs`) so the resolver and the declaration
 * reader are literally the server's, not a re-implementation.
 */
async function tsDeps() {
  if (_tsDeps) return _tsDeps;
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const clientDist = await jiti.import(path.join(repoRoot, "packages/server/src/lib/client-dist.ts"));
  const metadata = await jiti.import(
    path.join(repoRoot, "packages/dashboard-plugin-runtime/src/server/build-metadata.ts"),
  );
  _tsDeps = {
    resolveStaticClientDir: clientDist.resolveStaticClientDir,
    readBuildDeclaration: metadata.readBuildDeclaration,
    isUsableDeclaration: metadata.isUsableDeclaration,
  };
  return _tsDeps;
}

function refuse(message) {
  return { status: SYNC_STATUS.REFUSED, message };
}

function isSameDir(a, b) {
  return path.resolve(a) === path.resolve(b);
}

/**
 * Default mirror: copy each source entry in full, THEN remove the destination
 * entries the source no longer has (superseded hashed assets). Copy-before-prune
 * keeps the existing asset set servable for the whole copy — pruning first would
 * 404 a live request for an in-flight page's chunk.
 */
function defaultCopyTree(sourceDir, destDir) {
  const sourceEntries = fs.readdirSync(sourceDir);
  for (const entry of sourceEntries) {
    const to = path.join(destDir, entry);
    // Remove first so a file/dir type change cannot make cpSync throw.
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(path.join(sourceDir, entry), to, { recursive: true });
  }
  const sourceSet = new Set(sourceEntries);
  for (const entry of fs.readdirSync(destDir)) {
    if (!sourceSet.has(entry)) {
      fs.rmSync(path.join(destDir, entry), { recursive: true, force: true });
    }
  }
}

/** Resolve `{ sourceDir, destDir }` using the server's own resolver. */
export async function resolveSyncDirs() {
  const { resolveStaticClientDir } = await tsDeps();
  return { sourceDir: SOURCE_DIR, destDir: resolveStaticClientDir() };
}

/**
 * Run the coherence sync. Returns `{ status, message }`.
 *
 * `destDir` is tri-state: `undefined` resolves via the server resolver (CLI
 * default); `null` means "no destination resolves" (API-only host); a string is
 * an explicit destination (tests). `copyTree`/`readDeclaration`/`isUsable` are
 * injectable for fault-injection tests.
 */
export async function syncServedClient(options = {}) {
  const { sourceDir = SOURCE_DIR, copyTree = defaultCopyTree, readDeclaration, isUsable } = options;

  let destDir = options.destDir;
  let read = readDeclaration;
  let usable = isUsable;
  if (destDir === undefined || !read || !usable) {
    const deps = await tsDeps();
    if (destDir === undefined) destDir = deps.resolveStaticClientDir();
    read ??= deps.readBuildDeclaration;
    usable ??= deps.isUsableDeclaration;
  }

  if (destDir === null) {
    return {
      status: SYNC_STATUS.API_ONLY,
      message: "no static client destination resolves — API-only host (supported outcome)",
    };
  }

  // Validate the source BEFORE the no-op branch. "Destination == source" is a
  // supported outcome only when the build actually described itself — a
  // declaration-less workspace build is an unverifiable artifact set and MUST
  // fail, not report "verified".
  const sourceRead = read(sourceDir);
  if (!usable(sourceRead)) {
    return refuse(
      `source build carries no usable declaration (${sourceRead.kind}) — refusing to deploy an undescribed artifact`,
    );
  }

  if (isSameDir(sourceDir, destDir)) {
    return {
      status: SYNC_STATUS.NO_OP,
      // "as resolved from this checkout" is load-bearing: in the cross-install
      // layout the header documents, the served destination belongs to the
      // restarted install, not this checkout — see the known limitation above.
      message:
        "served destination is the workspace build output (as resolved from this checkout) — nothing to sync",
    };
  }

  // Structural gate: a client build has an index.html. A legacy destination
  // without a declaration is adopted; anything that is not a build is refused
  // rather than written to.
  if (!fs.existsSync(path.join(destDir, "index.html"))) {
    return refuse(
      "destination is not a client build (no index.html) — refusing rather than writing over it",
    );
  }

  try {
    copyTree(sourceDir, destDir);
  } catch (error) {
    const code = error?.code;
    if (code === "EACCES" || code === "EPERM") {
      return refuse(
        `destination is not writable (${code}) — re-run with sufficient permissions or point the dashboard at a writable install`,
      );
    }
    return refuse(`copy failed (${code ?? error?.message ?? "unknown error"})`);
  }

  // Post-copy verification: both sides must now carry identical declarations.
  const destRead = read(destDir);
  if (!usable(destRead)) {
    return refuse(`post-copy destination declaration is not usable (${destRead.kind})`);
  }
  if (
    destRead.declaration.pluginRegistryHash !== sourceRead.declaration.pluginRegistryHash ||
    destRead.declaration.fixturePolicy !== sourceRead.declaration.fixturePolicy
  ) {
    return refuse("post-copy declarations still differ — the served artifact is not coherent");
  }

  return {
    status: SYNC_STATUS.MIRRORED,
    message: `mirrored the workspace build into the served destination and verified identical declarations`,
  };
}

async function main() {
  const { sourceDir, destDir } = await resolveSyncDirs();
  const result = await syncServedClient({ sourceDir, destDir });
  console.log(
    `[sync-served-client] ${result.message} (source ${sourceDir}${destDir ? `, destination ${destDir}` : ""})`,
  );
  if (result.status === SYNC_STATUS.REFUSED) process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[sync-served-client] failed: ${error?.message ?? error}`);
    process.exitCode = 1;
  });
}
