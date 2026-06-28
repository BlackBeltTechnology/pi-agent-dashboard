# Default to Node 24 (keep 22 as the engines floor)

## Why

The Docker all-in-one base image and the standalone-install test script both
default to `node:22-bookworm-slim`. Node 22 is fine, but the project already
runs Node 24 (and 25) green in CI smoke and uses Node 24 for the npm publish
job. Bumping the *default runtime* to Node 24 keeps the shipped image on a
current LTS without changing what end users are required to run.

This is deliberately the **non-breaking** version of the upgrade:
- Raise the default/ceiling runtime to Node 24.
- Keep `engines.node` floor at `>=22.19.0` so users still on Node 22 LTS are
  not broken.

Dropping Node 22 support (raising the floor to `>=24`) is a louder, user-facing
decision and is explicitly **out of scope** here — it belongs in its own change.

## What Changes

- `docker/Dockerfile`: base image `node:22-bookworm-slim` → `node:24-bookworm-slim`
  (stays `-bookworm-` / glibc — required by node-pty's glibc prebuild).
- `scripts/test-standalone-npm-install-docker.sh`: default `IMAGE` →
  `node:24-bookworm-slim`; usage comments updated; keep a `node:22-*` example so
  the floor stays explicitly testable.
- `package.json` `engines.node`: **unchanged** (`>=22.19.0 <26` already permits 24/25).
- `.github/workflows/ci.yml`: **unchanged** — the cheap PR lane stays on Node 22
  on purpose, to guard the supported floor. Full `_smoke.yml` already covers 24/25.

### Non-goals (out of scope)
- Raising the `engines.node` floor / dropping Node 22 support.
- Switching the image to Alpine/musl (orthogonal axis; node-pty needs glibc).
- Electron's bundled Node (~20, decoupled from host/CI Node).
- `@types/node` (transitive only; not declared at top level).

## Impact

- Affected specs: `docker-packaging` (base image version).
- Affected code: `docker/Dockerfile`, `scripts/test-standalone-npm-install-docker.sh`.
- Risk: low. node-pty 1.2 is N-API (`node-addon-api ^7.1.0`); its prebuilds are
  keyed by `<platform>-<arch>` only (no Node-version token), so Node 24 reuses
  the identical `linux-x64/pty.node` — no recompile, no toolchain change.
- Backwards compatibility: preserved. Node 22 users unaffected (floor unchanged).
