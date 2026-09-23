# patch-vendor-specifiers.mjs — index

Rewrites the vendored relay's playwright-internal import specifiers to package-relative `shims/*.js` paths and stamps the Apache-2.0 §4(b) in-file modification notice.

WHY. Upstream addresses its own helpers through `@isomorphic/*` / `@utils/wsServer`, which are not registry packages. The plugin previously mapped them with three alias layers (tsconfig `paths`, a vitest `resolve.alias`, `JITI_TSCONFIG_PATHS`); none exists in an npm / managed / Electron install, so the plugin failed to load there. Package-relative specifiers resolve in every install mode.

IDEMPOTENT. Running twice leaves the tree byte-identical: the specifier rewrite is a no-op once applied (so a second run rewrites nothing and writes nothing), and the notice is detected by a sentinel and never stacked. The notice is part of the patched bytes and of the recorded `patched` hash, so stacking would silently drift the integrity manifest.

FAIL-CLOSED. Exits non-zero on
1. any surviving playwright-internal specifier with no mapping (a future upstream refresh introducing `@protocol/foo` must fail loudly, not produce a tree that only resolves in the monorepo), and
2. an already-noticed file that still contains a mapped specifier — the notice would under-report the modification.

Scans all of `relay/vendor/**` for (1) though it only patches `playwright-core/**`; shims are on the rewritten imports' resolution path.

`--root <dir>` points it at a fixture. Exports `patchTree`, `patchText`, `depthPrefix`, `importSpecifiers`, `isInternalSpecifier`, `sha256File`, `SPECIFIER_MAP`, `INTERNAL_NAMESPACES`, `PATCH_MARKER`, `VENDOR_REL`, `PLAYWRIGHT_CORE_REL`, `REPO_ROOT`.

See change: fix-browser-plugin-vendor-specifier-resolution (D1, D3).
