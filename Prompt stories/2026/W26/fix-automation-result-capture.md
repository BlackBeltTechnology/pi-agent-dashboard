---
session: 019ef222
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies)"
upgrade_status: pending
openspec_changes: [fix-automation-result-capture]
proposal_excerpt: "An automation run's `result.md` is supposed to hold the run session's **findings** — the assistant's output. The `automation-folder-format` \"Run/triage store\" requirement is built on this: \"A run that produces no find…"
---

# How we did it: Fix automation `result.md` capture — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation — `"/skill:openspec-apply-change fix-automation-result-capture"`. The real objective, surfaced by the attached OpenSpec proposal, was concrete: an automation run's `result.md` is supposed to hold the run session's *findings* (the assistant's actual reply), but it was coming back **empty** while sometimes leaking the injected prompt. The extractor in `packages/automation-plugin/src/server/index.ts` dropped array-of-blocks assistant content and mis-guarded the role check. The task was to **fix the capture, prove it live against a real model run, and land the change** through the full ship pipeline (archive → PR → CI → CodeRabbit → merge → cleanup).

## 2. TL;DR playbook

1. **Apply the OpenSpec change with TDD**: `"/skill:openspec-apply-change <name>"` — write the failing extractor test first, then implement the minimal fix. Keep it surgical (one function, one guard).
2. **Don't trust the wire-shape hypothesis in the proposal** — the design's assumed event anchor (`message_end`) was wrong. Plan to *verify it live*.
3. **Verify in the Docker test harness, not the live server**: `bash docker/test-up.sh` from the worktree builds the image from *this worktree's* `packages/` (build context `..` = repo root) and runs an isolated dashboard on port 18000 with tmpfs `~/.pi` — zero risk to live sessions.
4. **Pick a cheap, real model for the live run** — steer to `google/gemini-2.5-pro` (env var `GEMINI_API_KEY` → provider `google`), write `docker/.env` from the env var *without printing the value*.
5. **Trip the scheduler**: after creating a cron automation post-boot, the engine won't arm it (watcher ENOENT at boot). Spawn a throwaway session to trigger the engine's activity-rescan — do **not** restart (restart kills pid 1 and wipes tmpfs).
6. **Instrument `onEvent`** when capture silently drops output: log the real forwarded event sequence, rebuild, re-run. This revealed the true anchor is **`turn_end`**, not `message_end`.
7. **Fix, update tests to the verified shape, remove instrumentation**, re-run full suite + `tsc`, then correct the now-stale design note + docs row (docs via subagent per protocol).
8. **Ship**: archive + sync spec → PR against `develop` → monitor CI → triage flaky vs real failures → apply CodeRabbit feedback → merge (squash) → delete branch → remove worktree.

## 3. How the collaboration unfolded

**Discovery & TDD implementation.** The AI read the proposal/design, confirmed the root cause (array-of-blocks content dropped, lenient role guard leaked the prompt echo), and wrote `extract-assistant-text.test.ts` + `result-capture.test.ts` *first* (red), then implemented the minimal fix anchored on `message_end` with `role === "assistant"` plus a `concatText` helper. 9 unit tests green, full plugin suite + `tsc` clean. *Why it worked:* TDD kept the change surgical and the proposal gave a precise root-cause to test against.

**The isolation decision.** The AI noticed the live production server had 9 active sessions and refused to restart it against unmerged worktree code — a sound guardrail. When the user asked *"Is it possible to make tests in docker test?"*, the AI investigated `docker/test-up.sh`, confirmed the Dockerfile's build context is the repo root (`context: ..`), and realized the harness builds from the worktree's own source and runs fully isolated (port 18000, tmpfs `~/.pi`). This became the verification vehicle.

**The live run + the real bug.** The user steered *"Do not use anthropic, use google gemini pro"*. The AI wired `GEMINI_API_KEY` into `docker/.env` (without exposing the value), created a PONG automation with `google/gemini-2.5-pro` on a 1-minute cron, and hit two real infra quirks: (a) the engine armed 0 automations at boot because the automation didn't exist yet and the watcher hit ENOENT on `/home/pi/.pi/automation`; (b) restarting to re-arm killed pid 1 and wiped tmpfs. The AI found the correct lever — **spawn a throwaway session to trigger the engine's activity-rescan**, which armed the automation without a restart.

**The instrumentation breakthrough.** The first live run produced an *empty* `result.md` (prompt correctly excluded, but PONG also dropped). Rather than guess, the AI added temporary `onEvent` logging, rebuilt, re-ran, and read the real wire sequence: `message_start(content:[]) → message_update* → turn_end → agent_end`. **There is no assistant `message_end`** — only *user* messages emit it; the finalized assistant reply rides on **`turn_end`**. This contradicted the proposal's hypothesis. The AI re-anchored on `turn_end`, updated the tests to the verified shapes (including a `thinking`-block exclusion case from the real Gemini transcript), removed instrumentation, and the live run passed: `result.md == "PONG"`, prompt absent, status `done`.

**Ship pipeline.** With the user's 7-step directive, the AI archived + synced the delta into `automation-run-lifecycle/spec.md`, opened PR #150 against `develop`, triaged a CI failure (an unrelated flaky `SettingsPanel.test.tsx` `save-btn` `waitFor` timeout — its PR touched only automation-plugin/docs/openspec), re-ran to green, applied CodeRabbit feedback (Major prompt-delivery hardening + MD040 + edge-case tests), squash-merged (`8e14fe80`), deleted the branch, and removed the worktree.

## 4. Prompts that worked

