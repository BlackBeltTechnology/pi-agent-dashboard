# DOX — packages/browser-plugin/src/server/relay/vendor

Vendored third-party code. See `NOTICE` (upstream commit `d1ead3ecca23182f2d06d761c28e3d4edafb6595`, 2026-09-11, Apache-2.0, per-file SHA-256). Change: add-browser-relay (task 2.2, design D2); provenance kinds + package-relative specifiers: fix-browser-plugin-vendor-specifier-resolution.

## Rules

- **Never hand-edit `relay/vendor/`.** Refresh is `node scripts/refresh-vendor.mjs`
  (copy → verify upstream → patch → rehash). `scripts/patch-vendor-specifiers.mjs`
  rewrites the playwright-internal specifiers to package-relative paths and emits
  the Apache-2.0 §4(b) in-file notice; it is idempotent.
  `src/server/__tests__/vendor-hashes.json` records a provenance `kind` per file
  (`upstream-verbatim` = `upstream` + `patched`; `authored` = `patched` only) and
  `vendor-integrity.test.ts` fails on any `patched` drift, added file, or removed
  file.
- **No bare specifier that is not a Node builtin or a declared dependency.**
  Guarded by `scripts/check-vendor-specifiers.mjs`, which parses import syntax
  over all of `relay/vendor/` (a grep would trip on this file and `NOTICE`, which
  legitimately name the old specifiers in prose). Previously these resolved via
  tsconfig `paths` + a vitest `resolve.alias`; both are deleted, because neither
  exists in an npm / managed / Electron install, which is why the plugin failed
  to load there.
- **Transport is bypassed.** The vendored `CDPRelayServer` builds its own
  `WSServer`/HTTP listener — the plugin instead receives pre-upgraded sockets
  via `ctx.registerWsRoute` (design D1/D2). Shims therefore throw loudly where
  they cannot work (never silently no-op):
  - `shims/wsServer.ts` — constructor inert (upstream also only stores
    options); `listen()` throws `not supported — transport is supplied by
    relay-instance.ts via ctx.registerWsRoute`; `close()` rejects with the
    same error (vendored `stop()` catches it).
  - `playwright-core/src/server/registry/index.ts` — `isChromiumAlias` /
    `findExecutable` throw `not supported — browser launch is supplied by
    relay-instance.ts` (plugin opens Chrome via host `systemOpen` +
    `--profile-directory`, not the playwright registry).
- `shims/manualPromise.ts`, `shims/time.ts`, `shims/timeoutRunner.ts` are
  VERBATIM upstream (`packages/isomorphic/*`) — real working code, used by
  `ExtensionProtocolV2`. All four shims are now covered by the manifest, since
  every rewritten import resolves into this directory.
- `playwright-core/src/tools/utils/extension.ts` is the REAL upstream file
  (task marked it shim; it is small, self-contained — fs/path only — and its
  `isExtensionInstalledInProfile` feeds task 2.7's `installed` check), so it
  is vendored verbatim instead.
- Biome excludes `playwright-core/**` (upstream formatting, not ours);
  `shims/` stays linted. knip ignores the whole `vendor/` tree (dead-code
  analysis is meaningless for verbatim third-party code; precedent:
  `site/vendor/**`).

## Layout

| Path | Kind |
|------|------|
| `NOTICE` | Attribution: upstream commit, fetch date, per-file SHA-256, provenance kinds, Modifications (§4(d)), refresh policy. |
| `playwright-core/src/tools/mcp/{browserModel,protocol,log}.ts` | Verbatim upstream relay core. |
| `playwright-core/src/tools/utils/extension.ts` | Verbatim upstream (extension id + profile detection). |
| `playwright-core/src/tools/mcp/{cdpRelay,cdpRelayV2}.ts` | Upstream + §4(b)-noticed import rewrite to package-relative shim paths. |
| `playwright-core/src/server/registry/index.ts` | AUTHORED (throws — browser launch bypassed). |
| `shims/{manualPromise,time,timeoutRunner}.ts` | Verbatim upstream isomorphic helpers. |
| `shims/wsServer.ts` | AUTHORED (throws — transport bypassed). |
