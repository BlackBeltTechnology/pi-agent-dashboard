# refresh-vendor.mjs — index

Owns the whole vendored playwright-core relay refresh: copy → verify → patch → rehash.

WHY A SCRIPT AND NOT A TEST. A unit test cannot prove a refresh faithfully reproduced the pinned upstream revision: regenerating both hashes from the working tree is circular. That proof needs the upstream bytes, which exist only here, at refresh time, against a fetch.

ORDERING INVARIANTS (do not reorder):

1. Every `upstream-verbatim` file is fetched and hashed **in memory** BEFORE anything is written. A mismatch aborts with the tree and the manifest untouched.
2. Those verified bytes are then COPIED to disk — the "copy" step. Patching whatever happens to be on disk would happily accept a file from any revision, since the `upstream` assertion would be checking bytes that no longer survive. `--verify` stops after step 1 and writes nothing.
3. `upstream` is NEVER derived from disk. Only the fetch path may set it, and even then only a human bumps it — otherwise the assertion in (1) would compare a value against itself. `upstreamCommit` is pinned in the manifest; bumping it is a deliberate edit (new commit + new `upstream` hashes).
4. Patching runs only after (1)-(2) pass; `patched` hashes are recomputed last, from disk.

`upstreamPathFor` maps a vendor-root-relative path into the upstream repo explicitly (`playwright-core/*` → `packages/playwright-core/*`; `shims/<name>` → `packages/isomorphic/<name>`) and throws rather than guessing — `shims/wsServer.ts` comes from `packages/utils/` and is `authored`, so a "derive the directory" rule would be wrong the first time it mattered.

Modes: default (fetch, verify, copy, patch, rehash), `--verify` (fetch + verify only, no writes), `--rehash` (`patched` from disk only). Exports `refreshVendor`, `fetchUpstream`, `verifyUpstream`, `rehash`, `readManifest`, `manifestPath`, `upstreamPathFor`, `sha256`, `MANIFEST_REL`, `SERVER_DIR_REL`, `KINDS`, `UPSTREAM_REPO`.

See change: fix-browser-plugin-vendor-specifier-resolution (D2).
