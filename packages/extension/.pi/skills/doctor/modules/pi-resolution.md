---
name: pi-resolution
scope: Enumerate every pi install location, flag divergence + floor violations.
symptoms:
  - pi version mismatch
  - dashboard piVersion differs
  - two pi versions
  - pi too old
  - which pi
  - session pi differs from server
depends-on:
  - env-node
derives-from:
  - which -a pi + readlink (live CLI binary)
  - repo node_modules/@earendil-works/pi-coding-agent/package.json (live)
  - managed ~/.pi-dashboard node_modules (live)
  - createRequire(sessionCwd) resolution (live)
  - packages/server/package.json#piCompatibility.minimum (floor)
---

## SCOPE
Report pi across ALL install locations (CLI, repo `node_modules`, managed,
nvm-global, per-session-cwd) and flag divergence and floor violations. A single
version string is never sufficient.

## KNOWLEDGE
pi resolves from MULTIPLE independent locations that can hold DIFFERENT
versions. Never assume "pi is one thing":
- CLI binary (`which -a pi` → `dist/cli.js`) — what a human types.
- Repo `node_modules/@earendil-works/pi-coding-agent` — what the dashboard
  server + sessions resolve.
- `packages/server/node_modules/...` if present (usually NONE; server resolves
  via repo root).
- Managed install / nvm-global copy.
- Per-session-cwd `createRequire(cwd+'/_').resolve(...)` — what a launched
  session actually loads.

Failure modes:
- Dashboard `/api/health` `piVersion` ≠ the version resolved at the session cwd
  → dashboard and sessions run different pi.
- Any location below `piCompatibility.minimum` → that consumer fails.

## CHECKS
- `which -a pi && readlink -f "$(which pi)" && pi --version`.
- Read version from repo `node_modules/@earendil-works/pi-coding-agent/package.json`.
- `node -e "console.log(require('module').createRequire(process.cwd()+'/_').resolve('@earendil-works/pi-coding-agent'))"` — session cwd resolution.
- Use `enumeratePiInstalls({ label: dir })` + `piVersionDivergence()` from
  `_lib/checks.ts`; compare each to `readPiFloor(serverPkgJsonPath)`.
- Multiple versions are OK **only** if every one ≥ floor.

## FIX ROUTING
- **dev**: align the repo dep spec + global pi; `npm install` at repo root.
- **npm-global**: `npm i -g @earendil-works/pi-coding-agent@<≥floor>`.
- **Electron**: bundled pi is immutable; update the app (see install-topology).
- **Docker**: rebuild the image with the pinned pi.

## DERIVES-FROM
Live: CLI binary, repo/managed package.json versions, cwd `createRequire`.
Floor: `packages/server/package.json#piCompatibility.minimum`. Hash sidecar:
`pi-resolution.knowledge.hash`.
