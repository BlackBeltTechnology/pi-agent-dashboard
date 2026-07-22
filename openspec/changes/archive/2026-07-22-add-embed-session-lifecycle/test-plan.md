# Test Plan — add-embed-session-lifecycle

Stage: design   Generated: 2026-07-21

Nearly all logic is a pure server-side predicate/registry, so the dominant level is L1
(vitest, injected session state + fake deps). One L2 perf/soak row verifies the reclamation
goal (the 6.7 GiB / 35-process regression). No `manual-only` rows — every observable is
automatable. Thresholds (idle timeout, hard ceiling, grace window, acquire register timeout,
caps) are **test-configured inputs**, not spec-pinned defaults, so no scenario is blocked.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Provenance marker | decision-table | L1 | automated | `durable`/absent/`ephemeral` session, feature enabled, idle > timeout | reaper sweep | `durable`+absent NOT reaped/counted; `ephemeral` reaped |
| E2 | Provenance marker | equivalence | L1 | automated | session with no `lifecyclePolicy` field | load | treated as `durable` |
| E3 | Provenance marker (persistence) | state-transition | L1 | automated | `ephemeral` session persisted to `.meta.json` | server restart + `session-scanner` rehydrate | restored as `ephemeral` (not `durable`), reap-eligible |
| E4 | Producer opt-in | equivalence | L1 | automated | spawn via embed acquire path / automation trigger | spawn | session carries `lifecyclePolicy:"ephemeral"` |
| E5 | Producer opt-in | equivalence | L1 | automated | human spawn from dashboard UI / TUI | spawn | session is `durable`, not governed by reaper/caps |
| E6 | Acquire reuse | state | L1 | automated | live session exists for visitor/cwd | reopen/refresh acquire | returns existing session, no new `pi` (#383a) |
| E7 | Acquire reuse | state | L1 | automated | no localStorage hint, live server session exists | acquire | reuses server session, no new spawn |
| E8 | Acquire convergence | decision-table | L1 | automated | no live session | two concurrent acquires, same key | exactly one spawn; both resolve to it (#383b) |
| E9 | Acquire register-window | state-transition | L1 | automated | first acquire spawning, pre-`session_register` | second acquire same key | joins in-flight result; no second `pi` |
| E10 | Acquire resume renumber | state-transition | L1 | automated | key's most recent session runtime-reaped | acquire | resumes (fresh sessionId); key re-points to new id |
| E11 | Canonical cwd | equivalence | L1 | automated | same physical dir via symlink / worktree / case-variant | two acquires, same visitor | one `identityKey`, one session (#383b) |
| E12 | Reaping (idle) | BVA | L1 | automated | `ephemeral` fully quiescent, `lastActivityAt` age = timeout+1 | reaper sweep | reaped via graceful kill path |
| E13 | Reaping (history) | state | L1 | automated | quiescent session reaped, then acquired again | resume | full prior conversation reconstructed from session file (#383f) |
| E14 | Reaping (cold-start seed) | state-transition | L1 | automated | rehydrated quiescent `ephemeral`, no captured `lastSettledAt` | reaper sweep after restart | last-settled seeded from session-file mtime → evaluable, reaped |
| E15 | Phantom | decision-table | L1 | automated | `streaming`, no settle past hard ceiling, no child, ~0 CPU, no watcher, no ask, empty queues | reaper sweep | force-reaped, reason `"phantom"`, distinct from idle reason |
| E16 | Phantom ladder | state | L1 | automated | phantom-eligible session | phantom reap | uses SIGTERM→grace→SIGKILL ladder (not bare SIGKILL); session resumable after |
| E17 | Caps reclaim | BVA | L1 | automated | at per-visitor/global cap, ≥1 quiescent candidate | acquire | oldest quiescent reaped, acquire succeeds (#383e) |
| E18 | Caps scope | decision-table | L1 | automated | mix of `ephemeral` + `durable` at cap boundary | acquire | only `ephemeral` counted; `durable` never counted/reclaimed |
| E19 | Caps global bound | equivalence | L1 | automated | one actor mints N distinct `visitorId`s | N acquires | total bounded by GLOBAL cap (per-visitor cap not a bound) |
| E20 | Observability counters | state | L1 | automated | acquire reuse vs spawn; reap by each reason; capacity reject | each path fires | matching counter increments (reuse hit/miss, reaped-by-reason, rejects) |
| E21 | Observability endpoint | state | L1 | automated | active + idle + reaped-by-reason state | GET `/api/health` (or JWT diagnostics) | reports active/idle counts + reaped-by-reason breakdown (#383h) |
| E22 | Off by default | equivalence | L1 | automated | feature disabled (default), no `ephemeral` spawns | run | no reap/cap/reuse; spawn behavior unchanged (#383 upgrade safety) |
| E23 | Version-floor safe | equivalence | L1 | automated | floor-pi synthesized settle vs native `agent_settled` | quiescence gate eval | both satisfy the gate identically (no `piVersion` branch) |

### Frontend-quirk (state-convergence — asserted server-side, no rendered-UI assert)

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Graceful mid-turn stop | state-transition | L1 | automated | `ephemeral` streaming, empty queues, no watcher, past timeout | reaper sweep | sends `stop_after_turn`; session ends only after `turn_end`; resumable file |
| F2 | Graceful mid-turn stop (queue guard) | state-transition | L1 | automated | `ephemeral` streaming, non-empty `followUp`, no watcher, past timeout | reaper sweep | NOT stopped; queued work drains first |
| F3 | Disconnect ≠ reclaim | state-transition | L1 | automated | sole subscriber on a busy (streaming / live-child) session | subscriber disconnects | session stays alive; reap-eligible only after full quiescence + timeout (#383g) |

### Error-handling (fault injection)

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Acquire allowlist | fault-injection | L1 | automated | cwd outside server-side allowlist | acquire | rejected; no session spawned |
| X2 | Acquire register-timeout | fault-injection (abort) | L1 | automated | spawn/resume never emits `session_register` | acquire + timeout elapses | coalesced result rejects; in-flight entry cleared; waiters do not hang |
| X3 | Caps exhausted | fault-injection | L1 | automated | at cap, every `ephemeral` candidate busy | acquire | structured capacity error; no active session terminated (#383e) |
| X4 | Reaping vetoes | decision-table | L1 | automated | flip ONE busy signal true (generation / `currentTool` / pending ask / `followUp` / terminal-in-cwd / live child / active watcher / within grace window) | reaper sweep | session NOT reaped for each single-signal case (#383d) |
| X5 | Phantom ask-guard | fault-injection | L1 | automated | `streaming` past ceiling, ~0 CPU, no child, no watcher, BUT unanswered `ask_user` (or non-empty queue) | reaper sweep | NOT force-reaped |

### Performance / soak

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Reaping (reclamation goal) | soak + threshold | L2 | automated | spawn N `ephemeral` sessions, leave all quiescent past idle timeout | aggregate `pi` process count → 0 and aggregate RSS drops below a floor after the sweep | one sweep interval + grace |

---

## Coverage summary

- Requirements covered: 10/10
- Scenarios by class: edge 23 · perf 1 · frontend 3 · error 5
- Scenarios by level: L1 31 · L2 1 · L3 0
- Scenarios by disposition: automated 32 · manual-only 0

## New infra needed

- **P1 (L2 soak)** needs a small resource-measurement helper (count `pi` PIDs + sum RSS for
  the service cgroup/process group before vs after a reaper sweep). `qa/tests/*.sh` is the
  home; check for an existing process-count assertion to extend before adding one. No new
  level/harness — extends the existing L2 smoke tier.
- All other rows land in the existing L1 vitest tier (`packages/server/src/**/__tests__/`) —
  no new harness.
