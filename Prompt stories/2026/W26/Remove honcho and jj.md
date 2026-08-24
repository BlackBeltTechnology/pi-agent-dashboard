---
session: 019f05da
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-plugin-config-write-persistence, add-bundle-manual-launch-scripts, pi-log-miner-skill]
proposal_excerpt: "Plugin settings-section saves never persist. Every plugin settings form commits by sending the WebSocket message `plugin_config_write` (cast `as never` — it is not in the browser-protocol union). **No server handler c…"
---

# How we did it: Remove honcho and jj — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened in **explore mode** (the `openspec-explore` skill prompt) and then,
in the very next breath, wanted two whole feature areas gone: the `honcho` memory plugin
and the `jj` (Jujutsu VCS) plugin, plus every reference to them across the monorepo. The
real objective — clarified by the two terse steering turns that followed (`fix`, then
`commit`) — was a **complete, surgical removal**: delete the plugin packages, unwind every
wire-up woven into the shared types / server routes / extension bridge / client, keep the
tree typechecking and the full test suite green, leave `openspec/changes/archive/` alone as
a historical record, and land it in a single clean commit — touching nothing unrelated.

## 2. TL;DR playbook

1. **Map before you cut.** Grep the whole tree for both names (`honcho`, `jj`, plus
   camelCase variants `Jj`, `JjState`, `JjWorkspace`, `pi-memory-honcho`, `sample-jj`).
   Count refs per component so you know the blast radius (here: ~1,542 honcho + ~2,118 jj
   hits in `.ts/.tsx`).
2. **Classify each ref**: *whole package to delete* vs *core-woven wire-up to surgically
   unwind* vs *comment/fixture/test-string to neutralize*. `jj` was far deeper than
   `honcho` — it lived in the `Session` type, the WS protocol, session grouping, and
   diff-base selection.
3. **Get explicit sign-off on behavioral boundaries** before editing (what to keep vs
   delete, and that `archive/` is off-limits). Present a DELETE / SURGERY / NEUTRALIZE plan.
4. **Delete whole dirs first**, then do the shared-contract surgery (types → protocol →
   grouping → diff), then ripple outward to server → extension → client.
5. **Regenerate anything generated.** The client plugin registry is built by
   `scripts/generate-plugin-registry.mjs`; deleting plugin dirs + rerunning it handles the
   client wiring automatically.
6. **Typecheck as your tripwire**: `npx tsc --noEmit | grep 'error TS'`. Remaining errors
   point straight at the next file to fix. Separate *your* errors from *pre-existing* ones.
7. **Delegate the prose.** Hand docs / openspec-spec cleanup to `general-purpose`
   subagents (caveman-style per the docs protocol) so your context stays on the code.
8. **Regenerate the lockfile** (`npm install`, clearing stale workspace symlinks) and run
   the full suite (`npm test`) until green — then commit, explicitly excluding files you
   didn't touch.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & scope map (Prompt 1).** Despite the explore-mode framing, the AI
correctly treated this as a *large destructive removal* and refused to touch anything
until it had mapped the footprint. It ran repo-wide greps, counted refs, and produced a
component-by-component footprint (whole plugin packages vs core-woven jj VCS support vs
supporting skills/fixtures/docs). *Why it worked:* mapping first turns a 259-file change
into a bounded plan instead of a whack-a-mole of broken imports. **Decision point:** the AI
paused and asked for boundary decisions (full removal? keep archive?) via `ask_user`.

**Phase 2 — Contract surgery (shared → server → extension → client).** With sign-off, the
AI deleted whole dirs, then edited the shared package first because it ripples everywhere:
dropped the `JjState` interface + `Session.jjState`, the `jj_state_update` protocol message
and its union entry, the `pi-memory-honcho` recommended extension, the jj tool-registry
entry, and the `vcsKind: "jj"` union. It then followed the dependency graph outward —
server (`session-diff.ts`, `session-scanner.ts` reading `meta.jjState`, `resolve-order-key`),
extension bridge (`vcs-info.ts`, `model-tracker.ts` `sendJjStateIfChanged`, `bridge.ts`
wiring), then client. *Why it worked:* editing the type surface first makes `tsc` list
every downstream break for free.

**Phase 3 — Generate & typecheck loop.** Regenerated the plugin registry, ran
`tsc --noEmit`, and used the error list as a worklist. It repeatedly **distinguished its own
breakage from pre-existing failures** (the `plugin-config-write.test.ts` tsc errors and the
`publish-allowlist` failure were confirmed pre-existing by checking `git status` / that the
file was untouched). **Decision point:** whole jj-only test files (`session-diff-vcs`,
`session-grouping`) were *deleted*; mixed files (`session-grouping-worktree`) were *stripped*
of only their jj cases.

**Phase 4 — Prose cleanup via subagents.** Docs and `openspec/specs/` prose were delegated
to three `general-purpose` subagents (strip docs, strip openspec specs, genericize the
honcho example in the `external-dashboard-plugins` change → subagents pairing). *Why it
worked:* prose editing is context-cheap to describe but token-heavy to do; isolating it kept
the main context on code.

