## Why

`electron-runtime-overlay-updates` lets the Electron app run a linked local checkout ("Use Local Folder…"). Its design left spike 1.2 open: does a pnpm-installed monorepo checkout run under the shell's **bundled** Node when that Node's major differs from the system Node the checkout was installed with (native modules such as `node-pty` are built per ABI)? Interim rule shipped: the linked checkout always runs under the bundled Node, and preflight refuses it with `node_engines <range>` when that Node falls outside the checkout's root `package.json#engines.node`. That rule does not catch an ABI mismatch inside `engines`, and may refuse checkouts that would work under the system Node.

## What Changes

- Run the spike: pnpm checkout under the bundled Node, same and different major as the system Node; record `node-pty` and other native-module behaviour.
- Decide the local-link Node rule from the result: keep "bundled Node + refuse on mismatch", add an ABI check (installed native module ABI vs bundled Node), or allow the link to run under the system Node.
- Implement the decided rule in the local preflight and document it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `electron-runtime-overlay`: the local-link preflight Node rule.

## Discipline Skills

- `doubt-driven-review`: running a linked checkout under the system Node widens what the app executes; review before the rule changes.
- `security-hardening`: not triggered beyond the existing Electron-only local-path trust boundary (unchanged).
- `performance-optimization`, `observability-instrumentation`: not triggered (preflight refusal reasons already logged).

## Impact

- `packages/shared/src/runtime-overlay/compat.ts` (`preflightLocal`), `packages/electron/src/lib/runtime-overlay-main.ts` (`gateRuntimeRoot`, Node selection for `localLink`), docs `docs/electron-bootstrap-flow.md`.
- Depends on `electron-runtime-overlay-updates` (local link mode).
