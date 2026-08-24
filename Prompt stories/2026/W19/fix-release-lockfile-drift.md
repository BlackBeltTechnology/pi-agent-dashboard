---
session: 019e0d84
week: 2026/W19
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-release-lockfile-drift]
proposal_excerpt: "Every release cut via `.github/workflows/publish.yml`'s `prepare` job ships with a **stale `package-lock.json`** because the workflow bumps every workspace's `package.json` version + cross-ref specifiers but never reg…"
---

# How we did it: fix-release-lockfile-drift — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was the OpenSpec `/opsx:apply` command targeting the change
`fix-release-lockfile-drift`. The *real* objective, once the proposal is read: every
release cut through `.github/workflows/publish.yml`'s `prepare` job was shipping a
**stale `package-lock.json`**. The workflow bumped every workspace's `package.json`
version and rewrote cross-ref dependency specifiers, but never regenerated the
lockfile — so published releases carried a lockfile that no longer matched the very
versions they claimed. The task: close that drift *in the pipeline*, add a machine
gate that fails the job when it recurs, and lock the fix behind a repo-lint contract
test so it can't silently regress.

## 2. TL;DR playbook

1. `openspec status --change fix-release-lockfile-drift --json` then
   `openspec instructions apply --change ... --json` to load tasks + context paths.
2. Split the monolithic dispatch step in `publish.yml` into discrete, greppable
   steps (the contract lint finds steps by `run` content, so ordering must be
   inspectable).
3. Insert two new steps **between** `sync-versions.js` and the release commit:
   `npm install --package-lock-only --no-audit --no-fund` (regen) then
   `node scripts/verify-lockfile-versions.mjs` (gate).
4. Write the ~30-LOC `scripts/verify-lockfile-versions.mjs` sanity gate: fail if any
   `packages/<ws>` cross-ref specifier ≠ `^<root.version>`.
5. Prove the fix by simulating the real release sequence locally against a throwaway
   version bump — `git stash`/`npm version --no-git-tag-version`/restore — never on
   the real tree.
6. Extend `publish-workflow-contract.test.ts` with a `parseJobSteps()` helper +
   assertion that ordering is `sync < regen < commit`.
7. Update `release-cut/SKILL.md` (local bump now runs `--package-lock-only`) and the
   two AGENTS.md rows (≤200 chars, no change-history — detail rows go to the doc-tree
   via a subagent).
8. Mark tasks done, run full `npm test`, `/opsx-verify`, `/opsx-archive` (syncs the
   delta requirement into the main spec), then a surgical `commit`.

## 3. How the collaboration unfolded

**Discovery → load the spec.** The AI ran `openspec status` + `instructions apply`
to pull the 14-task list and context file paths. No guessing — the workflow itself
tells it which files matter.

**Implement in place.** It edited `publish.yml` to break the single dispatch step
into six ordered steps, then authored the new verify script. *Why this worked:* the
existing contract test locates steps by `run` content, so a monolithic step is
invisible to the lint — splitting it is a prerequisite, not cosmetics.

**Prove without polluting.** The decisive move was proving task 6 end-to-end by
*simulating* a real release: `git stash` the version files, `npm version 0.5.99
--no-git-tag-version`, run the full sync→regen→verify sequence, then restore from
`/tmp` backups. The verify script even surfaced a **pre-existing** drift in
`packages/honcho-plugin` (0.5.0 vs root 0.5.1) — correctly flagged, correctly ruled
out-of-scope.

**Lock it behind a test.** A `parseJobSteps()` helper + a new assertion enforce the
`sync < regen < commit` ordering, so the fix can't regress silently.

**Verify → Archive → Commit.** Steering prompts 2–4 drove `/opsx-verify` (14/14 tasks,
4/4 scenarios), `/opsx-archive` (which synced the new requirement into the main
`ci-cd-pipeline` spec), and finally a **surgical** commit that staged only the
lockfile-related AGENTS.md hunk while leaving an unrelated hunk intact in the tree.

## 4. Prompts that worked

- **The goal prompt** (`/opsx:apply fix-release-lockfile-drift`): effective because it
  points the AI at a fully-specified OpenSpec change — the proposal, tasks, and
  scenarios are already written, so the AI executes rather than invents. A strong
  kickoff for pipeline work is *"apply this change; prove each task before checking
  it off; simulate the release locally, never mutate the real tree."*
