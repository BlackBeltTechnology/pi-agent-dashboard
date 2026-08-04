# Test Plan — update-pi-core-0-83-adopt-apis

Stage: apply   Generated: 2026-07-29

No clarification gaps — every Triple below fills concretely from the corrected spec.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | agent-role-model-tools: non-empty scope narrows | decision-table | L1 | automated | `getAvailable()` = [x/A, y/B, z/C]; `ctx.scopedModels` = [{model:{provider:x,id:A}}] | `list_models` invoked | result rows = [x/A] only; `ref` "x/A" present & assignable; `registryReady` computed as before |
| E2 | agent-role-model-tools: present-but-empty scope falls back | BVA (empty boundary) | L1 | automated | `getAvailable()` = [x/A, y/B, z/C]; `ctx.scopedModels` = [] | `list_models` invoked | output byte-identical to the absent case — all 3 rows, same order, no models dropped |
| E3 | agent-role-model-tools: absent scope falls back | EP | L1 | automated | `ctx.scopedModels` = undefined | `list_models` invoked | unfiltered `getAvailable()` output; no throw |
| E4 | agent-role-model-tools: ref derived from Model object | BVA (type boundary) | L1 | automated | scoped entry `{model:{provider:"anthropic",id:"claude-x"}}`; getAvailable row key `anthropic/claude-x` | intersection runs | derived ref `anthropic/claude-x` matches the row key; row RETAINED (object-vs-string mismatch would drop it → fail) |
| E5 | pi-core-version-check: recommended bump = hint not block | state-transition | L1 | automated | installed pi `0.81.1`; window {min 0.78.0, rec 0.83.0} | `pi-version-skew.ts` computes | upgrade hint toward `0.83.0`; session continues (no hard block) |
| E6 | pi-core-version-check: exactly recommended = no hint | BVA (at boundary) | L1 | automated | installed pi `0.83.0`; rec `0.83.0` | skew compute | no upgrade banner |
| E7 | pi-core-version-check: below minimum still gated | BVA (just-below-min) | L1 | automated | installed pi `0.77.0`; min `0.78.0` | skew compute | minimum-version gate applies unchanged |
| E8 | pi-core-version-check: coherent pins pass | decision-table | L1 | automated | server dep `^0.83.0`, `piCompatibility.recommended 0.83.0`, Dockerfile `@0.83.0` | `verify-release-deps.mjs` run | pi coherence check passes; exit 0 |
| E9 | pi-core-version-check: drifted pin fails + names it | decision-table | L1 | automated | server dep `^0.83.0`, recommended `0.82.0` (drift), Dockerfile `@0.83.0` | run | check fails; names `piCompatibility.recommended` as the drifted location |
| E10 | pi-core-version-check: normalization across syntaxes | EP | L1 | automated | three pins `^0.83.0` / `0.83.0` / `@0.83.0` (same version) | run | passes — normalizer treats them equal; no false-fail |
| E11 | TypeBox: zero usage of removed APIs | static analysis | ci | automated | `packages/extension/src` (non-test) | grep `Type.Base\|Awaited\|Promise\|AsyncIterator\|Iterator\|Options\|Value.Mutate` | zero matches |
| E12 | TypeBox: nullable-array arg — field absent | BVA (missing) | L1 | automated | `ask-user` args with `options` omitted, validated under typebox `1.3.7` | validate | accepted (unchanged from 1.1.x baseline) |
| E13 | TypeBox: nullable-array arg — null value | BVA (null) | L1 | automated | `ask-user` args `options: null` under `1.3.7` | validate | same accept/reject verdict as pre-bump baseline |
| E14 | TypeBox: nullable-array arg — valid array | EP (nominal) | L1 | automated | `ask-user` args `options: ["a","b"]` under `1.3.7` | validate | accepted |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | agent-role-model-tools: capture guarded | fault-injection (absent surface) | L1 | automated | `ctx` lacking `scopedModels` | read at `list_models` call time | no throw; falls back to unfiltered catalogue |
| X2 | pi-api-feature-detection: "pending" not empty-actionable | state-transition | L1 | automated | `agent_end` assistant msg `stopReason="pending"`, no visible text/tool call, reaching the classifier | `classifyTurnActionability` | returns in-progress/`normal`; NOT `empty-actionable` |
| X3 | pi-api-feature-detection: idle non-pending still guarded | state-transition (illegal-edge guard) | L1 | automated | empty turn whose stopReason is NOT `"pending"` | classify | `empty-actionable` — `EmptyActionableGuard` behavior unchanged from today |
| X4 | pi-api-feature-detection: provider-error still error | state-transition | L1 | automated | turn mapping to a provider error (incl. 0.83.0 unmapped-terminal→error) | classify | `error` (precedence over empty-actionable) |

### CI / suite

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| E15 | TypeBox + adoptions: full extension suite green | regression run | ci | automated | full extension vitest suite against resolved `0.83.0` + typebox `1.3.7` | 0 failures | one CI run |

### Manual-only (no automatable observable)

| id | requirement | technique | level | disposition | surface | human action | outcome |
|----|-------------|-----------|-------|-------------|---------|--------------|---------|
| M1 | bash-execution: streaming/env feasibility spike | investigation | — | manual-only | dashboard bash paths (`pi.exec`, `tool_execution_*`, worktreeInit) | engineer investigates whether any path surfaces `bash_execution_update` / `PI_SESSION_*` | finding recorded in `bash-execution` spec; code lands only if a path exists |
| M2 | pi-api-feature-detection: outputPad no-op rationale | documentation | — | manual-only | `pi-api-feature-detection` spec | reviewer confirms TUI-only, no web surface | no-op rationale recorded; no renderer, no code |

---

## Coverage summary

- Requirements covered: 4/4 spec deltas (pi-core-version-check, agent-role-model-tools, pi-api-feature-detection, bash-execution)
- Scenarios by class: edge 14 · perf 0 · frontend 0 · error 4 · ci 1 · manual 2
- Scenarios by level: L1 15 · L2 0 · L3 0 · ci 2 · — (manual) 2
- Scenarios by disposition: automated 19 · manual-only 2

## New infra needed

- none — all automated scenarios route to existing L1 vitest (`packages/*/**/__tests__/*.test.ts`) or CI (workflow + `scripts/__tests__` fixture pattern). No L2/L3 needed: this change touches pin coherence, tool-output logic, schema validation, and a stop-reason classifier — none render UI. (The one UI-adjacent capability, streaming bash, is a manual-only spike.)

## Deferred / out of scope

- **Node-floor watch** (proposal watch item): `bundled-node-meets-pi-floor.test.ts` keys on `minimum` only; a recommended→Node-floor check is a follow-up guard, not a task in this change — no scenario folded.
