---
session: 019f364e
week: 2026/W28
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [collapse-tool-calls-across-narration, group-tool-call-bursts]
proposal_excerpt: "The `group-tool-call-bursts` change (archived 2026-07-06) added a temporal **burst** pass as the OUTER pass over the semantic identical-call (`×N`) pass, running it FIRST over the raw reducer array with a boundary rul…"
---

# How we did it: "Full rebuild and deploy" that turned into a spec'd regression fix — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with the smallest possible prompt: **`full rebuild and deploy`**. On its
face this is pure operations — run the project's build → restart → reload sequence and
confirm the dashboard is healthy. But the *real* objective only emerged three prompts in:
after two clean redeploys the operator reported **"The collapsed messages in chat view is not
shown."** The deploy was a red herring; the actual goal was to **find out why a recently
shipped chat-view feature (tool-call collapsing) had visibly regressed, decide whether it was
a bug or a deliberate design choice, and capture the fix as a reviewable OpenSpec change** —
without touching code until the operator approved the design.

## 2. TL;DR playbook

1. Run the deploy sequence first, exactly as documented: `npm run build` → `POST /api/restart`
   → `npm run reload`. Verify health via `/api/health` (check `pid` changed, `mode:production`).
2. When a UI feature "isn't showing", **do not assume the deploy failed** — prove the built
   bundle contains the feature: `grep` the compiled `packages/client/dist/assets/index-*.js`
   for the feature's symbols, and confirm the running server serves that exact dist path.
3. Run the feature's unit tests in isolation (`HOME=$(mktemp -d) npx vitest run <feature>`).
   Green tests + present-in-bundle = **runtime/logic regression, not a deploy problem.**
4. Reproduce the regression on *real data*, not by eyeballing the browser: write a tiny
   throwaway `.mts` that feeds a realistic event stream (`[call, call, prose, call, call]`)
   through the grouping functions and print the OLD vs NEW output.
5. Read the git diff of the commit that introduced the feature (`git show <sha> -- <file>`)
   to find the exact behavioral change — here, "non-empty assistant prose = hard boundary."
6. Check whether the behavior is **locked in by a spec/test** before "fixing" it. It was —
   so this is a spec change, not a bug patch.
7. Present the trade-off as a table and **ask which direction** via `ask_user` — don't pick
   silently.
8. Scaffold the change with `openspec change new <name>`, author all four artifacts
   (proposal/design/tasks/spec-delta), `openspec validate --strict`, then **stop** and let
   the operator review. Commit *only* your change dir; leave pre-existing dirty files alone.

## 3. How the collaboration unfolded

**Phase 1 — Deploy (twice).** The AI ran the canonical rebuild sequence. Twice. The second
run was triggered because a stale PID made the first look like it hadn't swapped; the AI
correctly re-checked `/api/health` and saw the *old* pid still answering during the swap
window, then confirmed the new pid came up. *Effective bit:* it treated "pid unchanged" as a
timing artifact, waited, and re-verified rather than declaring failure.

**Phase 2 — Symptom triage (the pivot).** The operator said the collapsed messages weren't
showing. The AI resisted the obvious "rebuild again" reflex and instead ran a layered
proof-of-deploy: is the feature in the source? in the compiled bundle? does the server serve
that bundle? do its tests pass? All yes → it reclassified the problem from *deploy* to
*runtime logic*. *This is the single most valuable move in the session* — it stopped an
infinite redeploy loop.

**Phase 3 — Reproduce on real data.** The browser view was too narrow to judge, so the AI
pulled a real session's event stream from `/api/sessions` and ran the grouping functions over
it in a scratch `.mts`. It produced a decisive OLD-vs-NEW diff: `[curl, curl, prose, curl,
curl]` collapsed to one `×4` pill *before* the feature commit, and rendered as 4 separate rows
*after*. Regression confirmed with evidence, not intuition.

