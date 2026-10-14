## 1. Schema

- [ ] 1.1 Write failing validator tests: `autoAdvance` unknown stage ids, empty targets, non-positive `maxSteps`, `noProgress` other than `stop`
- [ ] 1.2 Implement `autoAdvance` validation in the workflows-plugin validator

## 2. Run store

- [ ] 2.1 Write failing tests: persist before launch, atomic write, one active run per change, 30-day retention of terminal runs
- [ ] 2.2 Implement the run store (D4)

## 3. Reconciler

- [ ] 3.1 Write failing tests (fake clock + fake executors): target → done; stopAt → stopped; checkpoint → paused, approve resumes; no runnable action → stopped; unchanged stage → no progress; `maxSteps` → step limit
- [ ] 3.2 Implement the reconcile loop (D1) with fresh facts at decision points (D3)
- [ ] 3.3 Write failing tests for completion tracking per executor (prompt turn end, automation callback, goal terminal, flow completion) (D2)
- [ ] 3.4 Implement completion tracking
- [ ] 3.5 Write failing tests: pending question → `awaiting-input`, answered → `running`, no timeout
- [ ] 3.6 Implement question waiting via the question registry

## 4. Failure, restart, cancel

- [ ] 4.1 Write failing tests: session death with/without progress; boot with live session re-attaches; boot with dead session → `interrupted`; resume preserves step count
- [ ] 4.2 Implement death handling and boot reconcile (D5)
- [ ] 4.3 Write failing tests: cancel with and without session abort
- [ ] 4.4 Implement cancel

## 5. UI + REST

- [ ] 5.1 Add run routes to `route-tiers.ts`; failing route tests (start refused when untrusted or active; approve/resume/cancel state guards)
- [ ] 5.2 Implement routes; document in `api-reference.md`
- [ ] 5.3 Client: Run-to control with confirmation, run status on the change row, Approve / Resume / Cancel, link to awaiting question
- [ ] 5.4 Log every transition with run id, change, stage, reason, step duration

## 6. Example + docs + verification

- [ ] 6.1 Add `autoAdvance` (targets `[planned, merged]`, checkpoints `[planned]`, stopAt `[blocked]`) to this repo's `.pi/workflows/openspec.yaml`
- [ ] 6.2 DocScribe: auto-advance section in `docs/project-workflows.md`; AGENTS.md rows
- [ ] 6.3 `Audit` subagent pass on unattended spawning and REST start
- [ ] 6.4 Full test run + build; manual run-to-planned on a throwaway change, including a server restart mid-step
