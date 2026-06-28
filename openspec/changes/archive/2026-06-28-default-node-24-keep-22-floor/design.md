# Design

## Context

"Node version" is not a single pin — it spans layers with different blast radii:

| Layer | Pinned to | Node 24 status before this change |
|---|---|---|
| `package.json` engines | `>=22.19.0 <26` | already allows 24/25 |
| `docker/Dockerfile` (all-in-one) | `node:22-bookworm-slim` | pinned 22 — target of this change |
| `scripts/test-standalone-...sh` | `node:22-bookworm-slim` default | pinned 22 — target of this change |
| `ci.yml` (cheap PR lane) | `node-version: 22` | 22 — intentionally kept |
| `_smoke.yml` matrix | 22 / 24 / 25 | already tests 24+25 |
| `publish.yml` publish job | 24 | already 24 |
| Electron runtime (electron 32.3.3) | bundles own Node ~20 | decoupled from host/CI Node |

This change moves only the **default shipped runtime** (Docker base + standalone
test default) to 24, leaving the supported floor at 22.

## Key Decision 1 — Keep 22 as the engines floor

Raising the default ceiling is low risk; dropping the floor is user-facing and
breaking. We separate them. Floor stays `>=22.19.0`; only the default runtime
moves. The cheap CI PR lane stays on 22 precisely so it keeps catching
accidental use of Node-24-only APIs before they reach Node-22 users.

## Key Decision 2 — Stay on glibc (`-bookworm-`), not Alpine

The archived `docker-packaging` change (Decision 2) pins glibc because node-pty
needs it for correct PTY behaviour. libc is an axis orthogonal to the Node major
version. This change preserves glibc; the `node-pty works inside container`
scenario is unchanged.

## Why the native-module risk is retired

node-pty `1.2.0-beta.13`:
- depends on `node-addon-api ^7.1.0` → it is **N-API** (Node-API), whose ABI is
  frozen across Node majors.
- ships prebuilds under `prebuilds/<platform>-<arch>/pty.node` — **no Node-version
  or `NODE_MODULE_VERSION` token in the path**. The loader (`lib/utils.js`) does
  no version matching; it loads the platform/arch prebuild directly.

Therefore Node 24 reuses the identical `linux-x64/pty.node` that Node 22 loads
today: no recompile, no `node-gyp`, no python/make/g++ added to the image. The
only fallback-to-source path (`node scripts/prebuild.js || node-gyp rebuild`)
triggers only when a prebuild is missing — all six platform/arch prebuilds are
present.

`sharp` (the other native dep) lives inside Electron's bundled Node ~20 and is
untouched by a host/CI Node bump.

## Risks

- Low. CI `_smoke.yml` already proves Node 24 green on bookworm + alpine.
- Residual: if a future node-pty bump drops a prebuild, the glibc image would
  need build tools — but that is independent of this version bump.
