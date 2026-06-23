# Test Plan — parallelize-test-harness

Stage: apply (soft gate)   Generated: 2026-06-23
Produced by the `scenario-design` skill from proposal.md + design.md + specs/.

## ✅ Clarifications resolved (3)

Gate re-run after design.md update — all triples now fillable.

- [x] **C1** → resolved in D1: scan is **window-bounded with wrap** (`find_free_in_window`, cap = 1000 = window size). Dashboard scan stays in `[18000..18999]`, gateway in `[19000..19999]` — provably disjoint, no bleed. (Closed the latent collision bug.)
- [x] **C2** → resolved in D1: port vars honoured **as a pair**. Both set = verbatim; neither = derive; exactly one = `exit 1`.
- [x] **C3** → resolved in D2/D3: project name is a pure function of `HOST_CWD`, so `test-down.sh` re-derives it from `${PWD}`; corrupt state file = warn + continue, never blocks.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | input | trigger | expected observable |
|----|-------------|-----------|-------|-------|---------|---------------------|
| E1 | D1 port window | BVA | L1 | HOST_CWD with `cksum%1000 == 0`; and one with `== 999` | derive base_dash | base_dash `== 18000` (min) / `== 18999` (max); base_gw `== 19000` / `19999` |
| E2 | D1 determinism | EP | L1 | same HOST_CWD string twice | run derivation twice | identical HASH → identical base_dash/base_gw both runs |
| E3 | D2 unique project | EP | L1 | HOST_CWD `/wt/a` vs `/wt/b` (distinct cksum) | derive COMPOSE_PROJECT_NAME | two distinct strings, each matching `^pi-dash-test-[0-9]+$` (compose-legal) |
| E4 | D1 override vs derive | decision-table | L1 | {both set} / {neither} / {only DASHBOARD_PORT} | resolve ports | both → verbatim, no probe; neither → both derived+probed; exactly one → `exit 1` ("export both or neither") |
| E5 | D4 de-hardcode | config-render | L1 | `DASHBOARD_PORT=18042` exported | `docker compose -f compose.yml -f compose.test.yml config` | rendered publishes `18042:18042` AND container env `DASHBOARD_PORT=18042` (published == listen) |
| E6 | D1 cross-OS hash | EP | L1 | same HOST_CWD on macOS + Linux | `cksum` derivation | identical HASH (POSIX cksum CRC) → identical ports both OSes |

### Performance

| id | requirement | technique | level | workload | metric + threshold | window |
|----|-------------|-----------|-------|----------|--------------------|--------|
| P1 | D2/D3 no resource leak | soak | L2 | 10× `test-up.sh`→`test-down.sh` cycles, same worktree | Δ(`docker network ls`)==0 AND Δ(`docker volume ls`)==0 AND no `.pi-test-harness.json` left | 10 cycles |

### Frontend-quirk (e2e / config convergence)

| id | requirement | technique | level | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------|---------|---------------------------------|
| F1 | D5 parallel e2e | state-convergence | L3 | two worktrees each `npm run test:e2e` (managed) | both global-setups probe+boot | each picks a distinct free port; both `/api/health` converge to 200 on their own port; no `EADDRINUSE` |
| F2 | D5 baseURL sync | invariant | L3 | managed run, probed port N | Playwright resolves `use.baseURL` | `baseURL` host port `== N ==` container published port (never probes wrong port) |
| F3 | D5 USE_RUNNING attach | state-transition | L3 | hand-started instance on N; `PW_E2E_PORT=N` | `PW_E2E_USE_RUNNING=1` global-setup | health verified at `:N` within 30s; no `test-up` spawned; no teardown on exit |

### Error-handling

| id | requirement | technique | level | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------|---------|---------------------|
| X1 | D1 probe (TOCTOU) | fault-injection | L1 | external listener holds base_dash | `find_free_port(base_dash)` | returns first free port `> base_dash`; subsequent `up` binds it |
| X2 | D1 scan cap | fault-injection (BVA) | L1 | all 1000 ports in the dashboard window busy | scan visits each once (cap 1000) | `exit 1`, message names exhausted window + change name |
| X3 | D1 window ceiling | fault-injection | L1 | dashboard ports busy from base up to 18999 | `find_free_in_window` wraps `18999`→`18000` | returns a free port still within `[18000..18999]`; never probes ≥ 19000 (gateway window untouched) |
| X4 | D3 stale state file | state-transition (illegal) | L2 | `.pi-test-harness.json` present, project NOT running | `test-up.sh` re-run | detects no live project → re-derives → fresh `up` (no blind port reuse) |
| X5 | D3 corrupt state | fault-injection | L2 | `.pi-test-harness.json` malformed | `test-down.sh` run from worktree | re-derives project from `${PWD}`, warns, `down -p` succeeds, file removed (never blocks) |
| X6 | D1 override busy | fault-injection | L2 | user exports `DASHBOARD_PORT=9999` (host dashboard owns it) | `test-up.sh` uses verbatim → `up` | `compose up` fails with a clear bind error; no silent fallback (fail-loud) |
| X7 | spec: selective teardown | state-transition | L2 | two live worktree instances | `test-down.sh` from worktree A | only A's `-p` stack down + A's state file removed; B stays up + reachable |

---

## Coverage summary

- Requirements / scenarios covered: 7 spec scenarios + D1–D5 mechanisms → 17 test scenarios
- Scenarios by class: edge 6 · perf 1 · frontend 3 · error 7
- Scenarios by level: L1 8 · L2 5 · L3 3 · (1 marked, partial)
- Blocked by clarification: none — C1–C3 resolved in design.md (gate re-run clean)

## New infra needed

none — L1 = vitest in `docker/__tests__/` (pure derivation, skip-if-no-docker for E5); L2 = process runs via existing `docker/test-up.sh`/`test-down.sh` harness; L3 = existing Playwright suite (`tests/e2e/`).
