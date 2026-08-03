---
session: 019e0987
week: 2026/W19
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (10 user prompts)"
upgrade_status: pending
openspec_changes: [replace-tsx-with-jiti, unify-opsx-colon-hyphen-aliases]
proposal_excerpt: "The dashboard server already uses jiti as its primary TypeScript loader at every runtime spawn site (extension server-launcher.ts, server cli.ts cmdStart daemon spawn, electron launch-source.ts spawnFromSource)."
---

# How we did it: retire `tsx`, scope it to the bin entry, and land jiti-only — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a doubt, not a task: `"check proposal replace-tsx-with-jiti
relevance. Maybe it is not needed anymore"`. The real objective that emerged over the
next ten prompts: **re-ground a half-shipped OpenSpec proposal against the code that
actually exists on `develop`, shrink its scope to the one thing still undone (the CLI
bin entry), then implement, build, and archive it.** Most of the migration (shared
`resolveJitiImport()` helper, extension + server + electron spawn sites) had already
landed in prior work — so the job was less "build a feature" and more "make the spec
tell the truth, then finish the last 5%."

## 2. TL;DR playbook

1. **Audit before editing.** `grep -rn "tsx"` across `package.json` + every spawn site
   and `grep -n "jiti\|resolveJiti"` to see what already shipped. Do not trust the
   proposal — trust the tree.
2. **Report the gap out loud**: what's done (✅), what's pending (❌), and where the
   proposal's premise no longer holds (tsx deliberately retained as non-pi fallback).
3. **Reframe the proposal** to the residual scope (shebang + JS wrapper), mark shipped
   tasks `[x]` with concrete `file:line` evidence, delete fully-shipped delta specs.
4. **Commit only your files** with `git add openspec/changes/replace-tsx-with-jiti/`
   then `git commit --no-verify` — a prepare-commit-msg hook re-stages siblings.
5. **Apply the change** (`/opsx:apply`): implement the wrapper + shebang + package.json
   bin repoint, guided by the existing test fixture.
6. **Reconcile scope drift**: the tasks/proposal were rewritten in parallel to jiti-only
   (no tsx fallback). Rewrite the wrapper to match the spec + the test, not the older plan.
7. **Verify**: `npm test 2>&1 | tee /tmp/pi-test.log`; separate pre-existing failures
   (a locally-deleted `effective-status.sh`) from your own.
8. **Build the installer** (`bash packages/electron/scripts/build-installer.sh`), confirm
   the DMG artifact.
9. **Archive** (`/opsx:archive`): delegate spec-sync to a subagent, validate `--strict`,
   commit.

## 3. How the collaboration unfolded

**Phase 1 — Relevance audit (Discovery).** The AI resisted the temptation to just
"update the proposal" and instead grepped the tree first: spawn sites, `tsx` refs,
the `resolveJitiImport()` helper. It produced a crisp done/pending/conflict report and
surfaced the key insight — the architecture *deliberately keeps tsx as the non-pi
fallback*, so the proposal's "remove tsx entirely" premise was already false. **Why it
worked:** grounding a stale proposal in live code before touching it prevents writing
fiction into the spec.

**Phase 2 — Reframe + commit (Design).** On `"update proposal"`, the AI rewrote
proposal/tasks/design to the residual scope, marked shipped tasks with `file:line`
evidence, and deleted the fully-shipped `bridge-extension` delta spec. On `"commit
changes"` it hit a prepare-commit-msg hook that re-staged unrelated `unify-opsx` files
and mangled the message; it recovered by staging only its own files and using
`--no-verify`.

**Phase 3 — Implement (Generate).** On `/opsx:apply` the AI read the spawn helper,
package manifests, and the existing `pi-dashboard-bin-wrapper.test.ts` fixture, then
wrote `bin/pi-dashboard.mjs`, stripped `--import tsx` from the shebang, and repointed
`bin.pi-dashboard`. Mid-flight it noticed the tasks file had been **rewritten in
parallel** to a stricter jiti-only scope with a spec-mandated error message — and a
test already asserted it. It rewrote its wrapper to match the spec + fixture rather than
its own earlier plan.

**Phase 4 — Verify + build.** `npm test` → 7 failures, all traced to a pre-existing
locally-deleted `effective-status.sh` (restored to confirm), then 5289 passing. Electron
Forge produced `PI-Dashboard-darwin-x64-0.5.1.dmg` (208 MB).

**Phase 5 — Archive (Land).** On `/opsx-archive` the AI delegated delta-spec sync to a
`general-purpose` subagent (2 reqs added to packaging, 4 to dashboard-server, new
`jiti-loader` capability), validated `--strict`, and found the archive commit had already
landed via parallel automation (`3b910ec4`). Working tree clean.

## 4. Prompts that worked

- **Goal prompt** — `"check proposal … relevance. Maybe it is not needed anymore"`.
  Effective because it framed the task as *falsifiable doubt*, licensing the AI to audit
  and shrink scope rather than blindly execute a stale plan.
- **`"update proposal"`** — terse, but it worked *because Phase 1 had already produced the
  done/pending/conflict map*; the AI knew exactly what to rewrite.
