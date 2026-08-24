---
session: 019e75c3
week: 2026/W22
type: other
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [redesign-session-card-and-composer]
proposal_excerpt: "Today the session card mixes git and jj in one `WORKSPACE` subcard, hides OpenSpec workflow progression behind a single state pill, and renders the same action surface only in the sidebar — so users lose context the m…"
---

# How we did it: Verify → archive → ship an OpenSpec change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator invoked the `openspec-verify-change` skill on the completed
`redesign-session-card-and-composer` change. The literal first "prompt" was the
skill body itself — *"Verify that an implementation matches the change artifacts
(specs, tasks, design)."* The real objective, once the follow-ups landed, was the
full **land-the-change** arc: confirm the implementation matches the spec, fix any
drift the verify surfaces, archive the change (syncing delta specs into main specs),
then commit and push. Sixteen minutes, one small tasks.md edit, one subagent, a green
6574-test run, and a pushed commit later — done.

## 2. TL;DR playbook

1. Run the `openspec-verify-change` skill against the finished change. Let it produce
   a 3-dimension report: **Completeness · Correctness · Coherence**.
2. Read the verify report. Expect it to pass but flag **SUGGESTION**-level drift
   (docs claim one mount site, code shipped another). Zero CRITICAL/WARNING = safe to
   land.
3. Steer with a one-word `ok, fix` — let the AI reconcile `tasks.md` to match what
   actually shipped (rename the section, add an implementation note, rewrite the
   affected task lines). Keep every checkbox checked.
4. Invoke the `openspec-archive-change` skill. It moves the change to
   `openspec/changes/archive/<date>-<name>/` and delegates delta-spec sync to a
   `general-purpose` subagent.
