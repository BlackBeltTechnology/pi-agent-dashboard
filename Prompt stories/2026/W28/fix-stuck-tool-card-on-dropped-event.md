---
session: 019f533d
week: 2026/W28
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [instrument-event-store-trim, fix-stuck-tool-card-on-dropped-event, fix-stuck-tool-card-superseded-heal]
proposal_excerpt: "`fix-stuck-tool-card-on-dropped-event` instrumented the two transport **drop** hops (server→browser fanout back-pressure, bridge→server ring eviction) and surfaced them on `GET /api/health#droppedFrames`. But the thir…"
---

# How we did it: Close out the stuck-tool-card changes — coherence, an E2E, and an evidence-gated follow-up — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was tiny: *"Check the fix-stuck-tool-card-superseded-heal maybe some changes have to be made on proposal."* On the surface a one-file review. The **real** objective, once the four steering turns landed, was a full close-out of a two-change family that fixes a UI card that gets stuck "running" when a `tool_execution_end` WebSocket frame is dropped: (1) prove the base and superseded changes are *coherent* — that archiving one without the other won't leave `openspec/specs/` asserting the opposite of what the shipped code does; (2) write the base change's **deferred E2E** and make it pass against the real Docker harness in the system Chrome; (3) resolve the parked deferred follow-ups by **gathering runtime evidence** rather than guessing; and (4) commit only the work that was actually ours. The session was planning-heavy (5 OpenSpec artifacts) but ended with a green Playwright test and two clean commits.

## 2. TL;DR playbook

1. **Coherence sweep first.** `openspec validate <base> --strict` and `<follow-up> --strict`, then read both deltas and ask: *does archiving one alone make the main spec lie?* Here it did — the base's `Scenario: Evicted result cannot reconcile` says "leave the row running" while the superseded change's shipped code heals it.
2. **Fix coherence in prose, never in the spec delta.** Add a `## Follow-up` + archive-order guard to the base's `proposal.md`/`design.md`; leave the `spec.md` delta verbatim so the follow-up's `MODIFIED` requirement still matches.
3. **Write the deferred E2E as a diff of an existing one.** The base's recoverable path = the superseded test **minus** the `page.route(...404)` override. Reuse the same faux fixture (`stuck-tool-superseded`), drop the WS `tool_execution_end` frame, leave the reconcile route live → real server returns HTTP 200 → card heals.
4. **Run it against the real harness, not chromium.** `PW_CHANNEL=chrome npx playwright test reconcile-heal --reporter=list`. Expect obstacles (see §7).
5. **Pre-build the per-worktree image** so `up` doesn't blow globalSetup's 180s health timeout: derive the tag, `docker build` it explicitly, then re-run.
6. **Auto-dismiss the async first-launch modal** via `page.addLocatorHandler('first-launch-display-backdrop', …)` in the shared `gotoDashboard` chokepoint — not a one-shot check.
7. **Answer deferred follow-ups with telemetry, not opinion.** Grep the live `~/.pi/dashboard/server.log` and `GET /api/health` counters. If a gate is *unmeasurable* (silent code path), scaffold the instrumentation change instead of the feature.
8. **Commit only your work.** `git checkout -- openspec/groups/groups.json` when its diff is other people's reconciliation; leave stray files untracked; split into logical `test(e2e)` + `docs(openspec)` commits.

## 3. How the collaboration unfolded

**Phase 1 — Coherence review (Discovery).** The AI validated both changes `--strict`, found both implementation-complete, then surfaced the real hazard: the base change is archivable alone, but doing so would make `openspec/specs/` assert "leave the row running" while the live supersede-heal code finalizes it. *Why it worked:* it treated "check the proposal" as "check the **relationship** between the two changes," which is where the actual risk lived. **Decision point:** fix it as prose guards in the base change, spec deltas untouched — the human implicitly ratified by moving on to E2E.

**Phase 2 — Feasibility + write the E2E (Design → Generate).** Prompted with *"Is it possible to add e2e tests for that?"* the AI reframed the base scenario as the superseded test *minus the 404* and wrote `reconcile-heal.spec.ts` reusing the existing fixture. *Why it worked:* deriving the new test as a one-line delta of a known-green test made the assertions trustworthy before ever running Docker.

**Phase 3 — Make it actually pass (Verify).** *"yes with docker test and with playwright in the system browser."* Three real obstacles fell in sequence (per-worktree image tag missing → inline build → 180s timeout; stale container with empty fixture mount; async first-launch modal intercepting clicks). Each was diagnosed from logs/container introspection, not guessed. **Decision point:** rather than a 6-min rebuild, the AI proved the per-worktree image already had the reconcile code and the fixture was bind-mounted — so a teardown + fast `up` sufficed.

**Phase 4 — Evidence-gated follow-up (Research → Generate).** *"There is deferred follow-up."* The AI enumerated two parked follow-ups (client contiguous-cursor resync; server never-evict backstop), then gathered runtime evidence: health drop counters = 0, and — crucially — admitted the earlier "24 reconcile / 2 superseded" grep hits were **noise** (worktree-name and plugin-bridge lines). Gate A measured ~0 (not justified); Gate B was **unmeasurable** because `trimBufferToLimit`/`evictIfNeeded` are silent. So it scaffolded `instrument-event-store-trim` — the telemetry prerequisite — instead of building either backstop.

