# Test Plan — add-roles-read-api

Stage: proposal/design   Generated: 2026-08-31

All four clarification gaps raised at the HARD gate were resolved before this
plan was written (axis ordering, auth-failure observable, ref-splitting rule,
latency budget). The two behavioural answers — axis ordering and last-colon ref
splitting — were folded into `specs/agent-role-introspection/spec.md` as
requirements, not left as test-only values. No open markers.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E18 | Effective schema construction (pure helper) | EP | L1 | automated | config with defaults, `roleNames`, assigned keys and `removedRoles` | `effectiveRoleNames` | returns the union minus removals, in canonical order (defaults → user-added → remaining assigned), stable across calls |
| E1 | Complete axis / unassigned included | EP | L1 | automated | config assigns `coding`, not `vision` | GET /api/roles | live group has a `vision` row with `ref: null`, `assigned: false`, and no `model`/`provider`/`thinkingLevel` keys |
| E2 | Row decomposition | EP | L1 | automated | `planning = "anthropic/claude-opus-4-8:high"` | GET /api/roles | row reports `ref` verbatim, `model: "anthropic/claude-opus-4-8"`, `provider: "anthropic"`, `thinkingLevel: "high"`, `assigned: true` |
| E3 | Legacy bare-id assignment | EP | L1 | automated | role assigned bare id `"deepseek-v4-flash"` (no `/`) | GET /api/roles | row omits `provider`, `model` equals stored value, `ref` verbatim, config unmodified |
| E4 | Ref split on last colon | BVA | L1 | automated | ref `"a/b:high:low"` | GET /api/roles | `thinkingLevel: "low"`, `model: "a/b:high"`, `ref` verbatim |
| E5 | Degenerate refs | BVA | L1 | automated | refs `"a/b:"`, `":high"`, `"anthropic/"`, `"a/b"` | GET /api/roles | status 200; `ref` verbatim each; undeterminable parts omitted, never emitted empty; no throw |
| E6 | Removal marker beats assignment | decision-table | L1 | automated | `removedRoles: ["vision"]` AND `roles.vision = "x/y"` | GET /api/roles | `vision` absent from every group; config unmodified |
| E7 | Preset-only role name | EP | L1 | automated | preset references `review`; live config does not | GET /api/roles | `review` present in every group; live group reports `ref: null` |
| E8 | Axis + group ordering | state | L1 | automated | config with defaults, one user-added role, one preset-only role, two presets | GET /api/roles twice | defaults precede user-added precede preset-only; `data[0]` is the live group, then presets in stored order; both responses identical |
| E9 | Built-in classification | decision-table | L1 | automated | config with a user-added role alongside built-ins | GET /api/roles | every canonical default name reports `builtin: true`; the user-added row reports `builtin: false` |
| E10 | New built-in propagates | EP | L1 | automated | a name is added to the canonical default set | GET /api/roles | that role appears in every group, `builtin: true`, `ref: null`, with no consumer-side constant changed |
| E11 | Duplicate preset names | decision-table | L1 | automated | two stored presets share a name, differing assignments | GET /api/roles | exactly one group for that name, carrying the FIRST entry's assignments; exactly one group in `data` has `active: true` |
| E12 | Dangling activePreset | state-transition | L1 | automated | `activePreset: "ghost"` matching no stored preset | GET /api/roles | live group reports `active: true`; no preset group does; exactly one active; config unmodified |
| E13 | No presets stored | BVA (min) | L1 | automated | `rolePresets: []` | GET /api/roles | `data` has exactly one element, `preset: null`, `active: true` |
| E14 | Active preset flagged | state-transition | L1 | automated | `activePreset: "cheap"`, presets `cheap` + `max` | GET /api/roles | `cheap` group `active: true`; no other group active |
| E15 | Normalizer totality | EP | L1 | automated | `rolePresets: [null]`, `[{name:"x",roles:null}]`, `roles:{a: 42}`, `roles:{b: "  "}` | parseRoleConfig / GET /api/roles | invalid entries discarded, well-formed retained, status 200, no throw |
| E16 | Read-only | state | L1 | automated | config with assignments + presets | GET /api/roles three times | config byte-identical before/after; all three responses identical |
| E17 | Fresh install | BVA (min) | L1 | automated | no config file on disk | GET /api/roles | 200; live group holds one row per canonical default, all `ref: null`; file NOT created |

