---
session: 019f2adf
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [flag-package-source-overrides]
proposal_excerpt: "Many recommended pi extensions are declared as npm packages (`RECOMMENDED_EXTENSIONS[].source = \"npm:<name>\"`) but are actually installed on a developer's machine from a **local checkout** (`/home/dev/pi-web-access`)…"
---

# How we did it: Doubt-review an OpenSpec proposal, rescope it, then ship it — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with two words: **"doubt review"**. No context, no target file named
— just a demand to adversarially stress-test the pending OpenSpec change
`flag-package-source-overrides` *before* any code was written. The real objective, which
the first five minutes of verification clarified, was: **prove or disprove the proposal's
core threat model against pi's actual source, and only build what survives the doubt.**
The proposal claimed that recommended packages installed from a local/git checkout would
show a destructive npm **[Update]** button that clobbers the checkout. That claim turned
out to be false — so the session became a *rescope-then-ship* run: keep the harmless
verbal `override` badge, drop the entire (imaginary) update-gating machinery, then land
the trimmed change through apply → CI → CodeRabbit → squash-merge.

## 2. TL;DR playbook

1. **Kick off with `doubt review`** on the change while it's still proposal/design-stage — the cheapest possible moment to kill a bad design.
2. **Verify load-bearing claims against source first.** Before spawning any reviewer, grep pi's real `package-manager.js` (`checkForAvailableUpdates`, `operations.update(source)`) to see what the code *actually* does.
3. **Spawn a fresh-context `Explore` subagent** as an adversarial reviewer that can open repo files independently — then *re-verify its central doubt against source yourself*; don't rubber-stamp.
4. **Record the doubt findings into `design.md`** (it's under `openspec/`, edit directly — not `docs/`), commit, and leave proposal/tasks untouched so the original scope is preserved for the rescope decision.
5. **On `rescope`:** re-read all artifacts in full, then rewrite proposal + design + tasks + spec delta + mockup together so they tell one coherent (smaller) story. Drop orphaned CSS/props your cuts create.
6. **Run `/skill:openspec-apply-change <name>`** — implement TDD: classifier fix + helper + unit tests, then the UI pill + component tests, then wiring, then AGENTS.md rows.
7. **Isolate test HOME** (`HOME=$(mktemp -d) npx vitest run …`) so pi's real config can't leak into the run.
8. **Run `use ship-change skill`** — archive + sync specs, push, open PR against `develop`, watch CI, triage CodeRabbit, apply only safe in-scope fixes, squash-merge, delete branch, remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Doubt (verify → challenge → reconcile).** The AI refused to reason from the
proposal's prose. It grepped pi's bundled `package-manager.js`, confirmed
`operations.update(pkg.source)` routes by the row's own source (local stays local, git
does `git pull`, never npm-over-checkout), and that `checkForAvailableUpdates()` returns
`undefined` for `local`/`pinned` sources — so the destructive button *never even renders*.
It then spawned an `Explore` subagent as a fresh-context adversary, and when the reviewer's
central doubt matched the source evidence, classified the proposal's problem #2 as
**actionable-blocking: factually false**. *Why it worked:* source-grounding beat
prose-grounding — the whole motivating danger was fictional, caught before a line of code.

**Phase 2 — Commit the findings.** On `commit` the AI noticed the working tree was clean
(doubt review was analysis-only) and *asked what to commit* rather than inventing a diff.
It recorded a dated "Doubt review" section into `design.md` and committed, deliberately
leaving proposal/tasks at original scope. *Decision point:* the human chose rescope
(option 2) over defend.

**Phase 3 — Rescope.** On `rescope` the AI re-read all five artifacts and rewrote them as
one coherent smaller change: **kept** `isSourceOverride` helper, the `git:`-prefix
classifier fix (badge correctness), and a dedicated `override` pill; **dropped** all
update-gating, the disabled button, the muted hint, and the misleading `isDev=isOverride`
wiring — plus the now-orphaned CSS in the mockup and the spec's gating scenarios.

**Phase 4 — Apply (TDD).** `/skill:openspec-apply-change` walked 14 tasks: classifier +
helper + unit tests → PackageRow `override` pill + component tests → wiring at two call
sites (auto-forwarded via `WhatsNewPackageRow`'s `{...rowProps}` spread) → AGENTS.md rows.
New tests 19/19 green; CodeRabbit inline gate: no findings.

**Phase 5 — Ship.** `use ship-change skill` archived + synced specs, pushed, opened PR
#226 against `develop`, watched CI (green, 9m42s), triaged 5 CodeRabbit comments (applied 1
real one — escaped `|` breaking an AGENTS.md table; deferred 4 with rationale), re-watched
CI, then squash-merged as `5b9bf2e51` and cleaned up branch + worktree.

## 4. Prompts that worked

- **`doubt review` (the goal prompt).** Terse but effective *because the change context was
  already loaded* — the skill knew which artifacts to attack. A stronger cold-start version:
  *"Doubt-review the `flag-package-source-overrides` proposal — verify its threat model
  against pi's actual `package-manager.js` before trusting the prose."*
