---
session: 019e6c34
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (16 user prompts)"
upgrade_status: pending
openspec_changes: [bump-pi-compat-to-0-76]
proposal_excerpt: "Pi 0.76.0 was published 2026-05-27 (same day as the 0.75 floor bump). The 0.75 → 0.76 delta is small from the dashboard's perspective — no Node-floor bump, no breaking surface the dashboard exercises (the one Breaking…"
---

# How we did it: Bump the pi-coding-agent compatibility floor to 0.76.0 — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single skill invocation:

> `/skill:openspec-apply-change bump-pi-compat-to-0-76`

The real objective, clarified over the session, was: **apply an already-planned OpenSpec
change that lifts the dashboard's `piCompatibility` floor from 0.75.0 to 0.76.0 across
every source of truth, get the whole CI + Electron matrix green on a PR, then archive the
change and sync its delta spec** — all while committing/pushing **only on explicit human
go-ahead** and **never using `jj` (jujutsu)**. It's a small, mechanical version-bump change
whose difficulty is entirely in the *lockstep* (package.json + lockfile + test table +
CHANGELOG + spec) and the *process discipline* (CI, archive, commit gating).

## 2. TL;DR playbook

1. Run `/skill:openspec-apply-change bump-pi-compat-to-0-76`; let it read `proposal.md` +
   `tasks.md` first.
2. Edit every version source of truth in lockstep: `packages/server/package.json`
   (`piCompatibility.minimum` + `recommended` + the `@earendil-works/pi-coding-agent` dep),
   the `bundled-node-meets-pi-floor.test.ts` lookup table (add the new `"0.76.0"` row), and
   `CHANGELOG.md` (Unreleased → Changed).
3. Run the targeted tests only: `npm test -- pi-version-skew bundled-node-meets-pi-floor`.
4. **Regenerate the lockfile** — `npm install --package-lock-only` — because a `package.json`
   dep bump leaves `package-lock.json` pinning the old version and CI goes red. Verify with
   `node scripts/verify-lockfile-versions.mjs`.
5. Stage, then **wait for explicit "commit and push"** before any git write. Open the PR
   against `develop` with `gh pr create`.
6. Tick the completed boxes in `tasks.md`; leave manual pre-merge (Phase 5) and post-merge
   (Phase 7) gates unchecked with a reason.
7. Dispatch the Electron matrix on demand: `gh workflow run ci-electron.yml --ref <branch>
   -f legs=all`, then poll `gh run view <id>` until `completed`.
8. When CI + all 6 Electron legs are green, `/skill:openspec-archive-change
   bump-pi-compat-to-0-76`: `git mv` the change dir under
   `openspec/changes/archive/<date>-<name>/`, sync the delta into
   `openspec/specs/pi-core-version-check/spec.md`, `openspec validate <spec> --strict`.
9. Commit + push the archive **with `git`, on explicit go-ahead**.

## 3. How the collaboration unfolded

