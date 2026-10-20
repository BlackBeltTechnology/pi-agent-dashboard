# Test Plan — resync-hermes-memory-config-0-9

Stage: design   Generated: 2026-10-20

Levels: L1 = vitest under `packages/hermes-memory-plugin/src/**/__tests__/`
(server routes via Fastify `inject` against a tmp `PI_CODING_AGENT_DIR`; client
via the existing jsdom `HermesMemorySettings.test.tsx` harness). L3 = Playwright
`tests/e2e/*.spec.ts` against the docker harness (port from
`.pi-test-harness.json`), with the hermes file seeded and read out-of-band via
`docker exec -i <container> node` (pattern: `tests/e2e/access-grants-revoke.spec.ts`).
"Legacy file" = a JSON object holding all 23 `LEGACY_0_8_1_DEFAULTED_KEYS` at
their 0.8.1 defaults (incl. `consolidationTimeoutMs: 60000`). Time is injected
(`now`) for quarantine stamps. `__proto__` fixtures are built from JSON text,
never object literals (design D2).

No clarifications were needed at the HARD gate. Every Triple fills from
proposal/design/spec: error bodies `{ error, code }`, quarantine name/flags,
heal signature, and bounds are all specified. Default pinning (option B) and
corrupt-file backup were decided by the operator during doubt-review.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Field set tracks pinned version | EP | L1 | automated | `KNOWN_KEYS`, `DEFAULTS`, fixture `hermes-0.9.10-fields.json` | run shared suite | `KNOWN_KEYS` sorted equals `fixture.keys` (44); `DEFAULTS` deep-equals `fixture.defaults`; a synthetic 1-key diff makes the assertion message name that key |
| E2 | Field set tracks pinned version (local upstream check) | EP | L1 | automated | installed `~/.pi/agent/npm/node_modules/pi-hermes-memory` @0.9.10 (absent in CI) | run shared suite | absent → test reported **skipped**, suite green; present → `interface MemoryConfig` block parse yields 44 keys = `fixture.keys`, and jiti-loaded `loadConfig("/nonexistent/x.json")` deep-equals `fixture.defaults`; version ≠ fixture → fails naming both versions |
| E3 | Field set: enum | EP | L1 | automated | body `{ llmThinkingOverride: v }` for `v` ∈ `off,minimal,low,medium,high,xhigh,max,ultra` | `validateHermesConfig` | first 7 `ok:true`; `"ultra"` → error naming `llmThinkingOverride` |
| E4 | New-field bounds (chunk chars) | BVA | L1 | automated | `consolidationChunkChars` = 499, 500, 4000, 500.5, `"500"` | validate | 499 → error naming field; 500/4000/500.5 ok; `"500"` → type error |
| E5 | New-field bounds (retention) | BVA | L1 | automated | `sessionRetentionDays` = -1, 0, 1, 0.5, 3650 | validate | -1 and 0.5 → error naming field; 0, 1, 3650 ok |
| E6 | New-field bounds (timeouts) | BVA | L1 | automated | `flushCompactTimeoutMs` = -1, 0, 60000, 1.5, `NaN`; `overflowGraceMs` = -1, 0, 0.5 | validate | flush: -1/0/60000/1.5 ok, `NaN` → error; grace: -1 → error, 0 and 0.5 ok |
| E7 | New-field bounds (types) | EP | L1 | automated | each of the 8 new booleans = `"true"`; `llmFallbackModels` = `"a/b"`, `["a/b", 1]`, `["a/b"]` | validate | every boolean string → type error naming the field; first two fallback values → error; `["a/b"]` ok |
| E8 | Read: updated default | EP | L1 | automated | no file | `GET` | `fields.consolidationTimeoutMs` = `{ value: 180000, default: 180000, isDefault: true }`; all 12 new keys present in `fields` with their D7 defaults (`llmFallbackModels` value `undefined`) |
| E9 | Read: unknown key in raw only | EP | L1 | automated | file `{"futureHermesKey":42,"nudgeInterval":3}` | `GET` | `raw.futureHermesKey === 42`, `raw.nudgeInterval === 3`; `fields` has no `futureHermesKey` |
| E10 | Read: strategy derivation | decision table | L1 | automated | files (a) `{autoConsolidate:false}` (b) `{autoConsolidate:true}` (c) `{memoryOverflowStrategy:"reject",autoConsolidate:true}` (d) `{memoryOverflowStrategy:"bogus",autoConsolidate:false}` (e) `{}` | `GET` | (a) strategy `reject`, isDefault false; (b) `auto-consolidate`, false; (c) strategy `reject`, `fields.autoConsolidate` `{value:false,isDefault:false}`; (d) strategy reported verbatim `"bogus"`, autoConsolidate `false` as on disk (no derivation); (e) both default, isDefault true |
| E11 | Read: array-form override + aliases | decision table | L1 | automated | files (a) `{llmModelOverride:[" a/b ","c/d"]}` (b) `{llmModelOverride:["a/b"],llmFallbackModels:["c/d"],fallbackModels:["e/f","c/d"],llmModelFallbacks:["g/h"]}` (c) `{llmModelOverride:["",""]}` | `GET` | (a) override `"a/b"`, fallbacks `["c/d"]`, both isDefault false; (b) fallbacks = dedupe in upstream order `["c/d","g/h","e/f"]`, `raw` still has `fallbackModels` + `llmModelFallbacks`; (c) override unset, isDefault true |
| E12 | Write: preserve unknown | EP | L1 | automated | file `{"futureHermesKey":42,"nested":{"x":[1,2]}}` | `PUT` valid body with `nudgeInterval: 3` | 200; file has `futureHermesKey: 42`, `nested` deep-equal, `nudgeInterval: 3` |
| E13 | Write: cleared known key not resurrected | state-transition | L1 | automated | file `{"llmModelOverride":"a/b","futureHermesKey":42}` | `PUT` body without `llmModelOverride` | file has no `llmModelOverride`, keeps `futureHermesKey: 42`; GET → override isDefault true |
| E14 | Write: default-valued field omitted | EP | L1 | automated | no file | `PUT` `buildResolvedConfig(DEFAULTS-only)` + `nudgeInterval: 10` + `llmFallbackModels: []` | file contains exactly `{ "memoryOverflowStrategy": "auto-consolidate" }`; GET → every field isDefault true except `memoryOverflowStrategy` |
| E15 | Write: strategy authoritative | decision table | L1 | automated | no file | `PUT` `{memoryOverflowStrategy:"auto-consolidate",autoConsolidate:false}` | file has both keys exactly (strategy kept although default; autoConsolidate kept as non-default) |
| E16 | Write: legacy heal fires once | state-transition | L1 | automated | legacy file (60000) + `futureHermesKey: 1` | (1) `PUT` the client's no-touch body from that GET (2) GET (3) `PUT` body with `consolidationTimeoutMs: 60000` (4) GET | after (1): file has no `consolidationTimeoutMs`, no default-valued legacy keys, keeps `futureHermesKey`, keeps `memoryOverflowStrategy`; (2) reports 180000 isDefault true; after (3): file contains `consolidationTimeoutMs: 60000` (signature gone → not healed); (4) reports 60000 isDefault false |
| E17 | Write: heal guards | decision table | L1 | automated | (a) legacy file with `consolidationTimeoutMs: 90000`, body 60000 (b) legacy file 60000, body 120000 (c) non-legacy file `{consolidationTimeoutMs:60000}` (22 legacy keys missing), body 60000 | `PUT` | (a) file 60000 (user edit kept); (b) file 120000; (c) file 60000 (signature absent → no heal) |
| E18 | Write: `__proto__` kept as data | EP | L1 | automated | file text `{"__proto__":{"x":1},"futureHermesKey":2}` | `PUT` valid body; then `GET` | written file text contains `"__proto__"` with `{"x":1}`; `Object.hasOwn(JSON.parse(file), "__proto__")`; GET `raw` has own `__proto__`; `({}).x === undefined` (no pollution) |
| E19 | Write: body unknown key still rejected | EP | L1 | automated | file `{"futureHermesKey":42}` | `PUT` body `{futureHermesKey: 7, nudgeInterval: 3}` | 400 naming `futureHermesKey`; file bytes unchanged |
| E20 | Form: new fields render | EP | L1 | automated | GET mocked with no file | render `HermesMemorySettings`, open all groups | the 11 new defaulted fields each show their D7 default + DEFAULT badge in the D8 group; `llmFallbackModels` textarea empty + DEFAULT badge; every new control has an accessible name equal to its label |
| E21 | Form: copy rules | EP | L1 | automated | `FIELD_GROUPS` | inspect | each of the 12 new keys appears exactly once; `sessionRetentionDays` help matches `/permanently delet/i`; `flushCompactTimeoutMs` help mentions that 0 or less disables; `autoConsolidate` help matches `/ignored while Overflow strategy is set/`; no label/help matches `/\bspawn(ed|s)?\b|respawn/i` |
| E22 | Form: raw dialog shows preserved keys | EP | L1 | automated | GET mocked: `raw` has `futureHermesKey: 42` and `"__proto__"` (from JSON text) | open "View raw JSON" | dialog JSON text contains `"futureHermesKey": 42` and `"__proto__"`, plus the resolved known fields |
| E23 | Form: array-form override round-trip | state-transition | L1 | automated | GET mocked per E11(a) | trigger host Save without edits | PUT body has `llmModelOverride: "a/b"` (string) and `llmFallbackModels: ["c/d"]`; no validation error shown |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Write: preserve unknown + heal, end-to-end | state-transition | L3 | automated | container `hermes-memory-config.json` seeded via `docker exec` with legacy file (60000) + `futureHermesKey: 42` | open `/settings/plugins/hermes-memory`, change `nudgeInterval` to 7, Save, reload | file read via `docker exec` contains `futureHermesKey: 42`, `nudgeInterval: 7`, `memoryOverflowStrategy`, and no `consolidationTimeoutMs`; after reload the Consolidation timeout field shows `180000` with a DEFAULT badge; original file restored in `finally` |
| F2 | Read: no-touch save is effective-neutral | invariant (round-trip) | L1 | automated | installed upstream (skipIf absent); files: legacy (90000 variant), E10(a), E11(a), E11(b), `{memoryOverflowStrategy:"reject"}`, `{futureHermesKey:1,sessionSearch:{variant:"anchors"}}` | GET → client `buildResolvedConfig` from `fields` → compose → write tmp | jiti-loaded `loadConfig(original)` deep-equals `loadConfig(written)` for every file |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Write: malformed file quarantined | fault-injection (corrupt content) | L1 | automated | file bytes `{ "memoryMode": ` | `PUT` valid body at `now = 2026-10-20T08:09:10.123Z` | 200; `hermes-memory-config.json.corrupt-20261020T080910123Z` exists with the exact original bytes, mode `0600`, name has no `:`; config file = new written object; one log line containing the quarantine path and reason `unparseable`, no field values |
| X2 | Write: non-object JSON quarantined | EP | L1 | automated | file bytes `null`, `[]`, `42`, `""` (empty file), BOM + `{"nudgeInterval":3}` | `PUT` valid body | each → quarantine copy created (reason `not-an-object` for `null`/`[]`/`42`, `unparseable` for empty and BOM); written file has no `nudgeInterval: 3` from the BOM file; GET before the PUT reported all defaults for the BOM file |
| X3 | Write: quarantine never overwrites | fault-injection (EEXIST) | L1 | automated | malformed file; pre-existing `…corrupt-<stamp>` for the same `now` | `PUT` | `…corrupt-<stamp>-1` created; pre-existing backup bytes unchanged |
| X4 | Write: quarantine copy fails | fault-injection (abort) | L1 | automated | malformed file; copy stubbed to throw `EACCES` | `PUT` | 500 `{ error: "hermes config quarantine failed", code: "EACCES" }`; config file bytes unchanged; no tmp file left |
| X5 | Read/Write: unreadable file | fault-injection (abort) | L1 | automated | config path is a **directory** (`EISDIR`) | `GET`, then `PUT` valid body | GET → 500 `{ error: "hermes config file unreadable", code: "EISDIR" }`; PUT → same 500, path still a directory, nothing written; log line has path + code only |
| X6 | Write: unreadable error surfaces in form | fault-injection (abort) | L1 | automated | PUT mocked to 500 `{ error: "hermes config file unreadable", code: "EACCES" }` | host Save | the existing save-error notice shows text containing "unreadable"; form values kept (no reset) |
| X7 | Write: live hermes picks up the saved file | manual verification | — | manual-only | real `~/.pi/agent/hermes-memory-config.json` that the 0.8.1-era plugin saved (all defaults pinned, 60000) plus a hand-added unknown key | save any field from the dashboard, then start a new pi session | [judgment: the new session's console shows no "consolidationTimeoutMs is set to 60000ms" warning; the hand-added key is still in the file; memory tools behave normally] |

---

## Coverage summary

- Requirements covered: 5/5 delta requirements (Read effective config; Write
  full resolved config; Reject invalid config, regression E19; Field set tracks
  pinned version; New-field bounds).
- Scenarios by class: edge 23 · perf 0 · frontend 2 · error 7
- Scenarios by level: L1 30 · L2 0 · L3 1 · manual 1
- Scenarios by disposition: automated 31 · manual-only 1

## New infra needed

- none. Fixture JSON + jiti dynamic load (jiti 2.7.0 already hoisted), and the
  existing `docker exec` out-of-band pattern for L3.