5. Sanity-check the archive: verify specs synced into `openspec/specs/`, note any
   **pre-existing** spec-format issues the sync surfaces (don't fix them here).
6. `commit and push` — single squash commit to `develop`, done.

## 3. How the collaboration unfolded

**Phase 1 · Verify (discovery).** The AI ran `openspec status --change … --json` and
`openspec instructions apply`, then grep-walked the actual client source
(`SessionCard.tsx`, `CommandInput.tsx`, `App.tsx`, `OpenSpecStepper.tsx`,
`ComposerSessionActions.tsx`) plus `index.css` tokens to check each task against
shipped code. It ran the full suite (`npm test → /tmp/verify-redesign.log`, 6574
tests green) and emitted a verification report: 54/54 tasks, 4 delta specs, **one
SUGGESTION** — `tasks.md` §9 said `<ComposerSessionActions>` mounts inside
`CommandInput.tsx`, but it actually ships in `App.tsx:1188` via `StatusBar`'s
`actions` prop (functionally equivalent, acknowledged in code comments). *Why it
worked:* verify reads the real tree, not the checkboxes — it caught doc/code drift a
checkbox scan never would.

**Phase 2 · Fix (reconcile docs).** On `ok, fix`, the AI edited only
`tasks.md` §9: renamed *"CommandInput wiring" → "Composer wiring"*, added a short
implementation note about the mount-site move, and rewrote 9.1–9.4 to match reality.
All 54 boxes stayed checked. *Decision point:* the human accepted "annotate the docs
to match the code" over "move the code to match the docs" — the shipped mount site
was the better design.

**Phase 3 · Archive + sync (land specs).** The `openspec-archive-change` skill moved
the change into `openspec/changes/archive/2026-05-30-…` and spawned a
`general-purpose` subagent to sync the four delta specs (chat-view,
openspec-attach-combo, session-card-selection, session-card-subcards) into
`openspec/specs/`. The subagent flagged a **pre-existing** format nit
(`openspec-attach-combo/spec.md` opens with `## ADDED Requirements` instead of
`## Purpose`) — reported, not fixed.

**Phase 4 · Ship.** On `commit and push`, one `git add -A && git commit` (archive +
spec sync) landed on `develop` as `ee23af04`.

## 4. Prompts that worked

- **The goal prompt = the skill invocation.** Firing `openspec-verify-change` on a
  finished change is the right kickoff: it turns "is this done?" into a structured
  Completeness/Correctness/Coherence report backed by a real test run, instead of a
  vibe check.
- **`ok, fix`** — a two-word high-leverage follow-up. Because the verify report had
  already isolated a single, well-scoped SUGGESTION, the AI knew *exactly* what to
  fix. Terse steering works **only after** a precise report; don't say "fix" into an
  ambiguous state.
- **`commit and push`** — the terminal unlock. Clean, obvious, no ceremony.

Stronger-prompt rewrite: if you want the fix pre-authorized, kick off with *"Verify
`<change>`; if the only findings are SUGGESTION-level doc drift, fix them in place
(keep all boxes checked) and then archive + push."* — collapses three turns into one.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| stop after the verify report, awaiting direction | `ok, fix` | pre-authorize SUGGESTION-level fixes in the kickoff prompt |
| treat verify as the end state | re-invoking `openspec-archive-change` | chain verify → archive → push in one instruction |
| leave `commit and push` implicit | explicit `commit and push` | say "archive and push to develop" up front |

Note: this was a *low-steering* session — the three follow-ups were all forward-motion
unlocks, not corrections. The AI never drifted; the human just advanced it through the
land-the-change stages one at a time.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session **consumed** three existing
OpenSpec skills, which is exactly why it was fast:

- **`openspec-verify-change`** — reads specs/tasks/design vs the real tree, runs the
  suite, emits a 3-dimension report with a severity taxonomy (CRITICAL/WARNING/
  SUGGESTION). *Invoke it* before archiving any change; the severity levels tell you
  whether you can land as-is (only SUGGESTIONs) or must loop back.
- **`openspec-archive-change`** — moves the change to `archive/<date>-<name>/` and
  syncs delta specs into main specs via a subagent. *Invoke it* once verify is clean.
- **`general-purpose` subagent (spec sync)** — isolates the mechanical delta→main
  spec merge so it stays out of the main context. *Effective* because spec sync is
  self-contained I/O with no coherence needs.

If you land OpenSpec changes often, the reusable asset already exists as the
`ship-change` skill — this session is essentially a manual, staged run of it.

## 7. Pitfalls & dead ends

- **Verify passing ≠ docs correct.** A change can be 54/54 with green tests and still
  have `tasks.md`/`design.md` describing a mount site the code abandoned. Always read
  the SUGGESTION findings before archiving — archive freezes the drift into the
  permanent spec.
- **Spec-format nits surface during sync, not before.** The archive subagent flagged
  `openspec-attach-combo/spec.md` opening with `## ADDED Requirements` instead of
  `## Purpose`. It's **pre-existing** — don't scope-creep the archive to fix it; note
  it for a separate change.
- **Don't fix code to match docs by reflex.** Here the shipped mount site (`App.tsx`
  via `StatusBar.actions`) was the better design; reconciling the docs to the code
  was correct. Judge which side is authoritative before "fixing".

## 8. Reproduce it faster — checklist

- [ ] Run `openspec-verify-change` on the finished change → read the report.
- [ ] CRITICAL/WARNING = 0? If not, loop back to implementation.
- [ ] Only SUGGESTIONs (doc drift)? Reconcile `tasks.md`/`design.md` to the shipped
      code; keep all boxes checked.
- [ ] Run `openspec-archive-change` → confirm move to `archive/<date>-<name>/` and
      delta specs synced into `openspec/specs/`.
- [ ] Note (don't fix) any pre-existing spec-format issues the sync surfaces.
- [ ] `git add -A && git commit && git push` to `develop`.

**Inputs to have ready:** a change with all tasks checked, a passing `npm test`, clean
`develop` working tree. **Artifacts produced:** reconciled
`openspec/changes/redesign-session-card-and-composer/tasks.md`, archived change at
`openspec/changes/archive/2026-05-30-redesign-session-card-and-composer/`, synced main
specs (chat-view, openspec-attach-combo, session-card-selection,
session-card-subcards), commit `ee23af04` on `develop`.

---

_Generated from session `019e75c3` · `pi-agent-dashboard` · 2026-05-30. Source extract: session-to-guideline facts sheet._
