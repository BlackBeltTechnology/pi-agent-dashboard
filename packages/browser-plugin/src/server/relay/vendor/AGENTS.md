# DOX — packages/browser-plugin/src/server/relay/vendor

Vendored third-party code. See `NOTICE` (upstream commit `d1ead3ecca23182f2d06d761c28e3d4edafb6595`, 2026-09-11, Apache-2.0, per-file SHA-256). Change: add-browser-relay (task 2.2, design D2).

## Rules

- **`playwright-core/` is NEVER edited.** Refresh = re-copy from upstream at a
  new commit, then regenerate `../../__tests__/vendor-hashes.json`. The
  integrity test (`vendor-integrity.test.ts`, scenario X14) fails on any byte
  drift, added file, or removed file.
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
- **`shims/manualPromise.ts`, `shims/time.ts`, `shims/timeoutRunner.ts` are
  VERBATIM upstream** (`packages/isomorphic/*`) — real working code, used by
  `ExtensionProtocolV2`. Not hashed by the X14 manifest (outside
  `playwright-core/`); SHA-256s recorded in `NOTICE`.
- Bare specifiers `@isomorphic/manualPromise`, `@isomorphic/time`,
  `@isomorphic/timeoutRunner`, `@utils/wsServer` resolve to `shims/` via
  tsconfig.base.json `paths` + the package vitest `resolve.alias`
  (`@isomorphic/time` is a PREFIX of `@isomorphic/timeoutRunner` — anchored
  regex keys in vitest).
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
| `NOTICE` | Attribution: upstream commit, fetch date, per-file SHA-256, refresh policy. |
| `playwright-core/src/tools/mcp/{cdpRelay,cdpRelayV2,browserModel,protocol,log}.ts` | Verbatim upstream relay core. |
| `playwright-core/src/tools/utils/extension.ts` | Verbatim upstream (extension id + profile detection). |
| `playwright-core/src/server/registry/index.ts` | SHIM (throws — browser launch bypassed). |
| `shims/{manualPromise,time,timeoutRunner}.ts` | Verbatim upstream isomorphic helpers. |
| `shims/wsServer.ts` | SHIM (throws — transport bypassed). |
