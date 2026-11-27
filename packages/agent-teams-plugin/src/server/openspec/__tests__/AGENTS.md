# DOX — packages/agent-teams-plugin/src/server/openspec/__tests__

Files in this directory. One row per source file.

Real runtime over the fake host + `FakeClock`; fixtures below. All rows: See change: add-agent-teams-openspec.

| File | Purpose |
|------|---------|
| `apply-env.ts` | Helper. `createApplyEnv(over)`: OpenSpec env + change dir with real `tasks.md` + in-process stand-in for dashboard routes running the REAL parser/writer (`openspec-tasks.ts`), per-call `Fault` hook, call log, skill resolver. `wideTasks(n, sections)`, `ok()`, `TEMPLATES_DIR`. |
| `apply-template.test.ts` | Shipped `openspec-apply` template (5.1): loads through bundled rules + core parser, reviewer cannot write, lead playbook carries commit rule, member prompts == `buildApplyBriefing`. |
| `briefing.test.ts` | Group teammate briefing (3.9) + rendering audit (9.29 #X21, 9.30 #S1, 9.31 #S8): real builders, shipped lead playbooks, lead notices carry codes/ids/routes never task text. |
| `coexistence.test.ts` | ship-batch lock rules → `batch_runner_active` through real group preflight (3.5, 3.15; 8.21 #E24); parity matrix with the skill's `lockDecision` when present; `change_in_use` from sidecars (8.22 #R9). |
| `config.test.ts` | Seven `openspec*` keys (7.9–7.12 #E4 #E5 #E27 #E30): integers only, clamps + one log line, `invalid_config`, lock TTL clamp. |
| `env.ts` | Helper. `createOpenspecEnv(over)`: full start env over temp dirs, fixture templates, module handle `api`, fake-kind + bundled-profile team helpers. `APPLY`, `GROUP`, `tmp`, `fixtureTemplate`, `tasksOf`. |
| `events.test.ts` | Mail/notice delivery as a model sees it (8.26 #R10, 8.27 #R11): policy reading ALL mail since last reply, lead notices once, wake at most once per `notify.coalesceMs`. |
| `gate.test.ts` | `not_shipped` gate (3.10, 8.15–8.20; #X6–#X10 #P7): exact archive dir, remote fetch path, fail closed, scope limited to launcher-owned completions. |
| `git-env.ts` | Helper. Real-git fixtures: isolated git config, `makeRepo`, `realGitInject` (executes the three git routes with real git), `scriptedInject`, `initRepoAt`, `GroupFixture`. |
| `groups.test.ts` | `groups.json` resolution + membership (3.2; 7.13–7.16 #E9–#E12): id then name, order, archived skipped, typed codes. |
| `hints.test.ts` | `after:` hints (7.32–7.34 #E18 #E19 #E21): grammar, placement, target validity, first wins, linear scan, parsers unaffected. |
| `inject.test.ts` | Loopback inject vs REAL route guards (3.3/5.5; 8.28 #S10): `requireLocalProof` off ⇒ all pass; on ⇒ credential-less READ passes, WRITES refused `local_proof_required`; live `host.localRequest` end to end. |
| `inputs.test.ts` | Untrusted repo inputs (7.36 #S3): names re-validated, real dirs only, regular files ≤1 MiB, no symlink/FIFO, no YAML aliases. |
| `launcher-env.ts` | Helper. `createGroupEnv(over)`: OpenSpec env + SEEDED `openspec-group` team (real `seedCore`), recording fakes for the group-api seam, no-op host spawn starter, complete/add-member helpers. |
| `launcher.test.ts` | Group launcher (3.7, 3.8, 3.11, 3.12, 3.14, 3.16; #E23 #X5 #X14 #R2–#R4 #D3 #D4 #P1 #P2): derived slots, serial lazy launches, owner with reservation, core refusals, restart safety, bounded launches; perf rows assert COUNTS. |
| `lifecycle.test.ts` | Hygiene (9.33 #D13, 9.34 #P6): after 200 launch/complete/lock cycles + team close no timer/listener/queue; sidecar bounded + pruned. |
| `live-guarded-app.ts` | Helper. `listenGuardedApp(strict, register)`: REAL listening Fastify with the server's guard stack in `server.ts` order (credential edge stamp, host gate, network guard, tier gate) + the server's real `host.localRequest`. `LIVE_TOKEN`. Loaded by absolute path via `server-src.ts`. |
| `lock.test.ts` | `ResourceLock` (4.1–4.6; 7.11, 9.7–9.16): limits, acquire, errors, dead-waiter handoff, FIFO, settled-idle release, restart, mail spoofing, fairness, sidecar faults, timer hygiene. |
| `logs.test.ts` | Structured logs/counters (9.32 #S12): ids/codes only, no task text, credentials redacted, one counter per event. |
| `names.test.ts` | `memberNameFor` (3.6, 7.35 #E6): ≤32 chars, 22-char prefix + hash, valid core name, stable, collision-resistant. |
| `preflight-group.test.ts` | Shared preflight with the REAL group kind (7.3 #E3, 7.4 #E25, 7.5 #X1, 7.7 #X3, 7.14): real `groups.json`, git repos, lock files. |
| `preflight.test.ts` | Shared preflight with fake kinds (7.1–7.8; #E1–#E3 #X1–#X3 #S14): goal rules, fixed precedence, nothing created on refusal, strict trust, skills, preflight→seed snapshot. |
| `profiles.test.ts` | Profile registry + bundled source (9.22–9.27, 1.10; #E29 #X12 #X20 #D12 #S5 #S6): listed + shadowable, profile only for `bundled`, missing seams fail the start, isolated listeners, teammate-only `ResourceLock`. |
| `reviewer.test.ts` | Reviewer dispatch rule (7.31 #E22, 5.7): reviewer off every task it does not own across the state grid; `Review` owner set when `reviewer` joins. |
| `routes.test.ts` | `POST …/openspec-relaunch` (3.13, 3.16, 8.23–8.25; #X15 #R5 #S9): clears `launch_failed`/lost record, else `not_relaunchable`; owner rule, tier `operate`, idempotent; row in `ROUTE_TIERS`. |
| `seams.test.ts` | Core seam checks without core edits (2.1–2.4): gates → commit → event order, second op gate + dispatch skip, per-member committer, server-actor shutdown. |
| `seed-apply.test.ts` | Apply seed + preflight (7.27–7.30 #E14–#E16 #E20; 7.3, 7.5, 7.7): granularity, ticked boxes, barriers + hints, `Review`, refs, every start code leaves nothing behind. |
| `seed-core.test.ts` | Seed engine (7.19–7.26; #E8 #E17 #X13 #R1 #D1 #D2 #S2 #P3): topological creation, code-point caps, once-only `seeding`/`seeded`, call budget. |
| `seed-group.test.ts` | Group kind with REAL stage checks + plan (3.4, 3.5; 7.15 #E11, 7.17 #E7, 7.18 #E13, 7.35): dependency mapping, skip propagation, 50-task cap, seeded sidecar. |
| `server-src.ts` | Helper. `loadServer<T>(rel)` imports dashboard server modules by absolute path at run time (keeps this package's `tsc` program small); `serverTasks` = real `openspec-tasks` parser/writer. |
| `sidecar.test.ts` | Sidecar store (9.17–9.21; #X18 #R14 #D6 #D7 #D11): fail-closed writes, shared file, atomic replace + schema, prune after hydration, format stability. |
| `sync.test.ts` | Checkbox sync (9.1–9.6 #X11 #R7 #R8 #D9 #D10 #P4; 5.5): toggle faults + backoff, serial queue, team close, restart recovery, id+hash matching, 48-completion burst, REAL guard + tier gate. |
| `template-group.test.ts` | Shipped `openspec-group` template (3.1): parses, acceptable bundled, listed `bundled` from package dir, playbook carries group rules. |
| `worktree.test.ts` | `ensureWorktree` (3.3; 8.11 #X4, 8.12 #D5, 8.13 #S4, 8.14 #S13): every route fault → exact code, crash leftover reused/cleaned (real git), no untrusted value in argv, realpath check. |
