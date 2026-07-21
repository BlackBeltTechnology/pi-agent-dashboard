# Test Plan — fix-pi-install-node26-and-omit-dev-build

Stage: design   Generated: 2026-07-21

All scenario Triples are fillable from the specs — no clarification gaps.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Refuse start on Node outside engines range | BVA | L1 | automated | `"v26.0.0"` (and `"v26.5.0"`) | `isOutOfEnginesRange(v)` / `isUsableNodeVersion(v)` | `isOutOfEnginesRange` returns `false`; `isUsableNodeVersion` returns `true` (Node 26 now in range) |
| E2 | Refuse start on Node outside engines range | BVA (just-above-cap) | L1 | automated | `"v27.0.0"` | `isOutOfEnginesRange(v)` | returns `true`; `isUsableNodeVersion("v27.0.0")` returns `false` |
| E3 | Refuse start on Node outside engines range | BVA (floor + fastify range unchanged) | L1 | automated | `"v22.19.0"`, `"v22.18.0"`, `"v24.2.0"` | `isUsableNodeVersion(v)` | `22.19.0`→`true`; `22.18.0`→`false`; `24.2.0`→`false` (Fastify-affected, unchanged) |
| E4 | Engines-range message references bundled-Node remediation | example-version update | L1 | automated | `buildEnginesRangeMessage("v27.0.0")` | call the builder | returned string contains `cannot start on Node v27.`, `Required: >=22.19.0 <27`, `nvm install`, `PATH="$HOME/.pi-dashboard/node/bin`, `brew install node` |
| E5 | Single-source Node-version predicates | static scan | L1 | automated | repo source tree | grep for engines-cap arithmetic | the literal `major >= 27` (engines cap) appears only in `packages/shared/src/node-version.ts`; no stray `major >= 26` cap check remains |
| E6 | Client build-time deps are runtime dependencies | decision-table (dep placement) | L1 | automated | `packages/client/package.json` | inspect deps vs devDeps | `dependencies` contains `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss`, `tsx`; `devDependencies` contains none of the first four |
| E7 | Client build-time deps are runtime dependencies | guard assertion | L1 | automated | `packages/client/package.json` with a build dep moved back to `devDependencies` | run `scripts/verify-release-deps.mjs` | script exits non-zero and names the missing client `dependencies` entry |
| E8 | CI lockstep matrix includes every engines-range major | config parse | L1 | automated | `.github/workflows/_smoke.yml` (+ `ci.yml` lockstep list) | parse the Node matrix | matrix majors equal the engines range set `{22, 24, 25, 26}` (includes `26`) |

### Error-handling

| id | requirement | technique | level | disposition | fault/state | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------------|---------|---------------------|
| X1 | Fresh checkout builds the client under --omit=dev | install-path (no devDeps) | L2 | automated | clean checkout, no `node_modules`, no `packages/client/dist` | `npm install --omit=dev --engine-strict=false` at repo root | exit `0` and `packages/client/dist/index.html` exists |
| X2 | Node 26 support (design D2) | multi-runtime install | ci | automated | standalone install on a Node 26 runner | `_smoke.yml` linux leg with `node-version: 26` | install-smoke job passes on Node 26 |

### Manual-only

| id | requirement | technique | level | disposition | surface | human action | expected observable |
|----|-------------|-----------|-------|-------------|---------|-------------|---------------------|
| M1 | #357 end-to-end reproduction | real-world repro | — | manual-only | fresh machine, Node 26, pi installed | `pi install git:github.com/BlackBeltTechnology/pi-agent-dashboard` | command completes without `EBADENGINE` or `Cannot find module 'vite/package.json'`; dashboard loads |

---

## Coverage summary

- Requirements covered: 5/5 (3 modified node-guard + 2 new git-install)
- Scenarios by class: edge 8 · perf 0 · frontend 0 · error 2 · manual 1
- Scenarios by level: L1 7 · L2 1 · ci 1 · manual-only 1
- Scenarios by disposition: automated 10 · manual-only 1

## New infra needed

- none — E1–E8 extend `packages/shared/src/__tests__/node-version.test.ts` + a repo-lint over
  `package.json`/workflow YAML (sibling to existing `bundled-node-meets-pi-floor.test.ts` /
  `verify-release-deps.mjs`); X1 extends the `qa/` install smoke tier; X2 extends the existing
  `_smoke.yml` matrix.