**Phase 5 — Lockfile, final sweep, commit (Prompts 2 & 3).** `fix` steered the AI to also
clear the two *pre-existing* red tests it had been carefully working around, so the commit
would land fully green. It regenerated the lockfile (clearing stale node_modules symlinks),
ran a zero-reference final sweep, got `8028 passed`, then on `commit` staged everything
**except three unrelated files** (`.pi/settings.json`, a `.bak-reconcile` backup,
`docs/examples/c4-example.md`) and committed 259 files as
`chore: remove honcho and jj plugins and all references`.

## 4. Prompts that worked

- **The goal prompt** (opened via the `openspec-explore` skill): the explore framing was
  actually a *mismatch* for a destructive removal — the AI had to override the "don't
  implement" stance. A stronger kickoff: *"Remove the honcho and jj plugins and every
  reference across the monorepo. First map the footprint and give me a DELETE / SURGERY /
  NEUTRALIZE plan with behavioral boundaries; don't edit until I sign off. Keep
  `openspec/changes/archive/` untouched."*
- **`fix`** — a one-word high-leverage unlock. In context it meant *"stop working around the
  two pre-existing red tests — actually fix them so the commit is green."* Effective because
  the AI had already isolated and explained those failures, so a single token resolved them.
- **`commit`** — trusted the AI to self-select the changeset. It worked only because the AI
  had already tracked which files were its own vs unrelated; the AI correctly excluded the
  three files it hadn't authored.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stay in explore-mode "don't implement" stance | Just issue the removal as the goal | State up front: "this is an implementation task, exit explore stance" |
| Work *around* pre-existing red tests (leave them failing) | `fix` — clear them too | Say "the commit must land fully green, fix any pre-existing failures you touch" |
| Wait for confirmation on which files to stage | `commit` | Pre-authorize: "commit everything you changed, exclude anything you didn't author" |
| Treat `jj` as a mere plugin | (AI self-corrected) surfaced that jj is woven into `Session`/protocol/grouping/diff | State that a removal may have *behavioral* consequences and ask for a plan |

The two steering turns were minimal because Phase 1's up-front plan + boundary questions did
the heavy lifting. The lesson: **front-load the boundary decisions and the "green commit"
quality bar, and the rest collapses to one-word confirmations.**

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were created this session. The workflow is, however, **clearly
repeatable** — a large "excise a feature and all its references from a monorepo" removal.
Consider creating a project skill, e.g. **`excise-feature`**, that captures:
- the map → classify (delete / surgery / neutralize) → sign-off → shared-contract-first →
  regenerate → typecheck-as-worklist → delegate-prose → lockfile → green-commit sequence;
- the "separate my breakage from pre-existing failures" discipline;
- the rule to leave `openspec/changes/archive/` as historical record.
Three `general-purpose` subagents were used effectively as *disposable prose editors* — that
delegation pattern (isolate token-heavy doc edits) is the reusable move.

## 7. Pitfalls & dead ends

- **Generated files bite back.** The client plugin registry is generated — hand-editing it
  is wasted; delete the plugin dirs and rerun `scripts/generate-plugin-registry.mjs`.
- **The lockfile keeps stale workspace entries** after deleting packages. A plain
  `npm install` left `honcho-plugin`/`jj-plugin` refs; clearing stale `node_modules`
  symlinks and forcing a clean regen fixed it.
- **`vitest.config.ts` referenced the deleted plugin dirs** — a test config, not source, so
  it won't show in a `tsc` sweep. Grep config files (`vitest.*`, `*.config.*`) separately.
- **Binary `.png` files produce false-positive grep hits.** Exclude binaries in the
  reference sweep or you'll chase phantom refs.
- **`jj` is a 2-letter token** — bare `grep 'jj'` over-matches; anchor with word boundaries
  and camelCase variants (`\bjj\b`, `JjState`, `JjWorkspace`, `gatherJjInfo`).
- **Don't delete tests wholesale.** A mixed worktree/jj test file needed *stripping*, not
  deletion — check whether the non-jj cases are covered elsewhere first.
- **`vi.fn(async () => ...)` infers an empty-tuple call signature**, so
  `mock.calls[0][0]` fails `tsc`. Give the mock explicit fetch-shaped params.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the two target names + all casing/id variants; confirmation that
`openspec/changes/archive/` stays untouched; a green baseline (know which tests are already
red *before* you start).

- [ ] Repo-wide grep both names + variants; count refs per package.
- [ ] Classify: whole-delete vs core-surgery vs neutralize; present the plan; get sign-off.
- [ ] Delete whole dirs → edit the **shared type surface first**.
- [ ] Regenerate the plugin registry (`node scripts/generate-plugin-registry.mjs`).
- [ ] `npx tsc --noEmit | grep 'error TS'` — fix, separating your errors from pre-existing.
- [ ] Delete jj-only tests; strip jj cases from mixed tests.
- [ ] Delegate docs + `openspec/specs/` prose to `general-purpose` subagents (caveman style).
- [ ] Regenerate the lockfile (clear stale symlinks); `npm test` until green.
- [ ] Commit, excluding files you didn't author.

**Final artifacts:** commit `d944201c chore: remove honcho and jj plugins and all references`
(259 files), `tsc --noEmit` clean, `npm run build` ✅, `npm test` = 8028 passed.

---

_Generated from session `019f05da` · `pi-agent-dashboard` · 2026-06-27. Source extract: `/tmp/facts-1260-3901.md`._