- **The goal prompt** — `"/skill:openspec-apply-change fix-automation-result-capture"`. Effective because the OpenSpec change already carried the proposal, design, and tasks, so a single skill invocation loaded the full context. *Stronger version:* add up front "the design's event-anchor hypothesis is unverified — verify the live forwarded event shape before pinning it."
- **High-leverage steer** — `"Is it possible to make tests in docker test?"`. This one question redirected verification away from the risky live server toward the isolated harness and *caught a bug the unit tests missed*.
- **Model steer** — `"Do not use anthropic, use google gemini pro"`. Short, decisive; picks a cheap real model for the live loop.
- **The ship directive** — `"1. archive and sync 2. create pr 3. Monitor CI 4. fix coderabbit issues 5. merge pr 6. delete branch 7. delete worktree"`. A numbered checklist is an excellent way to hand off a multi-step pipeline; the AI worked it top-to-bottom with status per step.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust the proposal's `message_end` anchor hypothesis | (implicitly, via) "test in docker" → forced a live run that exposed the real `turn_end` shape | State "verify the live wire-event shape before pinning an anchor" in the task |
| Consider verifying against the live production server | "Is it possible to make tests in docker test?" | Default to `docker/test-up.sh` for any runtime verification touching a running dashboard |
| Reach for `anthropic` by default | "Do not use anthropic, use google gemini pro" | Specify the provider/model up front for automation live runs (`google/gemini-2.5-pro`) |
| Leave the ship steps implicit | An explicit numbered 7-step list | Hand multi-step pipelines as a numbered checklist |

Also worth internalizing: the AI's own good instincts — **refusing to restart the 9-session production server** and **not printing the API key** — are the guardrails to keep.

## 6. Skills, tools & memory created — and why they're effective

**Memory saved (project · insight):** the verified pi forwarded-event shapes, live-captured via `automation-plugin` `onEvent` against a Gemini run — an assistant turn forwards as `message_start(content:[])` → `message_update*(streaming)` → `turn_end` → `agent_end`, with the finalized assistant message on `turn_end` (not `message_end`, which only user messages emit).

- **What it captures:** the ground-truth wire protocol for forwarded assistant output.
- **Why it's effective:** it removes the single most expensive mistake in this session — assuming the event anchor. Any future capture/event work can read the anchor from memory instead of re-instrumenting a live run.
- **When to invoke it:** any time code consumes forwarded pi events (capture, result extraction, live triage) — search project memory for "forwarded event shapes" before writing a guard.

*Recommended skill to create:* a "verify automation live in the Docker harness" procedure — build from worktree, seed provider key into `docker/.env`, create the automation, **spawn a throwaway session to arm the scheduler (never restart)**, poll runs, fetch `result.md`. This session did it ad-hoc; it is clearly repeatable.

## 7. Pitfalls & dead ends

- **The engine armed 0 automations after post-boot creation.** The watcher hits ENOENT on `/home/pi/.pi/automation` at boot; creating a cron automation afterward doesn't re-scan. → **Spawn a throwaway session** to trigger the engine's activity-rescan (re-scans scopes + re-attaches watcher).
- **Restart to re-arm wiped everything.** The in-container `/api/restart` killed pid 1 → container exited → tmpfs `~/.pi` gone → automation lost. → Never restart the harness to re-arm; use the session-spawn rescan.
- **Container recreate wipes tmpfs.** Any `docker compose` recreate loses the in-memory automation; recreate the automation after bringing the container back.
- **The host `/api/restart` is guarded (403).** Restart must originate from true localhost inside the container — but see above, don't restart anyway.
- **Empty `result.md` looked like a capture bug in the new code** — it was the *wrong event anchor*. → When capture silently drops output, instrument `onEvent` and read the real sequence before editing the extractor again.
- **CI red on first push was a red herring** — a flaky `SettingsPanel.test.tsx` `save-btn` `waitFor` timeout, unrelated to an automation-plugin/docs/openspec PR. → Confirm the failing file is outside your diff, then re-run the job.
- **Docs row went stale** after the anchor changed from `message_end` to `turn_end`. → After a design hypothesis is corrected, fix `tasks.md` + `design.md` directly and delegate the `docs/` row to a subagent per the Documentation Update Protocol.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; `GEMINI_API_KEY` in your environment; Docker running with ports 18000/18999 free.

1. `/skill:openspec-apply-change <name>` — TDD the extractor fix (red → minimal green), keep it surgical.
2. Treat any proposal event-shape hypothesis as *unverified*.
3. From the worktree: `bash docker/test-up.sh` (isolated dashboard on :18000, tmpfs `~/.pi`).
4. Write `docker/.env` with `GEMINI_API_KEY` from the env var (don't print it); confirm it's gitignored.
5. Create a cron automation with `google/gemini-2.5-pro`; **spawn a throwaway session** to arm it (never restart).
6. Poll runs → fetch `result.md`. If empty/wrong, **instrument `onEvent`**, rebuild, read the real event sequence, re-anchor.
7. Update tests to the verified shape, remove instrumentation, run full suite + `tsc`.
8. Correct stale design/tasks/docs (docs row via subagent). Save the verified event shapes to project memory.
9. Ship: archive+sync → PR vs `develop` → CI (triage flaky vs real) → CodeRabbit fixes → squash-merge → delete branch → remove worktree.

**Artifacts produced:** `packages/automation-plugin/src/__tests__/extract-assistant-text.test.ts`, `.../result-capture.test.ts`, fixed `packages/automation-plugin/src/server/index.ts`, updated `design.md`/`tasks.md`, synced `openspec/specs/automation-run-lifecycle/spec.md`, archived change `openspec/changes/archive/2026-06-23-fix-automation-result-capture/`, merged PR #150 (`8e14fe80`).

---

_Generated from session `019ef222-b58d-7032-a249-98d95ca80688` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-23. Source extract: `session_facts` sheet._
