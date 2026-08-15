# DOX — packages/cost-estimator

Software cost/effort estimation skill + zero-dep engine + dashboard plugin.

## Local contracts

- **Engine stays zero-dependency.** `src/engine/` must not import from `src/telemetry/`,
  `src/server/`, `src/client/`, or any workspace package. The engine has to run in a project
  with no dashboard installed. `src/telemetry/sessions.ts` is the ONLY module allowed to
  touch the session store.
- **Never a single number.** Estimates emit P50/P85/P95. Estimate ≠ target ≠ commitment.
- **One NFR, one path.** An NFR routes to derived scope OR a residual multiplier, never both.
- **Never bill a seat twice.** Under `cost_basis: subscription` the per-dev licence line is
  suppressed — the seat IS the licence.
- **Leverage is not a saving.** Meter-equivalent ÷ subscription cost is reported as leverage;
  it must never be presented to a client as a discount.
- Every default constant carries a `src` note; ungrounded values are marked UNCALIBRATED.
- Tests run from the monorepo root (`npx vitest run packages/cost-estimator`), not per-package
  — the package deliberately declares no local vitest, so it uses the root's v4.

## Naming (settled — do not re-litigate)

Package is `@blackbelt-technology/pi-dashboard-cost-estimator`, NOT `pi-cost-estimator`.

The question recurs because `src/engine/` is deliberately portable and zero-dep, so the
`pi-dashboard-` prefix looks like it overclaims coupling. It does — for that ONE subtree.
The other three (`telemetry/`, `client/`, `server/`) genuinely require the dashboard, and the
package is bundled into the Electron app. `pi-cost-estimator` would underclaim 3 of 4.
Convention also carries it: 35 of 41 workspace packages use `pi-dashboard-*`; only
`pi-image-fit-extension` uses a bare `pi-` prefix.

CLI bins keep the shorter `pi-estimate*` stem by choice — they are typed by hand.

## Files

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Skill + zero-dep engine + dashboard plugin. Documents the four delivery modes, the subscription-vs-metered cost basis, the load-bearing dependency split, plugin slots, and the CLI entry points. |
| `package.json` | Manifest. `pi.skills` exposes `.pi/skills/software-cost-estimator`; `pi-dashboard-plugin` claims `content-view`/`command-route`/`settings-section` (id `cost-estimator`, server + configSchema). Bins `pi-estimate`, `pi-estimate-calibrate`, `pi-estimate-calibrate-sessions` → `bin/*.mjs`. Deps: dashboard-plugin-runtime, pi-dashboard-shared, pi-dashboard-session-distiller. NO local vitest — root supplies v4. |
| `tsconfig.json` | Extends `tsconfig.base.json`; `rootDir` src, `outDir` dist, `jsx` react-jsx. |
| `vitest.config.ts` | Vitest project config. `include` `src/**/__tests__/**/*.test.ts`, node env, forks pool, `maxWorkers` "50%". Registered in the ROOT `vitest.config.ts` projects list. |

## Subfolders

- `bin/` — thin `.mjs` launchers that spawn `tsx` (bare node cannot resolve the `.js` specifiers to `.ts` sources)
- `src/engine/` — zero-dependency arithmetic: sizing, effort, roles, modes, simulation, business case, reporting, xlsx
- `src/telemetry/` — session-store adapter; the only workspace-dependent module
- `src/bin/` — CLI implementations (estimate, calibrate, calibrate-sessions)
- `src/client/` — dashboard plugin client (`CostView`, `CostSettings`)
- `src/server/` — dashboard plugin server (`GET /api/cost-estimator/telemetry`, 60s cache)
- `src/__tests__/` — 43 vitest tests
- `.pi/skills/software-cost-estimator/` — the skill: SKILL.md, references/, assets/

## Origin

Ported from the standalone global skill at `~/.pi/agent/skills/software-cost-estimator/`
(now removed — this package is the single source of truth). The port replaced hand-rolled
session-log parsing with `readSessionMeta` from `pi-dashboard-shared` and `readSession` from
`pi-dashboard-session-distiller`, and converted a bespoke test harness to vitest.

Research and calibration evidence live outside this repo at
`~/Documents/Projektek/CostEstimator/research/`.