- **`commit` (high-leverage).** Forced a checkpoint; the AI correctly declined to fabricate
  a diff and asked what to commit — surfacing that the review was analysis-only.
- **`rescope` (the pivotal one-word steer).** Converted a disproven design into a shipped one
  in a single token, because the AI had already laid out "kept vs dropped" during the doubt
  reconcile.
- **`/skill:openspec-apply-change flag-package-source-overrides`** and **`use ship-change
  skill`** — invoking the named skills directly is the fast path; each carries its own gates.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the proposal's prose as ground truth | Demand `doubt review` before any build | Make source-verification the first step of every proposal review |
| Want to produce a diff on `commit` even with a clean tree | Let the AI *ask* what to commit (it did) | Keep analysis-only reviews explicitly diff-free; commit findings into `design.md` |
| Preserve the full original scope | Say `rescope` to drop the disproven half | State up front which problem(s) survived the doubt cycle, then rewrite ALL artifacts together |
| Treat pre-existing red tests as a ship blocker | Accept that unrelated failures also fail on `develop` (CI is the arbiter) | Diff the failing test files vs `develop`; if byte-identical, they're not yours |
| Auto-apply every CodeRabbit comment | Apply only real, in-scope, safe fixes; defer the rest with written rationale | Triage table: apply localized doc/code fixes in touched rows; defer other-change + archived-snapshot nits |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session *consumed* three existing ones in sequence,
which is the reusable pattern worth capturing:

- **`doubt-driven-review`** — an in-flight adversarial check that verifies load-bearing
  claims against source and spawns a fresh-context reviewer. *Effective because* it caught a
  factually false threat model at proposal stage, saving an entire wasted implementation.
  Invoke it on any irreversible/high-stakes design *before* it stands.
- **`openspec-apply-change`** — TDD task walker with built-in verification + CodeRabbit gate.
- **`ship-change`** — archive → PR → CI-watch → CodeRabbit-triage → squash-merge → cleanup.

**Recommended skill to create:** a `proposal-rescope` micro-procedure — *"when a doubt
review disproves part of a change, rewrite proposal + design + tasks + spec-delta + mockup
in one pass and delete the orphaned CSS/props/scenarios your cuts create."* This session
did it by hand across five artifacts; it's clearly repeatable.

## 7. Pitfalls & dead ends

- **Test isolation:** a plain `npx vitest run` can pick up pi's real `$HOME` config. Fix:
  `HOME=$(mktemp -d) npx vitest run …`.
- **Worktree jimp install-state artifact:** `image-fit-extension` tests failed because the
  worktree resolved jimp 0.16.13 while the package needs 1.x — jimp was simply *missing* from
  the worktree `node_modules`. Fix: `npm install` in the worktree; then the suite goes green.
  This is an install-state artifact, not a code regression (CI installs clean).
- **Pre-existing red gates:** `node-electron-resolution.test.ts` (packages/shared) and a
  `linkify` perf-timing flake fail identically on `develop`. Don't block the ship on failures
  in files your branch never touches — diff them vs `develop` to confirm.
- **`--delete-branch` after squash-merge:** the local `-d` refuses because squash creates a
  new SHA (branch looks "unmerged"); the worktree-collision pitfall also bites (`develop`
  checked out in parent). Force-delete after verifying the remote merge landed.
- **Deleted-worktree cwd:** once the worktree is removed, the Bash tool can't spawn from the
  now-missing cwd — run final cleanup from the parent repo or the sandbox shell.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; `gh auth` logged in; the pi bundled
`package-manager.js` path (for source verification); a clean worktree with `npm install` run.

- [ ] `doubt review` the change at proposal/design stage.
- [ ] Grep pi's real `package-manager.js` (`checkForAvailableUpdates`, `operations.update`) to verify the threat model.
- [ ] Spawn `Explore` as an adversarial reviewer; re-verify its central doubt against source.
- [ ] Record findings into `design.md` (direct edit — it's under `openspec/`), commit, leave proposal/tasks intact.
- [ ] `rescope`: rewrite all five artifacts together; delete orphaned CSS/props/scenarios.
- [ ] `/skill:openspec-apply-change <name>` — TDD: helper+classifier+unit → pill+component tests → wiring → AGENTS.md rows.
- [ ] `HOME=$(mktemp -d) npx vitest run …` for isolated test runs.
- [ ] `use ship-change skill`: archive+sync → PR vs `develop` → watch CI → triage CodeRabbit (apply in-scope only) → squash-merge → cleanup.

**Artifacts produced:** `openspec/changes/flag-package-source-overrides/{proposal,design,tasks}.md` +
`specs/pi-core-version-ui/spec.md` + `mockups/index.html`;
`packages/client/src/lib/package-classifier.ts` (+ test);
`packages/client/src/components/{PackageRow,UnifiedPackagesSection,InstalledPackagesList,PackageBrowser}.tsx`;
`PackageRow.override.test.tsx`; AGENTS.md rows/sidecars. Merged as `5b9bf2e51` via PR #226.

---

_Generated from session `019f2adf-b783-732f-a916-ba69e611edd1` · `pi-agent-dashboard` · 2026-07-04. Source extract: `/tmp/facts-49166-1784847724.md`._
