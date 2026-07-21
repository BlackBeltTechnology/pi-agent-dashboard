# How we did it: Non-disruptive file-open — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.
>
> This session took a vague UX itch ("why does opening a file yank me out of the
> editor?") and drove it — *without writing a line of product code* — into a fully
> doubt-reviewed, scenario-backed, committed OpenSpec **plan** ready for the worktree
> build phase. The whole thing lived in explore mode → design → `plan-proposal`.

---

## 1. Goal (the ask)

The operator entered **explore mode** (the `openspec-explore` skill) — a "think, don't
implement" stance — with an observed behaviour, not a written spec. The real question,
which only crystallised through the steering turns, was:

> *"When I open a file while I'm focused in the maximized editor, the app forces me
> back to split view and steals my active tab. I want opening a file to be
> non-disruptive: keep my current pane layout, and if the agent opens something in the
> background, add it quietly without pulling me off what I'm reading."*

The finished artifact is an OpenSpec change named **`non-disruptive-file-open`** —
proposal + design + two spec deltas + tasks + a 28-scenario test-plan + an interactive
verified mockup — **committed to `develop`**, stopping cleanly at the git-worktree
boundary (the plan/build handoff line). No product code was written; that is the point
of the planning phase.

## 2. TL;DR playbook

1. **Enter explore mode first** (`openspec-explore`) — investigate the behaviour as a
   *design question*, not a bug to patch. Let the AI read the code and confirm whether
   the behaviour is intentional (it was — baked into a spec scenario).
2. **Make the AI name the mental model.** When it offered "is `full` a temporary zoom
   or a focus lock?", pick one out loud. That single choice predicts every downstream
   edge case.
3. **Add the second axis by steering.** Say the refinement plainly:
   *"when already in split/editor mode, add the new tab silently — UX feedback but
   don't change what I'm reading."* This split one behaviour ("open a file") into two
   orthogonal axes: **mode-stickiness** and **focus-intent**.
4. **Ask for a mockup + UX review** before scaffolding. The AI built an interactive
   HTML demo that *encodes both axes* and drove it live in the browser to verify all
   four rules — the mockup becomes the interaction source-of-truth.
5. **Run the coherence check before writing any OpenSpec artifact** (project
   convention). It caught a live neighbouring change (`redesign-split-layout-controls`)
   carrying the *exact* scenario this change overturns → produced a coordination note
   instead of a silent collision.
6. **Invoke `plan-proposal`** to drive the drafted change through the gates:
   doubt-driven-review → scenario-design → fold → commit.
7. **Let doubt-review run single-model + cross-model.** Both converged; 10 findings, 2
   critical — including a *fabricated* code path the AI had invented. Reconcile every
   actionable finding back into the artifacts.
8. **Fold the scenario manifest into `tasks.md`** as parser-safe vanilla checkboxes,
   validate (`openspec validate` + `openspec status`), commit only the change dir, and
   **stop at the worktree boundary**.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (explore mode).** The AI traced the file-open funnel and found
that *every* opener (`openInSplit`, `openLiveTarget`, `openUrlTarget`, `openDiffTab`,
`openChanges`) unconditionally ran `updateSplit({ mode: "split" })`, and the `openFile`
reducer *always* activated the opened tab. It confirmed via `grep`/`read` that this was
**by design** — a named spec scenario (`Content opener from full returns to split`)
locked it in. *Why it worked:* framing it as "is this intended?" avoided a wrong-headed
bugfix and surfaced the real design decision.

**Phase 2 — Design dialogue (the two axes emerge).** The AI drew the state machine and
posed the mental-model fork: *`full` = "maximized zoom openers may undo"* vs *"focus
lock openers must respect."* The operator's steering turns (§5) added a **second axis**:
preserve not just the mode but the *active tab*. The AI rendered this as an ASCII matrix
separating **AXIS 1 — mode** (closed→split, split→split, full→full sticky) from
**AXIS 2 — focus** (user click activates; agent auto-open adds a background unread tab).

**Phase 3 — Mockup + UX review.** The AI wrote an interactive `mockups/index.html` that
faithfully encoded both axes plus a cited-heuristics `ux-review.md`. Playwright's
headless binary was missing, so it drove the mockup with the **browser tool** instead —
switching to full mode, firing an agent auto-open, and verifying live that the mode
stayed `full`, the new tab arrived **unread without stealing focus**, and clicking it
cleared the dot. *Decision point:* the mockup doubles as the interaction spec.

**Phase 4 — Coherence check + scaffold.** Before writing artifacts, the AI ran the
project's mandatory `pre-scaffold-openspec-coherence-check`. It found
`redesign-split-layout-controls` (active, touched the same day) carried the *exact*
scenario this change flips → flagged an explicit **coordination/sequencing note** rather
than colliding. Then it scaffolded `non-disruptive-file-open` via the openspec CLI and
wrote proposal + design + 2 spec deltas + tasks.

**Phase 5 — `plan-proposal` gates.** Doubt-driven-review spawned a fresh-context
reviewer (10 findings, 2 CRITICAL) then, per the skill's mandate, a **cross-model**
second opinion (`@propose-review-1`, glm-5.2 — different architecture family from the
Claude author). Both converged, sharply raising confidence. Reconciliation removed a
**fabricated "tool-result auto-open" path** (which *shrank* scope to one agent-driven
path), caught a **6th mode-changer** (a param-less deep-link in `SessionSplitView.tsx:54`
both reviewers found and verified in source), and added a missing **`F9` test-rewrite**
task that would otherwise have red-flagged CI. Scenario-design then hit its HARD gate —
3 scenario slots couldn't fill from the spec, so it **stopped and asked** for decisions
(unread invariant, re-pulse, reduced-motion). Those folded back as a reducer *invariant*.

**Phase 6 — Fold + commit.** The 28-scenario manifest folded into `tasks.md` as 58
parser-safe vanilla checkboxes; `openspec validate` + `openspec status` confirmed
structural soundness; only the change dir was staged and committed to `develop`
(`47d45f693`); `plan-proposal` stopped at the worktree boundary.

## 4. Prompts that worked

- **The goal prompt (kickoff):** entering via the `openspec-explore` skill was the
  high-leverage move — it put the AI in "investigate + design, never implement" mode, so
  the first hour went to *understanding the funnel and framing the decision* instead of
  a premature patch. A future operator should open the same way: *"Explore mode: why
  does opening a file force split view / steal my tab? Is it intentional?"*
- **"I think it's a good idea when the window is in chat mode and canvas performs, open
  in split mode. When already in split/editor mode, add the new tab silently — with some
  UX feedback but not change the actual content the user may be reading."** — the
  highest-leverage follow-up of the whole session. In one sentence it introduced the
  **second axis** (focus-intent) that reshaped the entire design. *Why effective:* it
  stated the desired *end behaviour per current state*, letting the AI derive the rule
  table rather than guess.
- **"And make mockup and ux review"** — a four-word prompt that unlocked a verifiable
  interaction spec. Short, high-leverage: it forced the abstract axes into something
  clickable and testable.
- **Invoking `plan-proposal`** — one skill invocation drove four gates
  (doubt-review → scenario-design → fold → commit) without hand-holding.

*Weak → strong rewrite:* the terse steering *"Is the canvas will automatically in split
view when editor is not shown?"* worked because the AI traced it precisely, but a
stronger form states the intent: *"Confirm what canvas auto-open does in each mode
(closed / split / full / mobile) — I want to know if it yanks me out of full."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat "open a file" as a single behaviour (mode only) | *"add the new tab silently … don't change the content the user is reading"* | State up front there are **two axes** — pane *mode* and active-tab *focus* — and they move independently |
| Design only the mode-stickiness rule | Asking the canvas-in-each-mode question (steering #1) which exposed the focus axis | Ask the AI to enumerate **auto-openers vs user clicks** early — intent (who triggered it) is a first-class input |
| Jump toward scaffolding after the design felt "done" | The mockup-and-review request (steering #4) | Require a **verified mockup** as the interaction source-of-truth before any spec artifact |
| Invent a plausible-but-nonexistent code path ("tool-result file path auto-open") | Doubt-review's cross-model pass falsified it against real source | Always run **doubt-driven-review with a cross-model second opinion**; require reviewers to *verify claims against source*, not just reason |
| Miss non-obvious openers (a 6th, param-less deep-link) | Both reviewers caught `SessionSplitView.tsx:54` | Ask the AI to **grep for every mode-mutation call site** and list them exhaustively before designing the guard |
| Leave an existing inverse test (`F9`) unaddressed | Reviewers flagged the CI red | When flipping a spec scenario, **search for the test that asserts the old behaviour** and add its rewrite as a task |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was *created* this session — but the value lies in **which
existing skills were composed, and the order**. This chain is the reusable asset:

- **`openspec-explore`** — the "think, don't implement" stance. *Effective because* it
  prevents the classic failure of patching a symptom; it forces the behaviour to be
  understood as a design decision first. Invoke it whenever a request is a UX *itch*
  rather than a written spec.
- **`pre-scaffold-openspec-coherence-check`** — mandatory before writing any OpenSpec
  artifact. *Effective because* it caught a same-day neighbouring change carrying the
  exact scenario being overturned, turning a silent collision into a documented
  coordination note. Invoke it every time before `openspec change new`.
- **`plan-proposal`** — orchestrates the planning gates and **stops at the worktree
  boundary**. *Effective because* it composes doubt-review + scenario-design + fold +
  commit without the operator sequencing them by hand, and enforces the plan/build
  handoff line. Invoke it once a change is drafted on `develop`.
- **`doubt-driven-review` (single + cross-model)** — the highest-value gate here.
  *Effective because* requiring a *different-architecture* reviewer to verify claims
  against source caught a fabricated code path and a hidden 6th call site — both real,
  both verified in the tree. Invoke it before any irreversible or spec-flipping design
  stands.
- **`scenario-design`** with its **HARD gate** — refuses to lock scenarios when a
  (input · trigger · observable) triple can't be filled from the spec, and **stops to
  ask**. *Effective because* it surfaced 3 genuine spec gaps (unread invariant,
  re-pulse, reduced-motion) that became a reducer *invariant* rather than a late bug.

*Recommendation:* this exact chain — **explore → coherence-check → design + mockup →
plan-proposal (doubt-review cross-model → scenario-design → fold → commit)** — is worth
saving as a project convention for any "rewire the single funnel everything passes
through" change.

## 7. Pitfalls & dead ends

- **Playwright headless binary missing** → the AI couldn't `score_mockup`. *Fix:* drive
  the mockup with the **browser tool** instead (open, click, screenshot, read DOM) — it
  verified all four interaction rules live.
- **Stale browser refs after a mode re-render** → clicks silently missed; only one tab
  appeared. *Fix:* re-snapshot before each click; and note the deck buttons were **below
  the fold** — scroll them into view before clicking. The "bug" was off-screen clicks,
  not a real handler failure (confirmed via the log line + console).
- **`edit` tool `oldTextN` / multi-alias fields kept getting ignored** (happened 4+
  times) → apply each edit as a **separate array element / standalone edit**, not
  batched aliases in one call.
- **The AI fabricated a "tool-result file path auto-open" path** that doesn't exist
  (`FileLink` is a user click). *Fix:* the cross-model doubt-review caught it; removing
  it *simplified* the change to one agent-driven path. Lesson: treat AI-asserted code
  paths as claims to verify, not facts.
- **A 6th mode-mutation site hid from the design** (param-less deep-link in
  `SessionSplitView.tsx:54`). *Fix:* grep exhaustively for every `updateSplit`/mode call
  before writing the guard.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the running dashboard client source (`packages/client/src`),
`develop` checked out, the openspec CLI, a browser tool (Playwright optional), and the
configured `@propose-review-N` reviewer roles.

- [ ] Enter **`openspec-explore`**; ask *"why does opening a file force split / steal my
      tab — is it intentional?"* Let the AI trace the opener funnel + reducer.
- [ ] Make the AI **name the mental model** for `full` (temporary zoom vs focus lock).
- [ ] State the **two axes** explicitly: mode-stickiness + focus-intent (user click
      activates; agent auto-open adds a background unread tab).
- [ ] Ask for a **mockup + UX review**; verify all rules **live in the browser** (fall
      back from Playwright to the browser tool if headless is missing).
- [ ] Run **`pre-scaffold-openspec-coherence-check`**; capture any coordination note.
- [ ] Scaffold via the **openspec CLI**; write proposal + design + spec deltas + tasks.
- [ ] Invoke **`plan-proposal`** → doubt-review **single + cross-model** (verify claims
      vs source) → reconcile every actionable finding → scenario-design (answer its HARD
      gate) → fold manifest into `tasks.md` as vanilla checkboxes.
- [ ] `openspec validate` + `openspec status` green; **commit only the change dir**;
      **stop at the worktree boundary** (build happens next, in the worktree).

**Final artifacts produced (all committed to `develop`, `47d45f693`):**
`openspec/changes/non-disruptive-file-open/` → `proposal.md`, `design.md`,
`specs/split-editor-workspace/spec.md`, `specs/auto-canvas/spec.md`, `tasks.md`
(58 parser-safe checkboxes), `test-plan.md` (28 scenarios), `mockups/index.html`
(verified live) + `mockups/ux-review.md`.

---

_Generated from session `019f6c93-9bdb-7f1c-b38a-213ce1376632` ·
`/Users/robson/Project/pi-agent-dashboard` · 2026-07-17. Source extract:
`/tmp/session_facts.md`._
