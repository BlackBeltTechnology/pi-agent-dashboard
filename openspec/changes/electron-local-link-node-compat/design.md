## Context

Moved from `electron-runtime-overlay-updates` open question 2 / spike 1.2. Interim decision there: a linked checkout always runs under the shell's bundled Node; preflight refuses with `node_engines <range>` when the bundled Node is outside the checkout's root `engines.node` (`packages/shared/src/runtime-overlay/compat.ts`).

## Goals / Non-Goals

- Goal: a linked checkout either starts or is refused up front with an actionable reason — never a late native-module crash.
- Non-goal: changing the Electron-only local-path trust boundary.

## Decisions

Pending the spike. Candidates:
1. Keep bundled Node + `engines` refusal (status quo).
2. Bundled Node + ABI check: refuse when installed native modules (e.g. `node-pty` `build/Release/*.node`) target a different `process.versions.modules`, with the fix command (`pnpm rebuild` under that Node).
3. Run the link under the system Node (resolved from PATH), gated by `engines`.

## Open Questions

1. Which native modules in the checkout are ABI-bound besides `node-pty`?
