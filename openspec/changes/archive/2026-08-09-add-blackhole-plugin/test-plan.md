# Test Plan — add-blackhole-plugin

Stage: design   Generated: 2026-08-09

All four spec gaps raised by the HARD gate were resolved before this catalog was
written; no clarification markers remain. Bounds below are pinned to blackhole's
own coercers (`src/core/unified-config.ts`): `positiveInt` = integer `> 0`,
`nonNegativeInt` = integer `>= 0` (`cooldownHours` only), and
`dropperPressureThreshold` = finite number in `(0, 1]`.

Levels: **L1** `packages/blackhole-plugin/src/**/__tests__/*.test.ts` (vitest) ·
**L2** `qa/tests/*.sh` (process smoke, no rendered-UI asserts) ·
**L3** `tests/e2e/*.spec.ts` (Playwright vs the docker harness port from
`.pi-test-harness.json`, never a hardcoded `:18000`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Validation is the security boundary | BVA | L1 | automated | `{observeAfterTokens: 0}` | `PUT /api/plugins/blackhole/config` | 4xx; file mtime and bytes unchanged |
| E2 | Validation is the security boundary | BVA | L1 | automated | `{observeAfterTokens: 1}` | same | 200; file contains `1` |
| E3 | Validation is the security boundary | BVA | L1 | automated | `{observeAfterTokens: -1}` | same | 4xx; unchanged |
| E4 | Validation is the security boundary | BVA | L1 | automated | `{observeAfterTokens: 1.5}` | same | 4xx (non-integer); unchanged |
| E5 | Validation mirrors the extension's coercion | BVA | L1 | automated | `{cooldownHours: 0}` on a model entry | same | 200; `0` persisted (disabled) |
| E6 | Validation mirrors the extension's coercion | BVA | L1 | automated | `{cooldownHours: -1}` | same | 4xx; unchanged |
| E7 | Bound violation rejected | BVA | L1 | automated | `{dropperPressureThreshold: 0}` | same | 4xx — interval is open at 0 |
| E8 | Bound violation rejected | BVA | L1 | automated | `{dropperPressureThreshold: 1}` | same | 200; `1` persisted |
| E9 | Bound violation rejected | BVA | L1 | automated | `{dropperPressureThreshold: 1.0001}` | same | 4xx |
| E10 | Bound violation rejected | BVA | L1 | automated | `{dropperPressureThreshold: NaN}` serialised as `null` | same | 4xx (not finite) |
| E11 | Enum violation rejected | EP | L1 | automated | `{compaction: "sometimes"}` | same | 4xx; unchanged |
| E12 | Enum violation rejected | EP | L1 | automated | `{compaction: "off"}` | same | 200 |
| E13 | Unknown key rejected | EP | L1 | automated | `{nonExistentKey: 1}` | same | 4xx; key never written |
| E14 | Rejection is atomic | decision-table | L1 | automated | `{compaction: "off", agentMaxTurns: -3}` | same | 4xx; **neither** key written |
| E15 | Config file location | decision-table | L1 | automated | `PI_CODING_AGENT_DIR=/tmp/alt` vs unset | resolve path | `/tmp/alt/pi-blackhole/…` vs `~/.pi/agent/pi-blackhole/…` |
| E16 | File absent | EP | L1 | automated | no config file on disk | `GET` config | defaults returned, absent-flag set, **file still does not exist** |
| E17 | Values absent report as defaults | EP | L1 | automated | file omits `observeAfterTokens` | `GET` config | reports `15000`, marked not-user-set |
| E18 | Chain order maps to array order | state | L1 | automated | primary `A`, fallbacks `[B, C]` | serialise | `observerModel=A`, `observerFallbackModels=[B,C]` in order |
| E19 | Promoting a fallback to primary | state | L1 | automated | primary `A`, fallbacks `[B, C]` | move `B` above `A`, save | `observerModel=B`, `observerFallbackModels=[A,C]` |
| E20 | Per-model fields are editable | EP | L1 | automated | `contextWindow` cleared to empty string | save | key **absent** from written model object, not `0`/`null` |
| E21 | A worker chain cannot be emptied | decision-table | L1 | automated | chain of exactly one entry | inspect controls | no remove control on that entry |
| E22 | Installed but never run | EP | L1 | automated | package registry lists blackhole; no config file | load settings | populated-with-defaults form, **not** the not-installed state |
| E23 | Installed-ness from registry not filesystem | decision-table | L1 | automated | config dir present but package NOT in registry (uninstall leftovers) | load settings | not-installed state — no false positive |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Unparseable config fails closed | fault-injection | L1 | automated | config file with a trailing comma | `GET` config | parse-error result carrying the parser message; **no config object** |
| X2 | Write blocked while unparseable | fault-injection | L1 | automated | same malformed file | `PUT` config | rejected; file bytes byte-identical afterwards |
| X3 | No form on parse error | state-transition | L3 | automated | malformed file | open `/settings/plugins/blackhole` | zero `input`/`select`/`textarea`/toggle for a config key; save control disabled |
| X4 | Annotation keys survive | fault-injection | L1 | automated | file with `_comment`, `_notes`, `skipForProviders` | save one unrelated key | all three present with original values |
| X5 | Unknown key survives | fault-injection | L1 | automated | file with `dropperPoolFullnessThreshold` (real blackhole key absent from our descriptors) | any save | key present, value unchanged |
| X6 | Key order is preserved | fault-injection | L1 | automated | deliberately non-alphabetical key order | save one key | original relative order retained; new keys appended |
| X7 | Re-read immediately before write | fault-injection (interleave) | L1 | automated | file mutated after client load, before request | save one key | merge uses request-read content, not the client snapshot |
| X8 | Atomic write | fault-injection (concurrent read) | L1 | automated | reader looping while a save runs | 200 save iterations | every read parses as valid JSON — never a partial file |
| X9 | Interleaved external write not reported as merged | fault-injection | L1 | automated | external write lands between request read and write | save | response does not claim the external change was preserved |
| X10 | Server-side validation is the boundary | fault-injection | L1 | automated | request bypassing the client form entirely (raw `PUT`) | invalid enum | rejected server-side — client validation is not the gate |
| X11 | Config file location | fault-injection | L1 | automated | agent dir path is unwritable | `PUT` config | error surfaced; no partial file left behind |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Reordering operable from keyboard | state-transition | L3 | automated | focus a chain entry | keyboard only, no pointer | move-up / move-down / remove all reachable and activatable; order converges to the expected array |
| F2 | Boundary controls disabled not absent | state-transition | L3 | automated | first entry in a chain | inspect | move-up present in the accessibility tree and disabled |
| F3 | Reordering accessible names | state-transition | L3 | automated | chain of 3 | inspect each control | every control exposes an accessible name identifying the model it acts on |
| F4 | Session-model tail reflects `sessionFallback` | state-transition | L3 | automated | `sessionFallback` toggled off | observe tail | tail renders session model as excluded; converges without reload |
| F5 | Implicit tail not editable in place | state-transition | L3 | automated | any worker chain | inspect | tail shown; not present as an entry of that worker's chain |
| F6 | Extension absent | state-transition | L3 | automated | package registry without blackhole | open settings page | not-installed state with `pi install npm:pi-blackhole`; zero config controls |
| F7 | Apply semantics | state-transition | L3 | automated | valid config, non-error state | render form | no text demanding a session restart; immediate-apply text attributed to the extension |
| F8 | Dirty/save/revert | state-transition | L3 | automated | change one field, then revert | observe | save disabled when clean, enabled when dirty, disabled again after revert |
| F9 | Settings surface renders no per-session state | state-transition | L3 | automated | two live sessions | open settings page | no per-session pipeline content anywhere on the page |
| F10 | Visual density and grouping of the chain editor | visual/subjective | — | manual-only | the chain editor at 375 / 768 / 1440 | a human looks | [judgment: chains remain scannable, groups read as intended — no automatable observable] |

### Performance

No latency, throughput, memory or soak requirement appears in this change's spec.
The surface is a settings page reading and writing one small JSON file. Rather
than invent a threshold, no performance scenarios are drafted — if a budget is
later stated, this section gains rows against it.

---

## New infra needed

None. L1 uses the package's own vitest config (mirroring
`packages/hermes-memory-plugin/vitest.config.ts`); L3 extends the existing
Playwright suite against the docker harness. No L2 scenarios — nothing here is
install/spawn/multi-OS in nature.

---

## Coverage summary

- Requirements covered: 12/12
- Scenarios by class: edge 23 · error-handling 11 · frontend-quirk 10 · perf 0
- Scenarios by level: L1 34 · L2 0 · L3 9 · manual-only 1
- Dispositions: automated 43 · manual-only 1