**Phase 5 — Commit hygiene.** *"commit."* The AI reverted an unrelated `groups.json` churn (other people's reconciliation), left stray `b05_*.txt` untracked, and split the work into two logical commits, then stopped and asked before pushing.

## 4. Prompts that worked

- **The goal prompt** — *"Check the fix-stuck-tool-card-superseded-heal maybe some changes have to be made on proposal."* Weak on its own (scope-of-one file), but it worked because the AI widened it to the change *pair*. A stronger kickoff: *"Review coherence between fix-stuck-tool-card-superseded-heal and its base change — can either archive alone without the main spec contradicting shipped code?"*
- **High-leverage follow-up** — *"Is it possible to add e2e tests for that?"* Unlocked the whole verification phase from a deferred task.
- **The teeth** — *"yes with docker test and with playwright in the system browser."* One line that pinned the exact runtime (`PW_CHANNEL=chrome` + Docker harness) and forced a *real* pass instead of a static check.
- **The pivot** — *"There is deferred follow-up."* Three words that turned a finished task into an evidence-gathering research phase; the AI's own discipline (measure before building) did the rest.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat "check the proposal" as one-file scope | (implicit) expected the change-pair coherence view | Ask for coherence *between* related changes up front |
| Stop at static checks (validate + Biome) | "yes with docker test and with playwright in the system browser" | State the runtime bar (`PW_CHANNEL=chrome` + Docker harness) in the ask |
| Leave deferred follow-ups parked | "There is deferred follow-up" | Name the follow-ups and their gates as part of close-out |
| Trust its own grep counts | (AI self-corrected) — "the 24/2 were noise" | Treat log-grep counts as suspect until each match is eyeballed |
| Nearly commit an unrelated `groups.json` | "commit" (AI caught it) | Diff every incidental file before `git add`; revert non-authored churn |

## 6. Skills, tools & memory created — and why they're effective

The session ran `skill_manage` twice — patching the project's isolated-UI/E2E skill with the two non-obvious harness gotchas it hit:

- **Per-worktree image tag + build target.** The Docker harness builds `pi-dashboard:pi-dash-test-<hash>` (not `:local`) on derived ports; a missing tag makes `up` build inline and blow globalSetup's 180s health timeout. *Effective because* it removes a 4–6 min dead-end every future E2E author would otherwise re-discover: pre-build the exact tag first.
- **Async first-launch modal.** After `down -v` wipes seeded state, `first-launch-display-backdrop` renders a beat *after* WS display-prefs load, so a one-shot dismissal misses it — use `page.addLocatorHandler` in the shared `gotoDashboard` chokepoint. *Effective because* it makes every isolated spec robust to a fresh/wiped harness in one place.

The `gotoDashboard` auto-dismiss helper itself is the reusable artifact: one additive change fixed a class of flakiness (kb-folder-slot previously open-coded the same dismissal).

## 7. Pitfalls & dead ends

- **Inline build → 180s timeout.** If Playwright's globalSetup times out on health, the per-worktree image tag doesn't exist yet and `up` is building inline. Fix: derive the tag (`docker/lib-ports.sh`), `docker build` it explicitly, then re-run — `up` reuses it.
- **Stale container, empty fixture mount.** `qa/fixtures` is *bind-mounted* at runtime, not baked. A container started from the wrong CWD mounts an empty dir. Fix: `docker compose -p <proj> down -v`, re-`up` from repo root.
- **One-shot modal dismissal races the modal.** The first-launch backdrop appears asynchronously. A synchronous check in `gotoDashboard` runs too early. Use `addLocatorHandler` (register once per page).
- **Log-grep counts lie.** "24 reconcile / 2 superseded" were the worktree name `…superseded-heal` and `[plugin-bridge] Reconciled packages[]` — not real heals. Eyeball each match before trusting a count.
- **Silent code paths can't gate a decision.** `trimBufferToLimit`/`evictIfNeeded` log nothing, so "0 evict events" proves nothing. Scaffold the telemetry first; don't build the backstop on guesswork.
- **`groups.json` churn is usually not yours.** Its diff was other people's pending-change reconciliation swept in by an openspec command. `git checkout --` it.

## 8. Reproduce it faster — checklist

- [ ] `openspec validate <base> --strict` + `<follow-up> --strict`; read both deltas for archive-alone hazards.
- [ ] Fix coherence in `proposal.md`/`design.md` prose; **never** touch a `spec.md` delta that a `MODIFIED` requirement depends on.
- [ ] Write the deferred E2E as a one-line diff of the nearest green spec; reuse its faux fixture.
- [ ] Derive + pre-build the per-worktree image tag; then `PW_CHANNEL=chrome npx playwright test <spec> --reporter=list`.
- [ ] Add first-launch auto-dismiss via `addLocatorHandler` in `gotoDashboard` if the harness state is wiped.
- [ ] Gate deferred follow-ups on live telemetry (`GET /api/health`, `~/.pi/dashboard/server.log`); eyeball every grep match.
- [ ] If a gate is unmeasurable, scaffold the instrumentation change instead of the feature.
- [ ] `git checkout -- openspec/groups/groups.json`; leave stray files untracked; split `test(e2e)` + `docs(openspec)` commits; stop before pushing.

**Key inputs to have ready:** running dashboard (`:8000`, instrumented build), Docker, system Google Chrome, `docker/lib-ports.sh` for tag/port derivation.
**Artifacts produced:** `tests/e2e/reconcile-heal.spec.ts`, `tests/e2e/helpers/index.ts` (gotoDashboard dismissal), `openspec/changes/instrument-event-store-trim/{proposal,design,tasks,specs/…}.md`, edits to `fix-stuck-tool-card-on-dropped-event/{proposal,design,tasks}.md` — commits `56ea326c6`, `543548526` on `develop`.

---

_Generated from session `019f533d-7d0d-7bc8-890e-eebfdf14e215` · `pi-agent-dashboard` · 2026-07-12. Source extract: `/tmp/facts-16281-1784850088.md`._
