#!/usr/bin/env node
/**
 * Refresh the vendored playwright-core relay tree: **copy -> verify -> patch ->
 * rehash**, in that order, so no step can silently be skipped.
 *
 * WHY THIS EXISTS. `playwright-core/src/tools/mcp/cdpRelay.ts` and
 * `cdpRelayV2.ts` are upstream copies that this package patches (rewriting
 * playwright-internal specifiers to package-relative paths). A unit test cannot
 * prove that a refresh faithfully reproduced the pinned upstream revision:
 * regenerating both hashes from the working tree is circular. So that proof
 * lives here, at refresh time, against a fetch — the only place the upstream
 * bytes are actually available.
 *
 * ORDERING INVARIANTS (do not reorder):
 *   1. Every `upstream-verbatim` file is fetched and hashed **in memory**
 *      BEFORE anything is written. A mismatch aborts with the tree untouched.
 *   2. `upstream` is NEVER derived from disk. Only this fetch path may set it,
 *      and even then only a human edits it (see below) — otherwise the
 *      assertion in (1) would compare a value against itself.
 *   3. Patching runs only after (1) passes; the manifest's `patched` hashes are
 *      recomputed last, from disk.
 *
 * `upstreamCommit` is pinned in the manifest. Bumping it is a deliberate human
 * edit (new commit + new `upstream` hashes). This script does not rewrite
 * `upstream`: it verifies against the recorded value, so a re-run is not
 * tautological and a wrong revision fails loudly.
 *
 * Usage:
 *   node scripts/refresh-vendor.mjs            verify upstream, patch, rehash
 *   node scripts/refresh-vendor.mjs --verify   verify upstream only (no writes)
 *   node scripts/refresh-vendor.mjs --rehash   rehash `patched` from disk only
 *
 * See change: fix-browser-plugin-vendor-specifier-resolution (D2).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { patchTree, REPO_ROOT } from "./patch-vendor-specifiers.mjs";

/** Integrity manifest, relative to a repo root. */
export const MANIFEST_REL = "packages/browser-plugin/src/server/__tests__/vendor-hashes.json";

/** Directory manifest keys are relative to. */
export const SERVER_DIR_REL = "packages/browser-plugin/src/server";

/** Manifest keys are `<this>/<vendor-root-relative path>`. */
const VENDOR_KEY_PREFIX = "relay/vendor/";

/** Provenance kinds. `authored` files have no upstream counterpart. */
export const KINDS = ["upstream-verbatim", "authored"];

export const UPSTREAM_REPO = "microsoft/playwright";

/**
 * Map a vendor-root-relative path to its path inside the upstream repository.
 * Explicit, not heuristic: `shims/wsServer.ts` comes from `packages/utils/`,
 * not `packages/isomorphic/`, and is `authored` precisely because it has no
 * single upstream counterpart — so a "derive the directory" rule would be
 * wrong the first time it mattered.
 */
