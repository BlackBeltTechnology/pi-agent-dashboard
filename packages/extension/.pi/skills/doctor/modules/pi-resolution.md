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
  - packages/shared/src/pi-installs/ (enumeration + floor reader, shared)
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

TWO divergence questions. Never conflate them:
- **Consumer divergence** — the `pi` (session spawn) and `pi-coding-agent`
  (server import) tools resolve to DIFFERENT installs. Predicate: realpath'd
  package-directory inequality, NOT version inequality. Two different installs
  at the same version ARE diverged.
- **Install-set divergence** — >1 distinct version anywhere on the box. One
  unused old install triggers this and NOT consumer divergence.
`/api/health.piRuntime` reports both under distinct fields
(`consumerDiverged` + `installSetDiverged`); the Settings runtime picker
reports consumer divergence only.

Failure modes:
- Dashboard `/api/health` `piVersion` ≠ the version resolved at the session cwd
  → dashboard and sessions run different pi.
- Consumer divergence → the runtime is split in half: sessions spawn one pi,
  the server imports another.
- Any location below `piCompatibility.minimum` → that consumer fails.

## CHECKS
- `which -a pi && readlink -f "$(which pi)" && pi --version`.
- Read version from repo `node_modules/@earendil-works/pi-coding-agent/package.json`.
- `node -e "console.log(require('module').createRequire(process.cwd()+'/_').resolve('@earendil-works/pi-coding-agent'))"` — session cwd resolution.
- Use `enumeratePiInstalls({ label: dir })` + `piVersionDivergence()` from
  `_lib/checks.ts` (re-exports `shared/src/pi-installs/` — ONE implementation,
  shared with the server); compare each to `readPiFloor(serverPkgJsonPath)`.
  `piVersionDivergence` answers INSTALL-SET divergence only.
- `enumeratePiCandidates()` (same module) derives the candidate set the picker
  offers; `GET /api/pi/installs` returns it with per-consumer `usedBy`.
- `curl -s localhost:8000/api/health | jq .piRuntime` — both divergence labels
  plus the two consumer versions, with the server up.
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