- **High-leverage follow-ups**: the three one-liner slash commands (`/opsx-verify`,
  `/opsx-archive`) and the terminal `commit` each unlocked a whole phase with no extra
  hand-holding — because the discipline was already baked into the change artifacts
  and the repo's skills.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Consider committing the whole working tree | terminal prompt `commit` (relying on surgical-change doctrine) | State up front: "commit only my change's hunks; leave unrelated hunks in the tree" |
| Treat the delta requirement as auto-syncable | `/opsx-archive` flow paused to confirm appending the new requirement to the main spec | Expect archive to surface un-synced delta requirements; pre-approve the sync |
| Put per-file change-history into AGENTS.md | project doc-update protocol (rows ≤200 chars, detail → doc-tree via subagent) | Route detail rows to the directory doc-tree via a subagent from the start |

The most reusable guardrail here is **surgical commit hygiene**: AGENTS.md had an
unrelated `resolve-jiti.ts → server-launcher.ts` hunk. The AI backed up the full
working-tree file, `git checkout HEAD -- AGENTS.md`, applied only its own hunk,
staged it, then restored the full file — so the unrelated change survived in the tree
and only the lockfile hunk landed in commit `eda57a3e`.

## 6. Skills, tools & memory created — and why they're effective

No new skill/memory was created, but the workflow leaned on three durable assets:

- **`scripts/verify-lockfile-versions.mjs`** (new, ~30 LOC) — the reusable *problem
  solver*: it turns "did the lockfile drift?" from a human eyeball check into a
  job-failing gate. Invoke it in any release-prep sequence after `sync-versions.js`.
- **`publish-workflow-contract.test.ts` + `parseJobSteps()`** — captures step-ordering
  as an executable invariant so a future workflow edit can't reorder regen/commit.
- **The doc-update protocol + subagent** — kept AGENTS.md terse while offloading
  per-file detail to the doc-tree.

*Recommended skill to create:* a `release-lockfile-preflight` project skill that
codifies the stash→bump→sync→regen→verify→restore local simulation, since it's the
exact dance any future release-pipeline change will need.

## 7. Pitfalls & dead ends

- **Bare `node scripts/verify-lockfile-versions.mjs` failed first** because the
  lockfile hadn't been regenerated yet — run `npm install --package-lock-only` *before*
  verifying (the fix is literally to order these two steps).
- **`npx vitest` picked up the real `$HOME`** and behaved inconsistently — re-run with
  `HOME=$(mktemp -d) npx vitest run ...` to isolate the environment.
- **Pre-existing `honcho-plugin` version drift** will trip the verify script — it's a
  real bug, but *out of scope* for this change; don't try to "fix" versions inside a
  pipeline change.
- **Don't test task 6 on the live tree** — use `git stash` + `/tmp` backups and
  restore; a mutated `package.json`/`package-lock.json` is easy to leave dirty.

## 8. Reproduce it faster — checklist

- [ ] `openspec status` + `instructions apply --json` → load tasks & paths.
- [ ] Split `publish.yml` dispatch into greppable steps.
- [ ] Add regen (`npm install --package-lock-only --no-audit --no-fund`) + verify
      (`node scripts/verify-lockfile-versions.mjs`) between sync and commit.
- [ ] Simulate the release locally (stash → `npm version --no-git-tag-version` →
      sequence → restore); confirm verify catches drift.
- [ ] Add the `parseJobSteps()` ordering assertion to the contract test.
- [ ] Update `release-cut/SKILL.md` + AGENTS.md rows (≤200 chars); detail → doc-tree.
- [ ] `npm test` (expect full green), `/opsx-verify`, `/opsx-archive` (syncs the delta
      requirement), surgical `commit` of only your hunks.

**Inputs to have ready:** the OpenSpec change `fix-release-lockfile-drift`, write
access to `.github/workflows/publish.yml`, a clean tree (or willingness to stash).
**Artifacts produced:** `scripts/verify-lockfile-versions.mjs` (new); edits to
`publish.yml`, `scripts/sync-versions.js`, `publish-workflow-contract.test.ts`,
`release-cut/SKILL.md`, `AGENTS.md`; commit `eda57a3e` (+221/-21).

---

_Generated from session `019e0d84-6fee-76d2-ae87-9a37df62e866` · `pi-agent-dashboard` · 2026-05-09. Source extract: session facts sheet._
