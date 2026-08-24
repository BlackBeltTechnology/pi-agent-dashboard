---
session: 019dd0ce
week: 2026/W18
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (9 user prompts)"
upgrade_status: pending
openspec_changes: [fix-openspec-flag-rename-bug]
proposal_excerpt: "`detectOpenSpecActivity` in `packages/shared/src/openspec-activity-detector.ts` extracts the change name from openspec CLI invocations using regexes whose capture group `[^\\s\"']+` greedily matches any non-whitespace t…"
---

# How we did it: Fix the `openspec --help` session-rename bug — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** — a pure thinking stance ("You may read files,
search code, and investigate the codebase, but you must NEVER write code…"). No bug was
named up front; the operator wanted a thinking partner to hunt down *why running an
`openspec` help command could hijack a session's name*. The real objective, which
crystallized within two minutes of exploration, was: **find, spec, fix, and land the bug
where `detectOpenSpecActivity` captures `--help` as a change name**, causing an unnamed
pi session to be auto-renamed to `--help` and get a phantom `--help` proposal attached.
The session then walked the full OpenSpec lifecycle — explore → proposal → fast-forward
artifacts → apply → archive → commit.

## 2. TL;DR playbook

1. **Enter explore mode** and point the AI at the symptom, not the fix ("why would a
   session get renamed to `--help`?"). Let it trace the data flow.
2. Let it confirm the root cause in **one shared function** (`detectOpenSpecActivity`,
   `packages/shared/src/openspec-activity-detector.ts`) and map the cascade through
   `event-wiring.ts` → auto-attach → `rename_session`.
3. Say **`create proposal`** to convert the exploration into an OpenSpec change.
4. Run **`/opsx:ff`** (fast-forward) to generate all four artifacts —
   `proposal.md`, `design.md`, `specs/proposal-attachment/spec.md`, `tasks.md` — in one shot.
5. Run **`/opsx:apply`** to execute the TDD tasks: write failing flag-shaped tests →
   confirm red → add the single `-`-prefix guard → confirm green (36/36) → full suite (3387/3387).
6. Update the `AGENTS.md` row for the detector and run **`npm run reload`** so the live
   bridge picks up the fix.
7. Run **`/opsx:archive`** to sync the delta spec into `openspec/specs/` and move the
   change to `archive/`.
8. **`commit changes`** — one `fix(openspec):` commit, leaving unrelated untracked files alone.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (explore mode).** The AI grepped `model-tracker.ts`,
`openspec-activity-detector.ts`, and `event-wiring.ts` for the rename/attach path.
Within ~1 minute it isolated three greedy CLI regexes whose `[^\s"']+` capture group
matches `--help`, then drew the exact cascade: `openspec archive --help` →
`{ changeName: "--help", isActive: true }` → `session.openspecChange = "--help"` →
auto-attached proposal `--help` → `rename_session "--help"`. *Why it worked:* the
explore-mode constraint (no code) forced a complete root-cause trace before any edit,
so the fix target was unambiguous by the time implementation started.

**Phase 2 — Capture the thinking as a proposal.** On `create proposal` the AI wrote
`proposal.md` framing the minimal fix: reject captures starting with `-` in the one
shared detector; leave the (correct) rename/attach cascade alone. It surfaced an open
design question (guard the speculative regexes vs. remove them) rather than deciding
silently.

**Phase 3 — Fast-forward the artifacts.** `/opsx:ff` produced `design.md` (single guard
in the `bash` arm, no defense-in-depth duplication), a new spec requirement *"Activity
detector rejects flag-shaped change names"* with 5 scenarios, and a TDD `tasks.md`. All
four validated. Decision point: the human let the AI pick the "single guard in the bash
arm" design over rewriting three regexes.

**Phase 4 — Apply (TDD).** `/opsx:apply` added a `describe("flag-shaped change names")`
block (3 negative cases: `archive --help`, `new change --help`, `--change --help`; 2
positive controls), confirmed they failed, then collapsed the `bash` arm into
match-then-guard rejecting any `-`-prefixed name. Result: 36/36 detector tests, then
3387/3387 full suite. It correctly flagged the `npm run reload:check` TS errors as
**pre-existing and unrelated** (client/, dashboard-plugin-runtime/, server.ts) rather
than chasing them.

**Phase 5 — Land it.** `npm run reload` pushed the fix live across all 13 sessions;
`/opsx:archive` synced the additive delta spec; `commit changes` produced `05be2ed`
(9 files, +88/−32) and deliberately left the untracked, unrelated
`docs/plans/command-palette-future.md` alone.

## 4. Prompts that worked

- **The goal / kickoff (explore mode):** entering explore mode with an investigative
  stance ("think deeply… NEVER write code… remind them to exit explore mode first") was
  the strongest possible opener — it bought a full root-cause trace before any keystroke
  of implementation. *Reusable version:* "Enter explore mode. Trace why `<symptom>`
  happens end to end before proposing any fix."
- **`create proposal`** — a two-word high-leverage unlock that converted loose
  exploration into a durable, reviewable OpenSpec artifact at exactly the right moment
  (root cause known, fix not yet written).
- **`/opsx:ff`** — one command that generated all four artifacts, skipping four separate
  round-trips.
- **`/opsx:apply` → `/opsx:archive` → `commit changes`** — the terminal chain that took
  a validated change to a committed fix with almost no prose from the operator.

Weak-prompt rewrite: instead of pasting `$ openspec archive --help\nUsage:…` (raw
terminal output) as a nudge, say **"confirm `openspec archive --help` is the real
bug-trigger and that the fix now returns null for it."**

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Pause after each OpenSpec artifact and ask "continue or stop?" | Issuing the next slash-command (`/opsx:ff`, `/opsx:apply`, `/opsx:archive`) explicitly | Chain the lifecycle up front: "explore → proposal → ff → apply → archive → commit, don't pause between stages" |
| Offer a menu ("1. reload the bridge, or 2. archive") | Answering with a bare `1` | State the reload-vs-archive preference in the goal ("reload live so I can smoke-test, then archive") |
| Treat the manual smoke test (Task 4.3) as blocking | Confirming the flag pattern from real CLI `--help` output so the AI could mark it done-for-you | Pre-declare "mark manual UI smoke tests complete and note them for me" |
| Risk conflating pre-existing TS errors with the change | (No steer needed — AI self-corrected) | Keep the "verify only *my* changed files" discipline; it held here |

The recurring lesson: the OpenSpec skills are deliberately **checkpoint-heavy** (they
prompt for confirmation between stages). If you already know you want the whole
lifecycle, say so once so you don't re-issue a command per stage.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session *consumed* the existing OpenSpec skill
suite (`openspec-explore`, `openspec-ff-change`, `openspec-apply-change`,
`openspec-archive-change`) end to end. One subagent was spawned:

- **`general-purpose` subagent — "Sync delta specs".** Isolated the additive spec-sync
  (appending the new `Requirement:` block to `openspec/specs/proposal-attachment/spec.md`)
  into its own context. *Why effective:* keeps the mechanical delta-fold out of the main
  reasoning thread.

*Recommended skill to create:* a **"trace-then-guard a greedy CLI regex"** note — the
pattern here (a `[^\s"']+` capture that eats `--help`, fixed by a single match-then-guard
rejecting `-`-prefixed tokens rather than rewriting every regex) recurs any time CLI text
is parsed with a permissive character class.

## 7. Pitfalls & dead ends

- **Vitest needs an isolated HOME.** The first `npx vitest run` was re-run with
  `HOME=$(mktemp -d)` to avoid the real home polluting the run — use the `HOME=$(mktemp -d)`
  form when running the detector tests directly.
- **`reload:check` shows red that isn't yours.** The TS errors it reports live in
  unrelated files (client/, dashboard-plugin-runtime/, server.ts) and predate the change.
  Don't chase them; the passing `npm test` (3387/3387) is the real signal.
- **Manual UI smoke tests can't be automated from the session.** Task 4.3 (open an
  unnamed session, run `openspec archive --help`, confirm no rename) is a human step —
  mark it complete and hand the operator the exact repro instead of blocking on it.
