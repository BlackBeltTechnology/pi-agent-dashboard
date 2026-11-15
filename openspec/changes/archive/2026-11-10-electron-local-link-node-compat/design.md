## Context

Moved from `electron-runtime-overlay-updates` open question 2 / spike 1.2. Interim decision there: a linked checkout always runs under the shell's bundled Node; preflight refuses with `node_engines <range>` when the bundled Node is outside the checkout's root `engines.node` (`packages/shared/src/runtime-overlay/compat.ts`).

## Goals / Non-Goals

- Goal: a linked checkout either starts or is refused up front with an actionable reason — never a late native-module crash.
- Non-goal: changing the Electron-only local-path trust boundary.

## Decisions

Candidates were:
1. Keep bundled Node + `engines` refusal (status quo).
2. Bundled Node + ABI check: refuse when installed native modules (e.g. `node-pty` `build/Release/*.node`) target a different `process.versions.modules`, with the fix command (`pnpm rebuild` under that Node).
3. Run the link under the system Node (resolved from PATH), gated by `engines`.

### Spike result (task 1.1)

Checkout: this repo, pnpm (`nodeLinker: hoisted`), installed under system Node v26.7.0 (ABI 147). Shell bundled Node: installed app v24.22.0 (ABI 137); current build pins `BUNDLED_NODE_VERSION=v26.13.0` (`packages/electron/scripts/_node-version.sh`).

- Every runtime native addon in the checkout is N-API (exports `napi_register_module_v1`, no `node_register_module_v<N>`): `node-pty` 1.x prebuilds, `sharp`, `@napi-rs/*`, `sherpa-onnx`, `@earendil-works/pi-tui`, `koffi`, `fsevents`, plus build-only `rollup`/`oxc`/`lightningcss`/`tailwind oxide`.
- `node-pty` loads and spawns a PTY under both v26.7.0 (ABI 147) and v24.22.0 (ABI 137) from the same install. No `build/Release` (from-source) addon present.
- The ABI hazard is therefore narrow: an addon compiled from source by node-gyp (`build/Release/*.node`) with the classic `NODE_MODULE` API, e.g. `node-pty` when no prebuild matched the host. `prebuilds/` dirs are safe: N-API, or `node-gyp-build` picks the matching-ABI file.
- With the v24 shell the status-quo `engines` rule refused this checkout (`>=26 <27`) although it would have run; with the v26 shell it passes. `engines` remains the project's declared contract, so it stays.

### Decision: candidate 2

Keep bundled Node + `engines`, and add an ABI check (`preflightLocalNativeAbi` in `compat.ts`, called last in `gateRuntimeRoot`): scan `node_modules/[@scope/]<pkg>/build/Release/*.node`, read the `node_register_module_v<N>` symbol, refuse with `node_abi <path> built for ABI <N>, app Node <v> needs ABI <M> — run \`pnpm rebuild\` in the checkout under Node <v>`. N-API / unreadable / symbol-less files pass. Candidate 3 rejected: system Node from PATH widens what the app executes and makes the runtime depend on shell PATH state; the spike showed no case where it was needed.

Scan bound: top-level and scoped packages only (hoisted layout); nested `node_modules` and pnpm isolated `.pnpm/` stores are not scanned. Legacy non-context-aware addons without a versioned symbol are not detected — they still fail late at load, as before.

## Open Questions

1. ~~Which native modules in the checkout are ABI-bound besides `node-pty`?~~ None at runtime — all N-API (spike above).
