---
session: 019e8486
week: 2026/W23
type: other
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
---

# How we did it: Point pi-hermes-memory's background review at Gemma 4 31B — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a health check — *"Is pi-hermes-memory works correctly?"* — but
the real objective only surfaced through the steering turns. What the operator actually
wanted was to (a) confirm the `pi-hermes-memory` extension was alive and indexing, (b)
understand **which model** runs its background consolidation loop (the "session log
exploration on every 10 calls"), and then (c) **repoint that loop at Google's Gemma 4 31B**
instead of the default model — and verify end-to-end that the live model answers. The
finished result: a registered Google provider, a hermes config override pinned to the
keyed provider, and all 11 running sessions reloaded to pick it up.

## 2. TL;DR playbook

1. **Confirm the extension is healthy first.** Check `~/.pi/agent/settings.json` lists
   `npm:pi-hermes-memory`, run `sqlite3 sessions.db "PRAGMA integrity_check;"`, and confirm
   the FTS5 indexes return hits (`message_fts MATCH`, `memory_fts MATCH`).
2. **Find the trigger in source, don't guess.** The loop lives in
   `handlers/background-review.ts` (`turnsSinceReview >= config.nudgeInterval`, default 10)
   and spawns a child pi via `pi-child-process.ts` (`buildChildPiPromptArgs`).
3. **Learn how the model is chosen:** the child only gets `--model` when
   `config.llmModelOverride` is set; otherwise it inherits your default model.
4. **Register the Google provider** in `~/.pi/agent/models.json` — `api:
   google-generative-ai`, `apiKey: $GEMINI_API_KEY`, model `gemma-4-31b-it`. Use a distinct
   provider name (`my-google`) so it never collides with pi's built-in unkeyed `google`.
5. **Point hermes at it** in `~/.pi/agent/hermes-memory-config.json`:
   `llmModelOverride: "my-google/gemma-4-31b-it"`, `llmThinkingOverride: "off"`.
6. **Validate both files parse** (`python3 -m json.tool`) and simulate the child args with a
   tiny node snippet before trusting the wiring.
7. **Fire the real child invocation** with a sentinel prompt:
   `pi -p --no-session --model my-google/gemma-4-31b-it --thinking off "Reply with exactly:
   HERMES_GEMMA_OK"` — confirm the live model answers.
8. **Reload running sessions** (`npm run reload`) so each re-runs hermes `loadConfig` and
   picks up the new override.

## 3. How the collaboration unfolded

**Phase 1 — Health verification.** The AI located the extension (`grep` for hermes across
configs), confirmed it was enabled and actively writing (`sessions.db` mtime), and ran
integrity + FTS5 probes against the SQLite store. It produced a clean verdict table (v0.7.14,
77 memories, 332 messages indexed across 15 sessions). *Why it worked:* it treated "works
correctly?" as a multi-subsystem checklist (installed / enabled / DB integrity / actively
writing / both FTS5 indexes / per-project memory) rather than a yes/no glance.

**Phase 2 — Source-level trace of the trigger.** Steering turn #1 asked *which model* runs
the every-10-calls loop. The AI read the actual handler source
(`background-review.ts`, `pi-child-process.ts`, `constants.ts`) to pin `DEFAULT_NUDGE_INTERVAL
= 10` and show exactly how `--model` is (conditionally) appended. *Decision point:* it
grounded the answer in code, not assumption — the reusable insight is that the review model
is 100% determined by `config.llmModelOverride`.

**Phase 3 — Provider wiring.** Steering turn #2 ("show me, use gemma4 31b from google")
turned it into a change. The AI **surfaced two blockers before writing**: no Google provider
was configured, and `--model` needs a resolvable id. It found pi's own docs document the exact
`gemma-4-31b-it` example, confirmed `GEMINI_API_KEY` was set, then wrote `models.json` +
`hermes-memory-config.json`.

**Phase 4 — Live verification & disambiguation.** Steering turn #3 ("I'm curious gemma
compact is running") pushed it to actually fire the child invocation. `pi --list-models gemma`
revealed a **duplicate**: the built-in unkeyed `google` provider *also* ships
`gemma-4-31b-it`, so a bare id is ambiguous. The AI re-pinned to the qualified
`my-google/gemma-4-31b-it` and re-tested — the live model returned the sentinel.