- **Reloading a *named* session hides the bug.** This session was already named
  `fix-openspec-flag-rename-bug`, so its rename branch (`if (!session.name?.trim())`)
  never fired. For a true cold reproduction you need a **brand-new unnamed** session.

## 8. Reproduce it faster — checklist

- [ ] Enter explore mode; ask the AI to trace `<symptom>` to a root cause with no edits.
- [ ] Confirm the fix lives in one shared function; note the downstream cascade.
- [ ] `create proposal` → `/opsx:ff` to scaffold all four artifacts in one pass.
- [ ] `/opsx:apply`: write failing flag-shaped tests → red → single `-`-prefix guard →
      green → full suite.
- [ ] Update the relevant `AGENTS.md` row; `npm run reload` to go live.
- [ ] `/opsx:archive` (syncs delta spec) → `commit changes` (one `fix(openspec):` commit).

**Inputs to have ready:** a running dashboard/bridge (`npm run reload` target), the
OpenSpec skill suite, `HOME=$(mktemp -d)` for isolated vitest runs.

**Artifacts produced:**
- `openspec/changes/archive/2026-04-28-fix-openspec-flag-rename-bug/` (proposal, design, spec, tasks)
- `packages/shared/src/openspec-activity-detector.ts` (the `-`-prefix guard)
- `packages/extension/src/__tests__/openspec-activity-detector.test.ts` (5 flag-shaped cases)
- `openspec/specs/proposal-attachment/spec.md` (new requirement synced)
- commit `05be2ed` on `develop` — 9 files, +88/−32.

---

_Generated from session `019dd0ce` · `pi-agent-dashboard` · 2026-04-28. Source extract: `/tmp/session_facts.oBZBYR.md`._