**Phase 4 — Root cause + design judgment.** Reading the introducing commit's diff, the AI
found the burst pass treats any narration between calls as a hard boundary — and pi agents
narrate before nearly every tool call, so neither `×N` pills nor burst groups ever form in a
narrated session. Crucially it noticed an **explicit test locking this in** ("does NOT
over-merge identical calls split by prose") — so the current behavior was *deliberate*, not
accidental. It surfaced the trade-off and asked for direction instead of reversing a spec'd
decision unilaterally.

**Phase 5 — Author the OpenSpec change, then halt.** Given the go-ahead for the design (fold
narration *into* the collapsed entry; run the semantic `×N` pass first, burst on top), the AI
ran the project's pre-scaffold coherence check, scaffolded with `openspec change new`, wrote
all four artifacts, validated `--strict`, committed **only** its change directory, pushed, and
explicitly left implementation on hold for review.

**Phase 6 — Final redeploy.** ~13h later the operator said `full build and redeploy`; the AI
redeployed the current `develop` build and flagged clearly that it carried **no code changes**
(the proposal is docs-only, implementation still on hold).

## 4. Prompts that worked

- **The goal prompt — `full rebuild and deploy`** — fine as an *ops* trigger because the
  project has a documented, single-command-per-step deploy sequence the AI can execute
  verbatim. Weak only in that it hid the real intent. A stronger kickoff when a UI bug is the
  true goal: *"After deploy, the collapsed tool-call pills aren't showing in chat view —
  figure out if the deploy is stale or the feature regressed, prove which, and don't touch
  code until we agree on a fix."*
- **`The collapsed messages in chat view is not shown`** — high-leverage: it redirected the
  whole session from ops to diagnosis. Its value was in naming the *observable symptom*
  precisely enough to reproduce.
- **`commit and push`** — worked because the AI had already scoped exactly which files were
  "its" change vs pre-existing dirt; the terse command was safe *only* because that boundary
  was established first.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat "feature not showing" as a deploy problem to be re-run | Restating the symptom as a *chat-view rendering* issue | Say up front "prove the bundle contains it before redeploying" |
| Risk reversing a spec'd design once a regression is found | (AI self-corrected) pausing at the spec/test that locked the behavior | State "if a test locks this behavior, treat it as a spec change and ask before editing" |
| Want to commit the whole dirty tree | (AI self-corrected) committing only its change dir | Say "commit ONLY the files you created; leave pre-existing dirty files untouched" |
| Judge a UI bug by squinting at a narrow browser pane | Pivoting to a real-data repro script | Prefer "reproduce the grouping logic on a real event stream" over screenshots for logic bugs |

The operator's implicit quality bar throughout: **no code changes without an approved design.**
The AI honored it by producing a full OpenSpec change and stopping at the review boundary.

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was persisted this session, but the workflow is textbook-reusable and a
skill **should** exist for it:

- **`diagnose-stale-deploy-vs-regression`** (recommended) — captures the layered proof:
  source → compiled bundle grep → served-path check → isolated vitest → real-data repro. It
  removes the reflexive "redeploy again" loop that burns cycles when the real problem is
  logic. Invoke whenever a shipped UI feature "isn't showing" after a deploy.

The session *did* produce a durable artifact: the **`collapse-tool-calls-across-narration`
OpenSpec change** (proposal/design/tasks/spec-delta), which is itself the reusable record of
*why* the design flips and what the fix must do — the value of the OpenSpec flow is exactly
this: a reviewable, validated design that survives the "implementation on hold" gap.

## 7. Pitfalls & dead ends

- **Stale-PID false negative:** right after `POST /api/restart`, `/api/health` can still
  report the *old* pid for a few seconds during the swap. Don't call the restart failed —
  `sleep` a few seconds and re-check that `pid` changed and `uptime` is small.
- **Post-restart reload races:** bridges take ~10s to reconnect after a restart, so the first
  `npm run reload` often runs before any session re-registers. Retry with a `sleep 8` before it.
- **Browser too narrow to judge a logic bug:** one `POST /api/restart` curl was the session's
  only failed command, and the browser pane was too cramped to see grouping behavior. For
  grouping/collapsing logic, a scratch `.mts` fed with a real event stream is faster and
  decisive; the browser is for *symptom confirmation*, not root-cause.
- **"Fixing" a spec'd behavior:** the regression was enforced by an explicit test. Patching
  the code directly would have broken the test and silently reversed a deliberate design.
  Always check for a locking test/spec before changing grouping/collapsing rules.

## 8. Reproduce it faster — checklist

- [ ] Deploy: `npm run build 2>&1 | tail` → `curl -s -X POST http://localhost:8000/api/restart`
      → `curl -s http://localhost:8000/api/health` (confirm new `pid`, `mode:production`).
- [ ] Reload after `sleep 8`: `npm run reload` (retry once — bridges reconnect ~10s post-restart).
- [ ] If a UI feature "isn't showing": `grep` its symbols in
      `packages/client/dist/assets/index-*.js`; confirm the server serves that dist.
- [ ] Run its tests isolated: `HOME=$(mktemp -d) npx vitest run <feature-glob>`.
- [ ] Reproduce logic on real data: pull an event stream from `/api/sessions`, run the
      grouping fns in a throwaway `.mts`, print OLD vs NEW.
- [ ] `git show <feature-sha> -- <file>` to find the exact behavioral change; check for a
      locking test/spec.
- [ ] If spec'd: present the trade-off table, `ask_user` for direction, then
      `openspec change new <name>` → author 4 artifacts → `openspec validate --strict`.
- [ ] Commit ONLY your change dir; leave pre-existing dirty files. Push. Stop for review.

**Inputs to have ready:** a running dashboard on `:8000`, the feature's introducing commit sha,
the OpenSpec CLI. **Artifacts produced:** `openspec/changes/collapse-tool-calls-across-narration/`
(`proposal.md`, `design.md`, `tasks.md`, `specs/chat-view/spec.md`), commit `8f19acb74` on
`develop`, plus two clean redeploys.

---

_Generated from session `019f364e` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-06. Source extract: `/tmp/session_facts_3458_1784850552.md`._