**Phase 5 — Propagate.** Final "ok" → `npm run reload` pushed the config to all 11 connected
sessions, each re-reading `hermes-memory-config.json` on extension rebind.

## 4. Prompts that worked

- **Goal prompt** — *"Is pi-hermes-memory works correctly?"* Effective because it's a broad
  health question the AI could decompose into a subsystem checklist. A stronger kickoff would
  name the end goal directly: *"Verify pi-hermes-memory is healthy, then tell me which model
  runs its background consolidation loop — I want to repoint it at Google Gemma 4 31B."*
- **High-leverage follow-up** — *"what model used to make when session log exploration happens?
  (on every 10 call)"* forced a source-level answer instead of a hand-wave, and set up the
  whole change.
- **Unlock** — *"okay, show me. Use gemma4 31b for that from google"* — short, but it converted
  investigation into a concrete config change with a named target model.
- **Reliability nudge** — *"I'm curious gemma compact is running"* — pushed for live proof,
  which is what surfaced the bare-id ambiguity.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at a health verdict | asking which model runs the 10-call loop | state the end goal (repoint the review model) in prompt 1 |
| Describe the config path abstractly | "okay, show me" | ask for the actual file writes + a live test up front |
| Trust a bare model id | "gemma compact is running" (demand proof) | always test with a sentinel prompt against the live model |
| Leave `provider/id` ambiguous | (self-corrected after `--list-models`) | pin the qualified `my-google/gemma-4-31b-it`, never bare |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was persisted this session, but the workflow is clearly repeatable and
**should be captured as a project skill** — something like *"repoint-hermes-review-model"*:

- **What it would capture:** the exact 8-step path (health check → source trace of
  `nudgeInterval` → register `my-google` provider in `models.json` → set `llmModelOverride`
  → parse-check → sentinel test → `npm run reload`).
- **Why effective:** it removes the two easy-to-miss traps — the built-in/unkeyed `google`
  provider name collision, and forgetting that hermes reads config only at session startup
  (so a reload is mandatory).
- **When to invoke:** any time the background-review/consolidation model needs changing, or a
  new provider is added for it.

## 7. Pitfalls & dead ends

- **Bare `--model gemma-4-31b-it` is ambiguous.** pi ships a built-in unkeyed `google`
  provider with the same id; a bare id can silently resolve to it and fail. → Always use the
  qualified `my-google/gemma-4-31b-it`.
- **Node/TS loader can't run the extension source directly** to introspect args. → Simulate
  `buildChildPiPromptArgs` with a small node snippet reading the JSON config instead.
- **Config is read at session startup, not live.** New sessions pick it up immediately;
  existing sessions need `npm run reload` to re-run `loadConfig` on rebind. Three bash
  commands failed mid-session (early `ls`/probe/`pi --help` shape mismatches) — harmless
  探针 that were retried with corrected forms.
- **`hasUI` stderr noise** from the dashboard extension appears in print-mode; it's harmless,
  the model still answers.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** `GEMINI_API_KEY` exported; write access to `~/.pi/agent/models.json`
and `~/.pi/agent/hermes-memory-config.json`; the target model id (`gemma-4-31b-it`).

- [ ] Health-check hermes: settings lists `npm:pi-hermes-memory`, `PRAGMA integrity_check` = ok,
      both FTS5 indexes return hits.
- [ ] Confirm the trigger: `nudgeInterval` default 10 in `background-review.ts`; model chosen by
      `config.llmModelOverride`.
- [ ] Add provider `my-google` (`api: google-generative-ai`, `apiKey: $GEMINI_API_KEY`,
      `gemma-4-31b-it`) to `models.json`.
- [ ] Set `llmModelOverride: "my-google/gemma-4-31b-it"` + `llmThinkingOverride: "off"` in
      `hermes-memory-config.json`.
- [ ] `python3 -m json.tool` both files; verify they parse.
- [ ] Live test: `pi -p --no-session --model my-google/gemma-4-31b-it --thinking off "Reply with
      exactly: HERMES_GEMMA_OK"`.
- [ ] `npm run reload` to propagate to all running sessions.

**Final artifacts:** `~/.pi/agent/models.json` (new `my-google` provider),
`~/.pi/agent/hermes-memory-config.json` (override + thinking off).

---

_Generated from session `019e8486` · `pi-agent-dashboard` · 2026-06-02. Source extract: `/tmp/session_facts_58045_30707.md`._
