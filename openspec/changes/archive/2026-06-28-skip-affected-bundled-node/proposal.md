## Why

The Electron app ships a bundled Node.js binary as `extraResources` and `pickNodeForServer` selects it unconditionally over system Node. When the bundled Node falls inside the `nodejs/node#58515` affected range (v22.0–v22.17, v24.1–v24.2), the dashboard server's own `assertNodeVersionSupported()` guard refuses to start, producing a hard launch failure with no recovery path. Real users hit this with bundled v22.12.0 — the server printed the "cannot start on Node v22.12.0" banner and exited, leaving the UI permanently stuck on a connecting state. Additionally, `detectSystemNode()` only consults login-shell `which`, which often misses nvm/volta/brew Node binaries when invoked from a macOS GUI launch context, so the picker falls through to `execpath-fallback` (Electron's own embedded Node, which is itself in the affected range — same bug).

## What Changes

- `pickNodeForServer` accepts a new optional `bundledNodeVersion: string` input. When present AND the version matches the nodejs/node#58515 affected range, the bundled branch is skipped and the picker falls through to system Node. Legacy callers (no `bundledNodeVersion`) keep current behavior — pure additive change, no breaking signature change.
- `detectSystemNode()` (in `dependency-detector.ts`) gains a final on-disk scan fallback: when the registry/login-shell path yields nothing OR yields a version in the affected range, the function scans well-known per-platform Node locations (`~/.nvm/versions/node/*/bin/node` ordered by semver desc, `/opt/homebrew/bin/node`, `/usr/local/bin/node`, `~/.volta/bin/node`, `/usr/bin/node`) and returns the highest version-safe candidate. Windows is excluded from the scan (different layout, not affected by this user report). Unix-only.
- Both `launch-source.ts` (V2 path) and `server-lifecycle.ts` (legacy V1 path) probe the bundled Node's `--version` via `execFileSync` with a 5 s timeout and pass it to `pickNodeForServer`. Probe errors are swallowed and the input is left undefined (preserves legacy behavior).
- New repo-lint-style unit tests in `packages/electron/src/__tests__/pick-node.test.ts` cover the predicate range and every picker fall-through branch (10 cases, all green).
- No CLI/UX changes. Failure mode goes from "hard refuse to start" to "transparent fall-through to a working Node".

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `bundled-node-runtime`: adds a requirement that the picker MUST reject affected bundled Node versions and fall through to system Node, AND that system Node detection MUST scan known on-disk locations when PATH-based lookup fails or returns an affected version.

## Impact

- **Code**: `packages/electron/src/lib/pick-node.ts`, `packages/electron/src/lib/launch-source.ts`, `packages/electron/src/lib/server-lifecycle.ts`, `packages/electron/src/lib/dependency-detector.ts`.
- **Tests**: new `packages/electron/src/__tests__/pick-node.test.ts`. No existing tests modified.
- **Migration / compat**: pure additive. Legacy callers and existing installs keep working. Users on a working bundled Node version see no behavior change.
- **Rollback**: revert the four files; no persisted state.
- **Risk**: low. The disk-scan probe runs `<candidate> --version` with a 5 s timeout per candidate; worst case (no usable Node found) adds <2 s to a first launch and returns the same `{ found: false }` as before.
- **Drift risk**: the `isBundledNodeAffected` predicate duplicates `isAffectedNode` in `packages/server/src/node-guard.ts` to keep `pick-node.ts` a pure dependency-free leaf. A comment in both files notes the mirror. If the affected range is ever revised, both copies must move together.
