# Test Plan — fix-pi-install-node26-and-omit-dev-build

Stage: design   Generated: 2026-07-21   Revised: drift recheck (D1–D8)

All scenario Triples are fillable from the specs — no clarification gaps.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Refuse start on Node outside engines range | BVA | L1 | automated | `"v26.0.0"` (and `"v26.5.0"`) | `isOutOfEnginesRange(v)` / `isUsableNodeVersion(v)` | `isOutOfEnginesRange` returns `false`; `isUsableNodeVersion` returns `true` (Node 26 now in range) |
| E2 | Refuse start on Node outside engines range | BVA (just-above-cap) | L1 | automated | `"v27.0.0"` | `isOutOfEnginesRange(v)` | returns `true`; `isUsableNodeVersion("v27.0.0")` returns `false` |
| E3 | Refuse start on Node outside engines range | BVA (floor + fastify range unchanged) | L1 | automated | `"v22.19.0"`, `"v22.18.0"`, `"v24.2.0"` | `isUsableNodeVersion(v)` | `22.19.0`→`true`; `22.18.0`→`false`; `24.2.0`→`false` (Fastify-affected, unchanged) |
| E4 | Engines-range message references bundled-Node remediation | example-version update | L1 | automated | `buildEnginesRangeMessage("v27.0.0")` (builder lives in `packages/server/src/auth/node-guard.ts`) | call the builder | returned string contains `cannot start on Node v27.`, `Required: >=22.19.0 <27`, `nvm install`, `PATH="$HOME/.pi-dashboard/node/bin`, `brew install node` |
| E5 | Single-source Node-version predicates | static scan | L1 | automated | repo source tree, scoped to `packages/*/src/**` EXCLUDING `__tests__/` | grep for engines-cap arithmetic | the literal `major >= 27` (engines cap) appears only in `packages/shared/src/node-version.ts`; no stray `major >= 26` cap check remains. The `__tests__/` exclusion is load-bearing — without it the scan matches the scanning test's own assertions and passes vacuously. |
| E6 | Client build-time deps are runtime dependencies | decision-table (dep placement) | L1 | automated | `packages/client/package.json` | inspect deps vs devDeps | `dependencies` contains `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss`, `tsx`; `devDependencies` contains none of the first four |
| E7 | Client build-time deps are runtime dependencies | guard assertion | L1 | automated | `packages/client/package.json` with a build dep moved back to `devDependencies` | run `scripts/verify-release-deps.mjs` | script exits non-zero and names the missing client `dependencies` entry |
| E8 | CI lockstep matrix includes every SUPPORTED Node major | config parse | L1 | automated | `.github/workflows/_smoke.yml` `standalone-install-smoke-linux` matrix (`ci.yml` has no Node-major matrix — single `node-version: 22` setup-node) | parse the Node matrix with a YAML parser | matrix majors equal the declared supported set `{22, 24, 25, 26}` (includes `26`). NOTE: this is the SUPPORTED set, not every major the range admits — `>=22.19.0 <27` also admits 23, which is EOL and deliberately unlisted. The spec wording "every Node major in the engines range" must be corrected to match, else the requirement and its scenario contradict each other. |
| E10 | Single-source Node-version predicates (message literal) | invariant cross-check | L1 | automated | root `package.json#engines.node` + the string emitted by `buildEnginesRangeMessage` | call the builder, compare against the manifest range | the emitted `Required: …` substring contains the engines range verbatim. Covers the THIRD cap location the lockstep contract misses — E5's arithmetic scan cannot see a string literal. |
| E9 | Refuse start on Node outside engines range (regression) | existing-assertion correction | L1 | automated | the pre-existing suites that encode the OLD `<26` cap | `npm test` after the cap raise | no assertion claims Node 26 is out of range: `node-guard.test.ts` v26 cases flip to `false`, its range match reads `<27`, its `buildEnginesRangeMessage` probes use `"v27.0.0"`; `node-version.test.ts` accept-set row `v26.0.0` → `true` |

### Error-handling

| id | requirement | technique | level | disposition | fault/state | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------------|---------|---------------------|
| X1 | Fresh checkout builds the client under --omit=dev | install-path (no devDeps), dual resolution engine × engine-strict mode | L2 | automated | clean checkout, no `node_modules`, no `packages/client/dist` | three arms at repo root: (1) `npm install --omit=dev --engine-strict=false` (isolates the BUILD failure); (2) `npm install --omit=dev` with `.npmrc engine-strict=true` in force — the ONLY full-fidelity reproduction of the real #357 codepath; (3) `pnpm install --prod --frozen-lockfile` (locked-tree reproducibility; resolve `--prod` vs `--omit=dev` for the installed pnpm major up front — a silently-accepted no-op flag makes this arm vacuous) | each arm exits `0` and `packages/client/dist/index.html` exists; a pass/fail split between arms signals npm-vs-pnpm resolution drift. ARM 2 MUST RUN ON NODE >= 26 (pin, or skip loudly) — on Node 22 its engine-strict assertion passes trivially and proves nothing. |
| X2 | Node 26 support (design D2) | multi-runtime install | ci | automated | standalone install on a Node 26 runner | `_smoke.yml` linux leg with `node-version: 26` | install-smoke job passes on Node 26 |
| X3 | Node 26 install succeeds under engine-strict (#357a) | negative-control / regression | ci | automated | Node 26 Linux smoke leg WITHOUT the `--config.engine-strict=false` override | `_smoke.yml` linux leg `node-version: 26` (runs `pnpm install --frozen-lockfile`) | install completes with no `EBADENGINE`. SCOPE: proves the manifest engines range admits 26 under a strict installer — NOT the exact pi codepath, since pi runs `npm`, not `pnpm`, and the two resolve `engine-strict` through different config cascades. Full npm+engine-strict fidelity is X1 arm 2; end-to-end is M1. Safe on Linux: `appdmg@0.6.6` is `engines: >=8.5`, `os: [darwin]` (platform-filtered out, no upper bound), and the lockfile's sole upper-bounded range `>=6 <7 \|\| >=8` admits 26. |

### Manual-only

| id | requirement | technique | level | disposition | surface | human action | expected observable |
|----|-------------|-----------|-------|-------------|---------|-------------|---------------------|
| M1 | #357 end-to-end reproduction | real-world repro | — | manual-only | fresh machine, Node 26, pi installed | `pi install git:github.com/BlackBeltTechnology/pi-agent-dashboard` | command completes without `EBADENGINE` or `Cannot find module 'vite/package.json'`; dashboard loads |

---

## Coverage summary

- Requirements covered: 5/5 (3 modified node-guard + 2 new git-install)
- Scenarios by class: edge 10 · perf 0 · frontend 0 · error 3 · manual 1
- Scenarios by level: L1 9 · L2 1 · ci 2 · manual-only 1
- Scenarios by disposition: automated 13 · manual-only 1

## New infra needed

- none — E1–E3/E5 extend `packages/shared/src/__tests__/node-version.test.ts`; E4 + E9 extend
  `packages/server/src/__tests__/node-guard.test.ts`; E6–E8 are repo-lints over
  `package.json`/workflow YAML (siblings of `bundled-node-meets-pi-floor.test.ts` /
  `publish-workflow-contract.test.ts` / `verify-release-deps.mjs`); X1 extends the `qa/` install
  smoke tier; X2 extends the existing `_smoke.yml` matrix.