- **`/opsx:apply` and `/opsx-archive`** — the skill-command prompts carried their own
  procedure, so a two-word context (`replace-tsx-with-jiti` inferred) unlocked a full
  implement/archive workflow.
- **`"it seems ok"` (×3)** — cheap approval gates that let the AI proceed through
  test → build → land without re-explaining each step.

Rewrite of the weak ones: instead of a bare `"commit changes"`, say **"commit ONLY the
`replace-tsx-with-jiti/` files; leave everything else in my tree untouched"** — this
would have pre-empted the hook re-staging siblings.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the proposal as ground truth | `"maybe it is not needed anymore"` — audit the code first | Always grep spawn sites + deps before editing a stale spec |
| Commit the whole dirty tree | (implicit) — commit only proposal files | Say "commit ONLY `<change>/` files" up front |
| Follow its *own* earlier wrapper plan (with tsx fallback) | scope was rewritten in parallel to jiti-only | Re-read tasks.md + the test fixture at the start of each resume turn |
| Count test failures as its own | operator waited; AI traced them | Diff failures against a clean `git stash` / HEAD before blaming your change |
| Add a cosmetic commit (`console.error`→`stderr.write`) | `"There is unstaged file which belongs this"` | Skip cosmetic rewrites when a functionally-equal commit already exists |

Key steering signal: **parallel automation was mutating the same change** (proposal,
tasks, and even the archive commit landed from other automation between turns). The AI
handled it by re-reading disk state each resume instead of assuming its last edit held.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work rode existing OpenSpec skill
commands (`/opsx:apply`, `/opsx-archive`) and one `general-purpose` subagent for
spec-sync. What made it reproducible:

- **The bin-wrapper test fixture** (`pi-dashboard-bin-wrapper.test.ts`) was the anchor:
  it encoded the spec-mandated jiti-miss stderr + exit-1 contract, so when the scope
  drifted the AI could rewrite the wrapper to *pass the test* rather than argue about
  intent. Lesson: a test that pins the contract survives scope churn better than prose.
- **Subagent-delegated spec sync** kept the noisy `## ADDED/REMOVED Requirements` diff
  out of the main context and even fixed a pre-existing authoring bug in `packaging/spec.md`.

Recommendation: a small **"re-ground a stale OpenSpec proposal"** skill would be worth
creating — the audit→reframe→scope-shrink loop in Phases 1–2 is a repeatable pattern.

## 7. Pitfalls & dead ends

- **prepare-commit-msg hook re-stages siblings + mangles the message.** If your commit
  subject comes out wrong and unrelated files appear staged, stage only your paths and
  commit with `--no-verify`.
- **Pre-existing test failures masquerade as yours.** 7 failures were a locally-deleted
  `.pi/skills/openspec-shared/scripts/effective-status.sh`. Restore committed files
  (`git checkout HEAD -- <file>`) before attributing failures to your change.
- **Scope drift under parallel automation.** The proposal + tasks were rewritten between
  turns to jiti-only. Re-read `tasks.md` and the test fixture on every resume; don't
  trust your last-turn mental model.
- **Cosmetic re-commits are noise.** A functionally-equivalent commit (`bb089b8a`) had
  already landed; the `console.error`→`process.stderr.write` diff added nothing but churn.
- **Implicit spec removal.** The packaging delta dropped `Runtime dependency on tsx`
  implicitly instead of via `## REMOVED Requirements` — cleaner authoring uses the
  explicit section.

## 8. Reproduce it faster — checklist

- [ ] `grep -rn "tsx"` deps + `grep -n "jiti\|resolveJiti"` spawn sites → build a
      done/pending/conflict map.
- [ ] Report the map; flag where the proposal's premise no longer holds.
- [ ] Reframe proposal/tasks/design to the residual scope; mark shipped tasks `[x]`
      with `file:line` evidence; delete fully-shipped delta specs.
- [ ] `git add <change>/ && git commit --no-verify` (dodge the sibling-restaging hook).
- [ ] `/opsx:apply` — read the test fixture FIRST, implement to the spec, reconcile any
      parallel scope drift.
- [ ] `npm test 2>&1 | tee /tmp/pi-test.log`; separate pre-existing failures from yours.
- [ ] `bash packages/electron/scripts/build-installer.sh` → confirm the DMG.
- [ ] `/opsx-archive` — delegate spec-sync to a subagent, validate `--strict`, commit.

**Inputs to have ready:** the OpenSpec change name, a clean-ish working tree (or
knowledge of what's pre-existing), the test fixture that pins the contract.

**Artifacts produced:** `packages/server/bin/pi-dashboard.mjs` (jiti-only, exit-1 on
miss), edited `cli.ts` shebang + `package.json` bin; refreshed proposal/tasks/design;
synced `dashboard-server` / `packaging` / new `jiti-loader` specs;
`PI-Dashboard-darwin-x64-0.5.1.dmg`; archived at
`openspec/changes/archive/2026-05-10-replace-tsx-with-jiti/`.

---

_Generated from session `019e0987` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-10. Source extract: deterministic facts sheet (session-to-guideline)._
