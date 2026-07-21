# How we did it: Directory view on directory-card select — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.
>
> Session outcome: a **planned, validated OpenSpec change** —
> `enable-workspace-folder-home-page` — committed to `develop`, stopped at the
> worktree boundary ready for implementation. No feature code was written; this was
> an explore → plan session.

---

## 1. Goal (the ask)

The operator wanted selecting a **directory card** in the sidebar to open that
directory's **home page/view**. The session opened in `openspec-explore` mode ("Enter
explore mode. Think deeply… you must NEVER write code"), so the real objective was to
*investigate whether the behavior was missing and, if so, capture a change proposal* —
not to implement.

Grounding flipped the framing almost immediately: the directory page **already exists**
(`DirectoryHomeView` at route `/folder/:encodedCwd`), and the "missing" behavior was a
**deliberate gate**. The page guards to *pinned* directories, and the sidebar's
open-page (⧉) affordance is hidden inside workspaces (`isPinned && !inWorkspace`). Once
the operator clarified (steering #1) that the blocked case was **workspace-owned
folders**, the real ask crystallized: *relax two gates so a workspace folder can open
its own home page* — a small, orthogonal broadening, captured as an OpenSpec change and
run through the full `plan-proposal` planning pipeline.

## 2. TL;DR playbook

1. **Open in `openspec-explore` mode** for a "does X exist / how does X work" question.
   Force grounding before theory: "Investigate what *directory card* and *directory
   view* mean in the codebase before theorizing."
2. **Let grep find the real paths** — the client is `packages/client/src`, not
   `src/client`. Trace the actual interaction: which element is clickable, what the
   click does (toggle vs navigate), and where the guard/gate lives.
3. **Reframe "missing feature" as "deliberate gate" when the code shows intent.** Name
   the exact gate expressions and files (`SessionList.tsx renderGroup ~L930`,
   `DirectoryHomeView.tsx guard ~L76`).
4. **Ask ONE decision-forcing question** with lettered options (A1 vs A2) instead of
   guessing scope. Operator answers `A1`.
5. **Run the pre-scaffold coherence check** — scan active changes for duplicates/
   conflicts *before* `openspec new change`. Here it *validated* the design (two active
   changes repurpose the header click; keeping navigation on the distinct ⧉ button is
   orthogonal).
6. **Scaffold via CLI**: `openspec new change <name> --description "…"`, then write the
   four artifacts (proposal / design / spec delta / tasks) matching house format from a
   recent + archived change. `openspec validate --strict` after every edit.
7. **Invoke `plan-proposal`** to run the planning pipeline: doubt-driven-review (single
   fresh-context reviewer **+ mandatory cross-model second opinion**) → reconcile →
   scenario-design → fold manifest into `tasks.md` → commit at the worktree boundary.
8. **Trust the adversarial review over your own claims** — verify each blocker at
   file:line yourself, fold the corrections, re-validate (parser-safe checkbox counts),
   commit to `develop`, and **stop** — do not cross into implementation.

## 3. How the collaboration unfolded

Six phases, ~1h20m, one model (opus, high thinking), $6.57.

- **Phase 1 — Discovery / grounding (explore).** The AI refused to theorize and
  grepped for `directory`/`DirectoryCard`/`DirectoryView`. First greps on `src/client`
  returned nothing → it corrected the path assumption and found the real client at
  `packages/client/src`. It located `DirectoryHomeView.tsx` (the page) and traced the
  sidebar folder header in `SessionList.tsx` (`renderGroup`), discovering an existing
  `navigate(buildFolderHomeUrl(cwd))` on a distinct ⧉ button. **Why it worked:** the AI
  drew the actual interaction map (chevron/toggle vs name-row vs ⧉-open) before
  proposing anything, so the diagnosis ("the page exists, the affordance is gated") was
  grounded, not guessed.
- **Phase 2 — Clarify scope (ask_user, steering #1).** The AI surfaced that the page is
  pinned-only and asked which case to enable. Operator: *"1. Workspace folder / 2.
  yes."* This pinned the target to `workspaces[].folders` members and unlocked
  scaffolding.
- **Phase 3 — Design decision (steering #2).** The AI presented the one real design
  question — *how does the page recognize an "allowed" folder?* — as **A1** (pass known
  workspace-folder paths into the guard) vs **A2** (accept any known dir). Operator:
  `A1`. A2 was rejected for over-accepting transient session cwds.
- **Phase 4 — Coherence check + scaffold.** Before `openspec new change`, the AI scanned
  active changes and found two (`accordion-workspace-folders`,
  `focus-driven-folder-compaction`) that repurpose the folder-header click — which
  *validated* keeping navigation on the separate ⧉ button. It scaffolded
  `enable-workspace-folder-home-page`, wrote proposal/design/spec-delta/tasks matching
  the archived `add-directory-home-page` spec shape, and validated strict.
- **Phase 5 — plan-proposal / doubt-driven-review (the load-bearing phase, steering
  #3).** Operator invoked `plan-proposal`. The AI ran the doubt cycle: it held back its
  CLAIM, spawned a **fresh-context reviewer** (artifact + contract only), then — per the
  skill's interactive mandate — a **cross-model** reviewer on `@propose-review-1`
  (glm-5.2, different family). **Both independently converged on the same two blockers**,
  which the AI then verified against source itself before folding in.
- **Phase 6 — Scenario-design, fold, commit at the boundary.** `scenario-design`
  produced `test-plan.md`; each automated row was folded into `tasks.md` with its
  manifest id; parser-safety was checked (raw checkbox count == parsed count) after each
  change. Committed to `develop`, stopped at the worktree boundary — implementation
  deliberately deferred to `ship-it`.

## 4. Prompts that worked

- **Goal prompt (the `openspec-explore` wrapper).** Effective because it forced a
  *thinking-not-implementing* stance: the AI grounded in real files before proposing,
  and captured the result as an OpenSpec artifact rather than editing code. For a
  "does X exist / why does X behave this way" question, **this is the right kickoff** —
  it prevents premature implementation of something that already exists.
- **Steering #1 — `"1. Workspace folder / 2. yes"`.** A two-line answer to a
  decision-forcing question that collapsed the ambiguity (which folder type? proceed?)
  in one turn. High leverage precisely because the AI had *asked a closed question*.
- **Steering #2 — `"A1"`.** One token unlocked the whole design because the AI had
  pre-framed the choice as labelled options with tradeoffs. **Reusable pattern:** make
  the AI enumerate lettered options *with the rejection rationale attached*, then answer
  with the letter.
- **Steering #3 — invoking `plan-proposal`.** Instead of hand-driving review + tests,
  the operator handed off to the composed pipeline skill. Effective because the skill
  *composes* existing skills (doubt-review, scenario-design) with the right guardrails
  (main-session-only, cross-model mandatory, stop at worktree boundary).

**Rewrite of the weak opening:** the bare goal ("directory view on directory card
select") was underspecified. A stronger kickoff: *"In explore mode: when I click a
directory/workspace-folder card in the sidebar, should it open that directory's home
page? Ground it in the real client code, tell me if the behavior exists and is gated,
and if a change is warranted capture an OpenSpec proposal."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Assume client paths (`src/client`) that don't exist in this monorepo | (implicit) — greps returned empty; AI self-corrected to `packages/client/src` | State the real layout up front: client=`packages/client`, server=`packages/server`, bridge=`packages/extension`. |
| Treat the behavior as a missing feature | Clarify the blocked case is **workspace-owned folders**, then approve | Ask "is this gated on purpose?" and name the guard expression before proposing a fix. |
| Leave the design choice implicit | Force a labelled decision (`A1` vs `A2`) and pick A1 | Have the AI present options *with rejection rationale* and answer with the letter. |
| **State confident but FALSE grounding claims** — e.g. "workspaces arrive in the same `sessions_snapshot` as pinned dirs" | Run doubt-driven-review; a fresh-context + cross-model reviewer both caught it | Never trust the AI's own "I verified this" — route non-trivial claims through an adversarial reviewer that reads the real source. |
| Assume dropping `!inWorkspace` yields the right condition | Reviewers found unpinned workspace folders have `folder.pinned === false` → button still hidden | Require the AI to trace the *actual value* passed at the call site (here `folder.pinned` at L1396), not the variable name. |

Two blockers the review caught (both source-verified, both folded in):
- **B1** — the fix condition must be `isPinned || inWorkspace`, not just dropping
  `!inWorkspace` (which collapses to `isPinned`, still hiding unpinned workspace rows).
- **B2** — pinned dirs and workspaces arrive in **separate** messages
  (`pinned_dirs_updated` vs `workspaces_updated`), so reusing the pinned "loaded" flag
  flashes the not-pinned notice; a combined `workspacesLoaded` gate is required.
  (Caveat the AI surfaced: `workspaces_updated` *is* sent unconditionally on connect for
  modern servers, so the flag reliably flips — only legacy test stubs lacking
  `getWorkspaces` wouldn't send it.)

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were *created* this session, but the workflow leaned on four
existing skills whose value is worth internalizing:

- **`openspec-explore`** — enforces a think-don't-implement stance. Effective here
  because the "feature" already existed as a deliberate gate; exploring first avoided
  re-building shipped behavior.
- **Pre-scaffold coherence check** — scans active/archived changes before `openspec new`.
  It didn't just prevent a duplicate; it *validated* the design by showing two active
  changes repurpose the header click, confirming the orthogonal ⧉-button approach.
- **`plan-proposal`** — the planning orchestrator. It composes doubt-review +
  scenario-design + fold + commit, and enforces the guardrails a human would otherwise
  have to remember: main-session-only, cross-model second opinion mandatory, stop at the
  worktree boundary. This is the skill that turns "I wrote a proposal" into "the proposal
  survived adversarial review and has a test manifest."
- **`doubt-driven-review`** (invoked by plan-proposal) — the load-bearing step. Two
  fresh-context reviewers (one cross-model) **independently converging** on the same two
  blockers is the signal that made the corrections trustworthy. Invoke it whenever a
  design rests on claims about code you haven't re-verified.

**Recommended memory to save** (would have shortened this session): a project convention
memory — *"pi-dashboard client lives in `packages/client/src` (monorepo), NOT
`src/client`; server=`packages/server`, bridge=`packages/extension`."* The AI burned
several greps rediscovering this.

## 7. Pitfalls & dead ends

- **Stale path assumption.** Greps on `src/client` returned nothing. *If you hit an empty
  grep in this repo, switch to `packages/*/src` — the monorepo layout differs from the
  root AGENTS.md's `src/client` shorthand.*
- **`edit` tool multi-pair limitation.** An edit with `oldText2/oldText3` fields silently
  honored only the first pair, mangling the Decisions section. *If you need multiple
  replacements in one file, do separate edits or rewrite the whole section — don't rely
  on `oldTextN` fields.*
- **Transient `.git/index.lock`.** The first `git commit` failed on a lock held by the
  dashboard's git watcher; a re-run after the lock cleared succeeded. *If a commit fails
  on `index.lock` in this repo, check the lock's age (`find .git/index.lock -mmin +1`)
  and retry — it's usually the dashboard watcher, not a stuck process.*
- **Concurrent multi-session git tree.** Other sessions committed to the shared working
  tree during the run. *Stage only your explicit paths and diff each modified file before
  committing to avoid absorbing another session's work.*
- **The AI's own grounding claims were wrong.** Two confident "I verified" statements were
  false and only caught by adversarial review. *Don't skip doubt-driven-review to save
  time on a "small" change — the small changes are where confident-but-wrong claims slip
  through.*

## 8. Reproduce it faster — checklist

Inputs to have ready:
- Repo on `develop`, main interactive session (plan-proposal refuses to run as a
  subagent), `openspec` CLI available.
- `@propose-review-1..3` role series configured (cross-model reviewers: glm-5.2,
  deepseek-v4-pro, opus).

Steps:
- [ ] Open in `openspec-explore`; ground the question in `packages/client/src` (not
      `src/client`) before theorizing.
- [ ] Map the real interaction (which element navigates vs toggles) and locate the
      gate/guard expressions with file:line.
- [ ] If it's a deliberate gate, ask ONE decision-forcing question with lettered options
      + rejection rationale; get the letter.
- [ ] Run the pre-scaffold coherence check against active/archived changes.
- [ ] `openspec new change <name> --description "…"`; write proposal/design/spec-delta/
      tasks to house format; `openspec validate --strict` after each edit.
- [ ] Invoke `plan-proposal`; run doubt-driven-review with a fresh-context **and**
      cross-model reviewer; verify every blocker at file:line yourself; fold corrections.
- [ ] `scenario-design` → `test-plan.md`; fold automated rows into `tasks.md`; confirm
      parser-safe (raw checkbox count == parsed count).
- [ ] Commit planning artifacts to `develop`; **stop at the worktree boundary** — hand
      implementation to `ship-it`.

Final artifacts produced:
- `openspec/changes/enable-workspace-folder-home-page/` — `proposal.md`, `design.md`,
  `specs/directory-home-page/spec.md` (2 MODIFIED requirements), `tasks.md`,
  `test-plan.md`. Validated strict, committed to `develop`.

---

_Generated from session `019f6cdb-137a-7632-b301-bbccbd675c3c` ·
`/Users/robson/Project/pi-agent-dashboard` · 2026-07-17. Source extract:
`/tmp/sf2.md`._
