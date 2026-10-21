# Spike — real-repo proof (design D3, tasks 4.1–4.3)

Date 2026-10-21. CodeQL CLI 2.27.2 locally and `codeql-action` CLI 2.27.2 on GitHub. Both sides ran
`codeql/javascript-queries@2.4.7` + `codeql/javascript-all@2.10.3+a7057b836bf29767461026718b14d20790b9085f`
(GitHub SARIF `tool.extensions`; locally the same vendored library).

Branches (throwaway, never merged), both from `develop` d6fa16155:

| Branch | PR | Contents |
|---|---|---|
| `spike/codeql-control-probe` | #1008 (draft, closed) | `develop` + probe + fixtures |
| `spike/codeql-model-probe` | #1009 (draft, closed) | this change's commits A + code (no prune commit B) + probe + fixtures |

Probe source: `spike-probe-routes.ts.txt` (`packages/server/src/codeql-probe-routes.ts`, own `Fastify()`, imports the
real `@blackbelt-technology/pi-dashboard-shared/cwd-guard.js` and `project-name.js`, never imported by production code).
Nested fixture `packages/x/spike/b.mjs` and the same code at root `spike/a.mjs`: `spike-nested-b.mjs.txt`
(`js/path-injection` + `js/command-line-injection`).
Probe line map: 23 `isAllowedCwd` guarded · 26 twin · 32 `admissionAllows` guarded · 35 twin · 41 `tokenAllows` guarded ·
45 twin · 50 `isPortableProjectName` guarded · 53 twin · 56 `admitCwd` argument · 65 `admitCwd` result never branched on (negative).

## `js/path-injection` per probe line (identical on GitHub and local)

| Line | Probe | control CI #1008 | control local | probe CI #1009 | probe local |
|---|---|---|---|---|---|
| 23 | `isAllowedCwd` guarded | reported | reported | **suppressed** | **suppressed** |
| 26 | `isAllowedCwd` twin | reported | reported | reported | reported |
| 32 | `admissionAllows` guarded | absent | absent | absent | absent |
| 35 | `admissionAllows` twin | reported | reported | reported | reported |
| 41 | `tokenAllows` guarded | absent | absent | absent | absent |
| 45 | `tokenAllows` twin | reported | reported | reported | reported |
| 50 | `isPortableProjectName` guarded | reported | reported | **suppressed** | **suppressed** |
| 53 | `isPortableProjectName` twin | absent | absent | absent | absent |
| 56 | `admitCwd` argument (sink inside admitCwd) | no `cwd-guard.ts` alert | none | none | none |
| 65 | `admitCwd` result unchecked (negative) | reported | reported | reported | reported |

Fixtures: control CI and local report `packages/x/spike/b.mjs` (6, 7) **and** `spike/a.mjs` (6, 7); probe CI and local
report `packages/x/spike/b.mjs` (6, 7) only. Root `spike/**` is excluded, the nested directory stays analyzed — on both sides.

Run URLs (CodeQL workflow): control `…/actions/runs/39598274636`, probe `…/actions/runs/39598279276`; analyses
1996283811 (control, 20 results) and 1996284173 (probe, 16 results), `javascript-typescript`.
Local `--json` (probe): `versions.models` `d93b86d7…d2ea43`; control has no model (script of `develop`).

## Verdict

- **Parity: PASS.** Local equals GitHub in every cell, on both branches, with equal `javascript-all` versions.
- **Fix effect: PASS.** The fixed model suppresses exactly the guarded sinks of `isAllowedCwd` (23) and
  `isPortableProjectName` (50) and nothing else. The probe's results are a subset of the control's. The negative case
  (65) and every unguarded twin stay reported, so no unguarded flow is hidden.
- **Root-only `spike/**`: PASS** (CI and local).
- **Deviation from the design's control expectation ("every probe sink reported on control").** Three cells are not
  informative: the guarded `admissionAllows` (32) and `tokenAllows` (41) sinks and the `admitCwd` argument (56) are
  already silent on the control, with the original (dead) model, locally and on GitHub. CodeQL evidently treats those
  guards natively (their bodies end in an equality check on the request cwd) — a hypothesis, not verified. Consequence:
  the model rows for those three predicates have no observable effect and cannot be shown harmful either; the unguarded
  twins (35, 45) are present, so the probe is not inconclusive in the design's sense. The activation risk the proposal
  names for these predicates is therefore bounded by: nothing changed in the probe for them.
- Observation: `js/clear-text-logging` fixtures (the pattern of test #E12) did not fire in the full repository
  (they fire in a tiny repo), hence the path/command-injection fixtures here. Cause not investigated.
- Pitfall found while building test #E4: a guard body of `known().includes(cwd)` is itself a CodeQL sanitizing guard
  and hides the model; the mini-monorepo fixture uses opaque bodies.
- GitHub alert state after merge to `develop` (alerts at sinks the model now suppresses) is not observable before
  merge; to be recorded when the change lands.