export function upstreamPathFor(vendorRelPath) {
  if (vendorRelPath.startsWith("playwright-core/")) {
    return `packages/${vendorRelPath}`;
  }
  const shim = vendorRelPath.match(/^shims\/([^/]+)$/);
  if (shim) return `packages/isomorphic/${shim[1]}`;
  throw new Error(`no upstream path rule for ${vendorRelPath}`);
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function manifestPath(root = REPO_ROOT) {
  return join(root, MANIFEST_REL);
}

export function readManifest(root = REPO_ROOT) {
  return JSON.parse(readFileSync(manifestPath(root), "utf-8"));
}

/** Recompute `patched` from disk, preserving `kind` and `upstream` verbatim. */
export function rehash(manifest, root = REPO_ROOT) {
  const files = {};
  for (const [rel, entry] of Object.entries(manifest.files)) {
    const onDisk = sha256(readFileSync(join(root, SERVER_DIR_REL, rel)));
    files[rel] = entry.upstream === undefined
      ? { kind: entry.kind, patched: onDisk }
      : { kind: entry.kind, upstream: entry.upstream, patched: onDisk };
  }
  return { $comment: manifest.$comment, upstreamCommit: manifest.upstreamCommit, files };
}

/**
 * Fetch and hash every `upstream-verbatim` file at `upstreamCommit`. Returns
 * the verified bytes IN MEMORY plus any mismatches. Never writes.
 *
 * Hashes the fetched buffer, not the file on disk: comparing a hash regenerated
 * from the working tree to itself is circular.
 */
export async function fetchUpstream(manifest, { fetchImpl = globalThis.fetch } = {}) {
  const contents = new Map();
  const mismatches = [];
  for (const [rel, entry] of Object.entries(manifest.files)) {
    if (entry.kind !== "upstream-verbatim") continue;
    const vendorRelPath = rel.startsWith(VENDOR_KEY_PREFIX) ? rel.slice(VENDOR_KEY_PREFIX.length) : rel;
    const url = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${manifest.upstreamCommit}/${upstreamPathFor(vendorRelPath)}`;
    const response = await fetchImpl(url);
    if (!response.ok) {
      mismatches.push({ rel, reason: `fetch failed (${response.status})`, url });
      continue;
    }
    const buf = Buffer.from(await response.arrayBuffer());
    const got = sha256(buf);
    if (got !== entry.upstream) {
      mismatches.push({ rel, reason: `upstream hash ${got} != recorded ${entry.upstream}`, url });
      continue;
    }
    contents.set(rel, buf);
  }
  return { mismatches, contents };
}

/** Verify every `upstream-verbatim` file against a fetch at `upstreamCommit`. */
export async function verifyUpstream(manifest, opts) {
  return (await fetchUpstream(manifest, opts)).mismatches;
}

/**
 * The full refresh. Fails before any write when upstream verification fails.
 * `patch` lets a caller substitute the patch step (tests); default is the real
 * `patchTree`.
 */
export async function refreshVendor({
  root = REPO_ROOT,
  fetchImpl = globalThis.fetch,
  patch = patchTree,
  verifyOnly = false,
  write = true,
} = {}) {
  const manifest = readManifest(root);
  const { mismatches, contents } = await fetchUpstream(manifest, { fetchImpl });
  if (mismatches.length > 0) return { ok: false, mismatches, changed: [], patched: null };
  if (verifyOnly) return { ok: true, mismatches: [], changed: [], patched: null };

  // COPY. The verified upstream bytes are what gets patched — patching whatever
  // happens to be on disk would happily accept a file copied from any revision,
  // which is exactly what the `upstream` assertion is supposed to prevent.
  for (const [rel, buf] of contents) writeFileSync(join(root, SERVER_DIR_REL, rel), buf);

  const { changed, unmapped, staleNotices } = patch(root);
  if (unmapped.length > 0 || staleNotices.length > 0) {
    return { ok: false, mismatches: [], changed, patched: null, unmapped, staleNotices };
  }

  const patched = rehash(manifest, root);
  if (write) writeFileSync(manifestPath(root), `${JSON.stringify(patched, null, 2)}\n`);
  return { ok: true, mismatches: [], changed, patched };
}

async function main(argv) {
  const verifyOnly = argv.includes("--verify");
  const rehashOnly = argv.includes("--rehash");

  if (rehashOnly) {
    const next = rehash(readManifest());
    writeFileSync(manifestPath(), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`rehashed ${Object.keys(next.files).length} file(s)`);
    return 0;
  }

  const result = await refreshVendor({ verifyOnly });
  for (const { rel, reason } of result.mismatches) console.error(`UNFAITHFUL ${rel}: ${reason}`);
  if (!result.ok) {
    if (result.mismatches.length > 0) {
      console.error(`\nUpstream verification failed; nothing was written.`);
      return 1;
    }
    for (const x of result.unmapped ?? []) console.error(`UNMAPPED ${x.spec} (${x.file})`);
    for (const rel of result.staleNotices ?? []) console.error(`STALE NOTICE ${rel}`);
    return 1;
  }
  for (const rel of result.changed) console.log(`patched ${rel}`);
  if (verifyOnly) {
    console.log("upstream verified; no writes");
    return 0;
  }
  console.log(`verified upstream, copied, patched, rehashed ${Object.keys(result.patched.files).length} file(s)`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main(process.argv.slice(2)));
}
