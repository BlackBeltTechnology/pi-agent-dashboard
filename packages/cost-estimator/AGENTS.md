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
| `.pi/skills/software-cost-estimator/SKILL.md` | Skill: requirements → estimate workflow, 7 steps (gather, architecture plan, build input, run, sanity-check, deliver, calibrate). Rules: never a single number — P50/P85/P95; estimate ≠ target ≠ commitment; one NFR path; assumption register. Four delivery modes `human_only`→`agentic_hitl`. Bins `bin/estimate.mjs`, `bin/calibrate.mjs`, `bin/calibrate-sessions.mjs`. |
| `.pi/skills/software-cost-estimator/assets/calibration/reference-classes.md` | Reference classes: measured h/UCP — WMS 12.97 vs Karner 20 (+54% overquote); add row per completed project. Measured telemetry: 542 sessions, 737.5 steering h, $7,676, $10.41/h; ACEM Context Factor 5.10 vs 1.25 default; cache-read 95.5% of tokens; steering overhead 1.5×/1.8×/2.25×. |
| `.pi/skills/software-cost-estimator/assets/templates/architecture-plan.md` | Template: `architecture-plan.md`, {{PROJECT}}/{{CLIENT}}/{{DATE}} placeholders. 8 sections: context, stack, component view + key flows (mermaid), ADRs, NFR → component trace matrix (derives scope), risks mapped to estimate input, out-of-scope. |
| `.pi/skills/software-cost-estimator/assets/templates/offer-summary.md` | Template: client offer `offer-summary.md`: outcome, must/should/could scope tiers, effort + price tables, delivery approach (traditional vs AI-assisted), team, timeline, payment milestones 30/30/20/15/5, assumptions, exclusions, options. Net price + VAT, 30-day validity. |
| `.pi/skills/software-cost-estimator/references/ai-delivery-modes.md` | Evidence: AI effect bimodal — METR RCT 19% slower on mature repos, Demirer +26.08% tasks, Jellyfish ≈8% real. `ai_class` speedups 0.45 docs → 1.10 legacy-change (slower). Codebase 0.92 greenfield/1.12 legacy; seniority 0.90 junior/1.08 senior; review + rework lines. Seat plans; measured leverage 6.4×. |
| `.pi/skills/software-cost-estimator/references/business-case.md` | Business case: 9-part structure; engine computes cost/financials/sensitivity/scope ladder, you write problem/options/recommendation/benefit/risks. Benefit = mechanism + confidence weight (`annual_value × confidence`). NPV/ROI/payback/TCO; fund at P85. Sensitivity: build ±30%, benefit ±40%, run ±50%. |
| `.pi/skills/software-cost-estimator/references/nfr-catalog.md` | NFR routing: exactly one path per NFR — derived-scope (`derived_components` sized via `transactions`/`hours`) OR residual multiplier (keep small, < ~1.25 stack). ISO/IEC 25010 attribute table; compliance largest derived block (validation protocols 100–200 h). Engine warns on double-count. |
| `.pi/skills/software-cost-estimator/references/rates.md` | Default rate card EUR/day net: per-role junior/mid/senior; blended 480. Anchors: enterprise 600 EUR, SME/Hungary 423 EUR, CEE 30–70 EUR/h. Override `--rates <file>` / `rates_file`. Landed cost 1.3–1.5× headline. Present net + 27% VAT, 30-day validity. |
| `.pi/skills/software-cost-estimator/references/role-model.md` | Role split: one effort estimate distributed, never independent. Defaults: Backend 22%, Frontend 17%, QA 16%, Data/Integration 9%, PO/BA 7%, UX 7%, Architect 6%, DevOps 6%, PM 5%, Tech Lead 3%, Security 2%; dev/non-dev ≈60/40. Size tilt >4,000 h; seniority 40/40/20; override `team.role_ratios`. |
| `.pi/skills/software-cost-estimator/references/sizing-methods.md` | Sizing: UCP primary (MMRE ≈39%). UUCW ≤3→5 / 4–7→10 / >7→15; UAW 1/2/3; TCF 0.6+0.01Σ(T1–T13); ECF 1.4−0.03Σ(E1–E8, E7/E8 negative); UCP = (UUCW+UAW)×TCF×ECF; Effort = UCP × h/UCP (Karner 20). COCOMO II diseconomy `(UCP/ref)^(E−1)`; cross-checks COSMIC, IFPUG + SNAP. |
| `README.md` | Package overview. Skill + zero-dep engine + dashboard plugin. Documents the four delivery modes, the subscription-vs-metered cost basis, the load-bearing dependency split, plugin slots, and the CLI entry points. |
| `package.json` | Manifest. `pi.skills` exposes `.pi/skills/software-cost-estimator`; `pi-dashboard-plugin` claims `command-route`/`settings-section` (id `cost-estimator`, server + configSchema). NO `content-view` claim — `forSession()` keeps predicate-less claims, so one would replace `ChatView` for every session with no chrome to dismiss it; guarded by `src/__tests__/manifest-claims.test.ts`. See change: drop-cost-content-view-claim. Bins `pi-estimate`, `pi-estimate-calibrate`, `pi-estimate-calibrate-sessions` → `bin/*.mjs`. Deps: dashboard-plugin-runtime, pi-dashboard-shared, pi-dashboard-session-distiller. NO local vitest — root supplies v4. |
| `tsconfig.json` | Extends `tsconfig.base.json`; `rootDir` src, `outDir` dist, `jsx` react-jsx. |
| `vitest.config.ts` | Vitest project config. `include` `src/**/__tests__/**/*.test.ts`, node env, forks pool, `maxWorkers` "50%". Registered in the ROOT `vitest.config.ts` projects list. |

## Subfolders

- `bin/` — thin `.mjs` launchers that spawn `tsx` (bare node cannot resolve the `.js` specifiers to `.ts` sources)
- `src/engine/` — zero-dependency arithmetic: sizing, effort, roles, modes, simulation, business case, reporting, xlsx
- `src/telemetry/` — session-store adapter; the only workspace-dependent module
- `src/bin/` — CLI implementations (estimate, calibrate, calibrate-sessions)
- `src/client/` — dashboard plugin client (`CostView`, `CostSettings`)
- `src/server/` — dashboard plugin server (`GET /api/cost-estimator/telemetry`, 60s cache)
- `src/__tests__/` — 68 vitest tests, incl. `manifest-claims.test.ts` (no predicate-less `content-view` claim; `cost` command-route survives)
- `.pi/skills/software-cost-estimator/` — the skill: SKILL.md, references/, assets/

## Origin

Ported from the standalone global skill at `~/.pi/agent/skills/software-cost-estimator/`
(now removed — this package is the single source of truth). The port replaced hand-rolled
session-log parsing with `readSessionMeta` from `pi-dashboard-shared` and `readSession` from
`pi-dashboard-session-distiller`, and converted a bespoke test harness to vitest.

Research and calibration evidence live outside this repo at
`~/Documents/Projektek/CostEstimator/research/`.
