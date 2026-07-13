---
name: env-node
scope: Node runtime + OS/platform baseline the whole toolchain runs on.
symptoms:
  - node version
  - unsupported node
  - wrong node
  - electron picks wrong node
  - which node
depends-on: []
derives-from:
  - process.version (live)
  - process.platform / os.release() (live)
  - packages/shared/src/node-version.ts (isUsableNodeVersion / isAffectedNode / isOutOfEnginesRange)
---

## SCOPE
Node runtime version, OS, platform, and PATH — the ground layer every other
module depends on.

## KNOWLEDGE
Failure modes:
- Node below the engines floor or in an `isAffectedNode` band → pi/jiti crashes
  or the Fastify server aborts on boot. `node-version.ts` owns the predicates
  (`isUsableNodeVersion`, `isAffectedNode`, `isOutOfEnginesRange`).
- `which -a node` shows more than one Node; the one on PATH is not the one the
  Electron app or a launched session uses → version skew that looks like a pi
  bug but is a Node bug.
- A shell rc that mutates PATH only for interactive shells → GUI-launched
  Electron gets a different Node than the terminal.

## CHECKS
- `node --version` — current runtime.
- `which -a node && readlink -f "$(which node)"` — every Node on PATH + target.
- `node -e "console.log(process.platform, process.arch, require('os').release())"`.
- Feed the version to `isUsableNodeVersion(version)` from
  `@blackbelt-technology/pi-dashboard-shared/node-version.js`; flag when false.

## FIX ROUTING
- **dev / npm-global**: switch Node (`nvm use <supported>`); reinstall global pi
  under the supported Node.
- **Electron**: the app bundles its own Node selection — a bad system Node only
  affects CLI-launched sessions; see `docs/electron-bootstrap-flow.md` for the
  Node-bin selection order.
- **Docker**: rebuild the image; the base image pins Node.

## DERIVES-FROM
Live: `process.version`, `process.platform`, `os.release()`. Predicates:
`packages/shared/src/node-version.ts`. Hash sidecar: `env-node.knowledge.hash`.