**Phase A — Apply the version bump (Discovery + Edit).** The AI read the proposal/tasks,
then discovered that **Phase 2's target files did not exist** in this branch:
`packages/electron/resources/bundled-extensions/` was absent and a catch-all
`grep -rn '0\.75' … --include='package.json'` returned zero hits. Rather than fabricate
edits, it correctly treated Phase 2 as a no-op and flagged the drift ("the proposal was
authored against a tree state that included those manifests"). It edited the three real
sources of truth and ran the two targeted test suites (27 passed). *Why it worked:* editing
by "source of truth" not by "file the proposal named", and refusing to invent work for a
phase whose inputs were gone.

**Phase B — Discover the branch has no commits (first steering).** The human fed back a
`gh pr create` failure: *"No commits between develop and bump-pi-compat-to-0-76"*. The AI's
edits were still unstaged — it had described the change as "shipped" while nothing was
committed. It staged, committed, and opened **PR #42**, while spotting that `.pi/settings.json`
showed modified as an **environment artifact** (bridge's relative→absolute path rewrite) and
excluding it. *Decision point:* the human owns the commit trigger.

**Phase C — Two process guardrails imposed.** The human interjected twice: *"do not use J"* /
*"do not use jj and commit"*. The AI acknowledged: **no `jj`, and don't auto-commit — stop at
staged edits and wait for go-ahead.**

**Phase D — CI red → lockfile root cause.** After the smoke/Electron request, CI came back
all red. The AI read the failed job log and diagnosed: **`package-lock.json` still pinned
`pi-coding-agent` 0.74.1** while `package.json` said 0.76.0. It regenerated with
`npm install --package-lock-only`, confirmed `verify-lockfile-versions.mjs` passed, re-ran
smoke, staged, and waited. *Why it worked:* it read the actual failing-job log rather than
guessing, and re-verified locally before asking to push.

**Phase E — Electron matrix on demand + poll.** The AI dispatched `ci-electron.yml`
(`legs=all`) and polled a `gh run view … --json status,conclusion` loop. All 6 legs
(darwin-arm64/x64, linux-x64/arm64, win32-x64/arm64) went green in ~9 min; PR #42 CI (ci +
standalone-install-smoke across nodes/distros/windows) was also green.

**Phase F — Archive + spec sync.** On `/skill:openspec-archive-change`, the AI `git mv`'d the
change dir to `openspec/changes/archive/2026-05-28-bump-pi-compat-to-0-76/`, synced the delta
into `openspec/specs/pi-core-version-check/spec.md` (flipping 0.75.x scenarios to 0.76.x), and
ran `openspec validate pi-core-version-check --strict` (clean; the 157 `--all` failures were
pre-existing and unrelated). Three more *"no jj … git commit and push"* nudges were needed
before it pushed the archive commit.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change bump-pi-compat-to-0-76`.** Effective because
  the change was already planned; the skill carries the phase structure. *Stronger version:*
  prepend the standing rules so they don't have to be corrected mid-flight — e.g.
  *"Apply bump-pi-compat-to-0-76. Use git only (never jj). Stage edits and wait for my
  explicit 'commit and push' before any git write. Regenerate the lockfile after any dep
  bump."*
- **High-leverage follow-up — `perform smoke tests and electron builder on CI`.** One line
  that expanded scope to the full verification matrix and surfaced the lockfile bug that
  local tests alone missed.
- **`poll`** — a single word that told the AI to run the `gh run view` watch-loop instead of
  handing back and forth.
- **`defer tests and mark done`** — cleanly closed out the manual-smoke gate (CI smoke
  covers it) without leaving `tasks.md` in limbo.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Call the change "shipped/applied" while edits were still **unstaged** (no commits) | Feeding back the `gh pr create` "No commits between…" error | State up front: staging ≠ shipping; verify `git log develop..HEAD` before claiming done |
| Reach for `jj` (jujutsu) to commit | *"do not use J"*, *"do not use jj and commit"*, and 3× *"no jj … git commit and push"* | Put **"git only, never jj"** in the kickoff prompt / a project memory |
| Auto-commit/push without asking | *"do not use jj and commit"* → wait for go-ahead | Kickoff rule: "stop at staged edits; commit only on my explicit word" |
| Bump `package.json` but leave `package-lock.json` stale → CI red | *"perform smoke tests and electron builder on CI"* exposed it | Always `npm install --package-lock-only` + `verify-lockfile-versions.mjs` after any dep bump |
| Treat a missing proposal phase as a blocker | (self-corrected) flagged Phase 2 files absent, marked N/A | Confirm tree reality before executing proposal phases; missing inputs → N/A + flag |

Also worth internalizing: `.pi/settings.json` showing "modified" is an **environment
artifact** (bridge path rewrite) — never stage it.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work rode existing skills:

- **`openspec-apply-change`** — carried the phase structure of the version bump; the AI's job
  was to reconcile each phase against actual tree state.
- **`openspec-archive-change`** — handled the `git mv`-to-archive + delta-spec sync + strict
  validate.

**Recommended memory to save** (it was corrected 5× in one session):
> *"In this repo, use `git` for all VCS operations — never `jj`/jujutsu. Stage edits and wait
> for an explicit 'commit and push' before any git write."*
Saving this as a project/user memory would have eliminated a third of the steering turns.

**Recommended skill** (if not already present): a **`bump-pi-version`** procedure that lists
every version source of truth in lockstep (`packages/server/package.json` compat block + dep,
`bundled-node-meets-pi-floor.test.ts` table, `CHANGELOG.md`, and the lockfile regen) so the
lockfile-staleness CI red is avoided by construction. (One exists under project memory skills;
invoke it on any "bump pi to X.Y.Z".)

## 7. Pitfalls & dead ends

- **"Shipped" with zero commits.** If you claim the change is done, first run
  `git log --oneline develop..HEAD` — unstaged edits are not a PR.
- **Lockfile staleness → all-red CI.** A `package.json` dep bump alone leaves
  `package-lock.json` on the old version. Fix: `npm install --package-lock-only`, then
  `node scripts/verify-lockfile-versions.mjs`. Read the *failed job log*
  (`gh run view <id> --log-failed --job <jobId>`) to confirm rather than guess.
- **Proposal phase whose files don't exist** (`bundled-extensions/`). Don't invent edits —
  mark N/A, flag that the proposal was authored against a different tree state.
- **`jj` reflex.** This operator uses plain `git`; reaching for `jj` cost 5 correction turns.
- **`.pi/settings.json` noise.** Always modified by the bridge; never part of a change.
- **`openspec validate --all` shows 157 failures** — pre-existing and unrelated; validate the
  single spec (`openspec validate pi-core-version-check --strict`) to judge your change.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name, `gh` authenticated, the target branch,
knowledge that this repo is **git-only (no jj)** and **commit-on-explicit-word-only**.

- [ ] `/skill:openspec-apply-change <change>` — read proposal + tasks first
- [ ] Edit lockstep: `packages/server/package.json` (compat min/recommended + pi dep),
      `bundled-node-meets-pi-floor.test.ts` (new version row), `CHANGELOG.md`
- [ ] Any proposal phase with missing files → mark N/A + flag
- [ ] `npm install --package-lock-only` && `node scripts/verify-lockfile-versions.mjs`
- [ ] `npm test -- pi-version-skew bundled-node-meets-pi-floor`
- [ ] Stage; **wait for explicit "commit and push"**; `git commit` + `git push` (never `jj`)
- [ ] `gh pr create --base develop`; exclude `.pi/settings.json`
- [ ] Tick `tasks.md`; leave manual/post-merge gates unchecked with a reason
- [ ] `gh workflow run ci-electron.yml --ref <branch> -f legs=all`; poll `gh run view <id>`
- [ ] All CI + 6 Electron legs green → `/skill:openspec-archive-change <change>`
- [ ] `git mv` to `openspec/changes/archive/<date>-<name>/`; sync delta into
      `openspec/specs/pi-core-version-check/spec.md`; `openspec validate <spec> --strict`
- [ ] Commit + push archive on explicit go-ahead

**Final artifacts:** PR #42 (bump + lockfile + tasks-tick + archive commits),
`openspec/changes/archive/2026-05-28-bump-pi-compat-to-0-76/`, synced
`openspec/specs/pi-core-version-check/spec.md`.

---

_Generated from session `019e6c34` · `pi-agent-dashboard/.worktrees/bump-pi-compat-to-0-76` · 2026-05-28. Source extract: `/tmp/session_facts.PFQtob.md`._
