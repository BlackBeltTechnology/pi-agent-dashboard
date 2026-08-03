---
session: 019de80b
week: 2026/W18
type: other
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-workspace-publishing]
proposal_excerpt: "The published `@blackbelt-technology/pi-agent-dashboard@0.3.0` is **broken on npm**: a fresh `npm install @blackbelt-technology/pi-agent-dashboard` fails with E404 because the root package declares three workspace dep…"
---

# How we did it: Close out `fix-workspace-publishing` — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The opening prompt was just three words: **"Recheck with current state"** — a bare
reference to the `fix-workspace-publishing` OpenSpec change with no explicit target.
The *real* objective, once the steering turns clarified it: **verify whether the
"broken npm publish" fix had actually shipped, then finish whatever loose ends
remained** — restore the version lockstep that had drifted, archive the completed
change, sync its delta specs into the main specs, and land it cleanly on `develop`.
The fix itself was already in production (v0.3.1 onward, now at v0.4.5); the session
was a **verify-and-close-out**, not a build.

## 2. TL;DR playbook

1. **Reconcile the proposal against reality first.** Run the effective-status check
   and grep the live tree for every claim the proposal makes:
   `grep -rn '"workspace:' package.json packages/*/package.json` (must be zero),
   confirm `scripts/sync-versions.js` exists, confirm `publish.yml` uses
   `--workspaces --include-workspace-root`, confirm `packages/electron` is `private`.
2. **Run the invariant script to find drift.** `node scripts/sync-versions.js` — if it
   exits non-zero with a *lockstep violated* error, one package version has drifted.
3. **Present options, don't assume.** Offer "close out only (no new version)" vs
   "cut a new release that bundles the cleanup" and let the human pick.
4. **Fix the drift with the smallest change.** Bump the one lagging package
   (`packages/jj-plugin` 0.4.4 → 0.4.5) so `sync-versions.js` exits zero.
5. **Sync the delta specs before archiving.** Read both delta specs, append the new
   requirements to the modified capability, build the new-capability spec from its
   delta (strip `## ADDED Requirements`, add a Purpose preamble).
6. **Validate strict, then archive.** `openspec validate <cap> --strict` for each
   spec; then move the change into `openspec/changes/archive/<DATE>-<name>/`.
7. **Commit both together**, push to `develop`. If the push is rejected, `git pull
   --rebase origin develop` then push again.

## 3. How the collaboration unfolded

**Phase 1 — Clarify the ambiguous ask.** The three-word prompt "Recheck with current
state" had no object. The AI correctly *asked what to recheck* rather than guessing,
then — given the OpenSpec context — inferred the target was `fix-workspace-publishing`
and located it (`ls openspec/changes/ | grep -i workspace`).

**Phase 2 — Reconcile proposal claims vs live tree.** The effective move: instead of
trusting the proposal, the AI grepped the repo for every assertion. Zero
`"workspace:"` strings, `sync-versions.js` present and runnable, `publish.yml`
extended well past what the proposal asked (idempotent per-package loop,
skip-if-published, prerelease `--tag next`), `publishConfig.access: public` set,
`electron` private. **Verdict: implementation done, shipped in 0.3.1+**. But running
`node scripts/sync-versions.js` surfaced a **lockstep violation** — `jj-plugin` was at
0.4.4 while everything else was 0.4.5.

**Phase 3 — Decision point (the human chose).** The AI laid out Option A (close out,
no new version) vs Option B (cut 0.4.6 bundling the cleanup). The human's "Is it
possible to make that released?" resolved to **just close it out** — bump the one
package, archive, commit.

**Phase 4 — Spec sync + archive.** Two delta specs existed: a new capability
(`workspace-publishing`) and a modification (`monorepo-workspace-structure`). The AI
appended the new requirements to the modified spec, built the new-capability spec from
its delta, hit a strict-validation error, fixed the Purpose preamble, re-validated
clean, then moved the change to the dated archive folder.

**Phase 5 — Land it.** Committed lockstep-fix + archive together (`4652aa7`). On
"commit" the AI noted it was already committed and asked if the human meant push. Push
was rejected (upstream had a PR merge for an `ask_user` timeout); the AI rebased onto
`e429462` and pushed cleanly as `4120a0d`.

## 4. Prompts that worked