### Performance

None. Per the resolved clarification, this change carries **no latency budget**:
the read is a single small file, caching is explicitly deferred in `design.md`,
and inventing a threshold would fabricate a requirement the spec does not make.
Revisit if a polling consumer is observed in practice.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Cross-surface agreement | state-convergence | L1 | automated | one config with assignments, a user-added role, and a removal marker | project it through both the `roles:get-all` path and the HTTP projection | both report the same effective role-name schema and the same assigned value per role; neither reports a removed name |
| F2 | Payload regression after extraction | state-convergence | L1 | automated | configs with well-formed presets and no removal/assignment collision | run `roles:get-all` before and after the helper move | payload identical; the two declared corrections are the only permitted diffs |
| F3 | Consuming frontend renders the matrix | visual/subjective | — | manual-only | the second frontend pointed at `/api/roles` | a human views the rendered role table | [judgment: unassigned roles read as empty slots rather than errors, and built-in vs custom is visually distinguishable — no automatable observable, and the consumer lives outside this repo] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Always answerable | fault-injection | L1 | automated | config file unparseable JSON | GET /api/roles | 200; live group reports every canonical default with `ref: null` |
| X2 | Always answerable | fault-injection | L1 | automated | read fails with permission denied | GET /api/roles | 200; built-ins unassigned; no unhandled error escapes |
| X3 | Always answerable | fault-injection | L1 | automated | config path resolves to a directory | GET /api/roles | 200; built-ins unassigned; no unhandled error |
| X4 | Always answerable | fault-injection (TOCTOU) | L1 | automated | file removed between existence check and read | GET /api/roles | 200; built-ins unassigned; no unhandled error |
| X5 | No credential material | fault-injection | L1 | automated | a recognisable secret planted in a non-role sibling key of the same file | GET /api/roles | that secret string absent from the fully serialized response body |
| X6 | Endpoint absent when plugin unloaded | state-transition | L1 | automated | roles plugin server entry not mounted | GET /api/roles | 404; no role data served from any other path |
| X7 | Auth gate applies | fault-injection | L1 | automated | request without dashboard authentication | GET /api/roles | same auth-gate rejection `/api/models` produces for the identical unauthenticated request (asserted by comparison, not a hardcoded status) |
| X8 | Endpoint reachable with no pi session | fault-injection | L2 | automated | dashboard server running, zero pi sessions connected | GET /api/roles over HTTP | 200 with a non-empty `data` array — the core motivation, proven at process level |

---

## Coverage summary

- Requirements covered: 9/9 (7 in `agent-role-introspection`, 2 modified in `dashboard-roles-ownership`)
- Scenarios by class: edge 18 · perf 0 · frontend 3 · error 8
- Scenarios by level: L1 27 · L2 1 · L3 0 · manual-only 1
- Scenarios by disposition: automated 28 · manual-only 1

Note: `E18` (pure `effectiveRoleNames`) and `E8` (route-level axis + group
ordering) are deliberately separate rows. They exercise the same ordering rule
at two different levels — the helper in isolation, and the assembled response —
so each folds to its own task rather than one row being claimed twice.

No L3 rows: this change adds no rendered UI. Routing an HTTP-endpoint assertion
into a Playwright spec would violate the level boundary in the opposite
direction — the browser tier exists for rendered-UI behaviour, not REST checks.

## New infra needed

None. Both harnesses already exist:

- **L1** — `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts` is the
  direct exemplar for testing a plugin-mounted Fastify route in-process.
  `packages/shared/src/__tests__/` is the exemplar for the pure-helper tests.
  A new `packages/roles-plugin/src/server/__tests__/` directory is needed, but
  no new harness.
- **L2** — `qa/tests/` already contains endpoint-probing smoke tests
  (`24-gateway-where.sh`, `21-gateway-rendezvous.sh`) to copy glue from.
