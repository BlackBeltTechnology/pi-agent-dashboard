# Fix bundled-Node dir computation in `launch-source.ts` (Windows regression)

## Why

`packages/electron/src/lib/launch-source.ts::spawnFromSource` computes the bundled-Node directory like this:

```ts
const bundledNode = getBundledNodePath();
const bundledNodeDir = bundledNode ? path.dirname(path.dirname(bundledNode)) : null;
```

The `dirname(dirname(…))` arithmetic is a POSIX-only assumption (`<res>/node/bin/node` → `<res>/node`). On Windows the bundled-Node layout is `<res>/node/node.exe` — one segment shallower — so the same arithmetic resolves to `<res>` (the resources directory itself), not `<res>/node`. `pickNodeForServer` then looks for `<res>/node.exe`, doesn't find it, and falls back to `execpath-fallback`:

```
[pick-node] Bundled Node not found — falling back to process.execPath with
            ELECTRON_RUN_AS_NODE=1. Installation may be corrupted.
            execPath=…\pi-dashboard.exe
```

The fallback works (Electron-as-Node runs the server) but is intended as a corrupted-install signal, not a normal operating mode. Worse, it runs the server under `ELECTRON_RUN_AS_NODE=1`, which subtly changes child-process inheritance for pi spawn and surfaces as "pi started but never connected within 30s" in some configurations.

This is the exact regression `bundled-node.ts` already documented in the jsdoc on `getBundledNodeDir()`:

> Callers MUST prefer this helper over computing the dir via `path.dirname(path.dirname(getBundledNodePath()))` — the dirname-arithmetic is Linux-only (Windows `node.exe` is one segment shallower) and silently resolved to `<resources>` on Windows, making `pickNodeForServer` fall through to `execpath-fallback` and producing the pre-fix `code=0` symptom.

So the helper exists, the directive exists, the only thing missing is a lint enforcing it.

Empirically observed on the win32-x64 build from CI run 26425246370 (commit `c6d92bbc`, branch `feat/enable-standalone-npm-install`), on `C:\test5\zip\x64\PI-Dashboard-win32-x64\`. Doctor uses `getBundledNodeDir()` correctly and reports bundled Node ✅. `launch-source.ts` uses the dirname-dirname pattern and produces the fallback log line.

## What Changes

- Replace `path.dirname(path.dirname(getBundledNodePath()))` with `getBundledNodeDir()` in `packages/electron/src/lib/launch-source.ts::spawnFromSource`.
- Update the import to bring `getBundledNodeDir` instead of `getBundledNodePath`.
- Add a unit test asserting that on Windows, given a layout where only `<res>/node/node.exe` exists (no `<res>/node/bin/`), `pickNodeForServer` returns `{ kind: "bundled" }` — i.e. exercise the bundled-resolution path with a Windows-shaped resources tree (via the existing `bundledNodeDir` + `existsSync` test seams on `pick-node`).
- Add a repo-lint test forbidding `path.dirname(path.dirname(…))` chained around any call resolving to bundled-Node helpers under `packages/electron/src/`, with an allow-list pointer to `getBundledNodeDir()`.

## Capabilities

### Modified Capabilities

- `electron-launch-source`: adds a Requirement that on every platform `spawnFromSource` SHALL pass the correct bundled-Node directory to `pickNodeForServer`, sourced via `getBundledNodeDir()`.

## Impact

- **Scope**: 1 line of behavioural change in `launch-source.ts`, 1 import swap, 1 unit test (~30 LOC), 1 repo-lint test (~40 LOC). Net ~75 LOC.
- **User-visible**:
  - Windows: server spawns under real bundled Node (not Electron-as-Node). `ELECTRON_RUN_AS_NODE=1` no longer set. `pi-dashboard.exe` log header no longer shows the "Installation may be corrupted" fallback line.
  - All platforms: re-confirms the bundled-Node-from-resources contract via lint.
- **Risk**: very low. The `getBundledNodeDir()` helper has shipped and is used by Doctor; this change extends its use to one more call site that should have used it from day one.
- **Sequencing**:
  - Independent of `fix-windows-path-system32-missing`.
  - Required for `fix-windows-path-system32-missing` task 7.6 (pi spawn smoke test) to be meaningful on Windows: with the wrong Node, downstream pi spawn ENV behaviour is unpredictable.
- **Out of scope**:
  - Refactoring `bundled-node.ts` itself.
  - Hardening `pickNodeForServer`'s fallback branch (separate concern).