- **The goal prompt — "Recheck with current state"** — weak on its own (no object),
  but effective *because the AI refused to guess* and asked for clarification, then
  used the surrounding OpenSpec context to lock onto the right change. **Stronger
  version:** *"Recheck the `fix-workspace-publishing` OpenSpec change against the
  current tree — is it fully shipped, and are there loose ends to close out?"*
- **"Is it possible to make that released?"** — a high-leverage pivot: it turned a
  status report into an action plan. The AI responded with two concrete, costed
  options rather than a yes/no.
- **"commit"** — a one-word close-out that worked because the AI had already staged the
  logical unit; it correctly reinterpreted it as "push" when the work was already
  committed.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Not know what "recheck" targeted | Rely on OpenSpec context (implicit) | Name the change explicitly in the goal prompt |
| Report status and stop | "Is it possible to make that released?" | Ask for the *close-out plan*, not just a verdict |
| Leave the fix committed but unpushed | "commit" → clarified to *push* | Say "commit and push to develop" up front |
| Present multiple release options | Human picks (Option A) | State the release intent (new version vs close-out) in the ask |

The core guardrail: on a **verify-and-close-out** task, tell the AI the *end state*
you want (specs synced, change archived, pushed to `develop`) — otherwise it will
correctly stop at "here's the status" and wait.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it was a routine application of
existing OpenSpec skills. The repeatable pattern used:

- **`openspec-shared/scripts/effective-status.sh <change>`** — the fastest way to see
  whether a change's tasks are effectively done against the tree.
- **`node scripts/sync-versions.js`** — the lockstep invariant guard; run it *before*
  any release-adjacent work to catch version drift early (it exits non-zero and names
  the violation).
- **`openspec-archive-change`** — sync delta specs + move to dated archive in one step.

If a version *does* drift again mid-flight, this exact verify → fix-drift → sync-specs
→ archive → rebase-push sequence is worth capturing as a "close out an OpenSpec
change" skill.

## 7. Pitfalls & dead ends

- **`openspec validate workspace-publishing --strict` failed** the first time — the
  new-capability spec built from the delta was missing its standard **Purpose
  preamble**. Fix: add the preamble, then re-validate. Don't just strip
  `## ADDED Requirements` and stop.
- **`git push origin develop` was rejected** — upstream had advanced (a PR merge for an
  `ask_user` prompt timeout, `e429462`). Fix: `git pull --rebase origin develop` then
  push; the rebase landed as `4120a0d`. Never force-push over a rejected `develop`.
- **`private: true` packages still need version bumps.** `jj-plugin` drifted precisely
  *because* it's private and the `npm version --workspaces` step missed it once.
  Lockstep applies to private packages too — always run `sync-versions.js` after a bump.
- **A bare "commit" after work is already committed** is ambiguous — the AI read it as
  "push," which was right here, but state the verb you mean.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name, write access to `develop`, a clean
working tree.

- [ ] `.pi/skills/openspec-shared/scripts/effective-status.sh <change>` — confirm tasks done
- [ ] Grep the tree for every proposal claim (`"workspace:"` count, script presence, `publish.yml` flags, `private` on electron)
- [ ] `node scripts/sync-versions.js` — catch version drift (must exit zero)
- [ ] Bump the lagging package to restore lockstep (smallest change)
- [ ] Read both delta specs; append new requirements to the modified capability; build the new-capability spec (strip `## ADDED Requirements`, add Purpose preamble)
- [ ] `openspec validate <cap> --strict` for each spec — clean
- [ ] Archive: `mkdir -p openspec/changes/archive && mv openspec/changes/<name> openspec/changes/archive/<DATE>-<name>`
- [ ] `git add -A && git commit` (lockstep fix + archive together)
- [ ] `git push origin develop`; if rejected → `git pull --rebase origin develop` then push

**Artifacts produced:**
- `packages/jj-plugin/package.json` (0.4.4 → 0.4.5, lockstep restored)
- `openspec/specs/monorepo-workspace-structure/spec.md` (+2 requirements, Purpose repaired)
- `openspec/specs/workspace-publishing/spec.md` (new capability, created)
- `openspec/changes/archive/2026-05-02-fix-workspace-publishing/` (archived change)
- Commits `4652aa7` → rebased/pushed as `4120a0d` on `develop`

---

_Generated from session `019de80b` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-02. Source extract: session facts sheet (mktemp)._
