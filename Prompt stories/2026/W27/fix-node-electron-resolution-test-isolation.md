---
session: 019f2c9d
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-node-electron-resolution-test-isolation]
proposal_excerpt: "The tool-registry test `packages/shared/src/tool-registry/__tests__/node-electron-resolution.test.ts` — *\"packaged Electron — bundled-node wins > npm (executor) resolves to bundled with argv = [bundled-npm]\"* — is a *…"
---

# How we did it: isolate the node/Electron argv test — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single skill invocation:

```
/skill:openspec-apply-change fix-node-electron-resolution-test-isolation
```

The *real* objective, once implementation clarified it: a tool-registry test in
`packages/shared/src/tool-registry/` was flaky/red-on-dev because argv assembly for the
node-script executors leaked **real-machine values** into the test — `process.execPath`
(leak B: `~/.pi-dashboard/node/bin/node`) and a `realpathSync` symlink deref of the
bundled npm (leak A: `.../npm` → real `npm-cli.js`). The change adds **injection seams**
so the test can pin those two values, making the "packaged Electron — bundled-node wins"
assertion deterministic — then apply the whole OpenSpec change, archive it, and ship a PR
to `develop`. The second prompt — `archive and use ship-change skill` — turned "apply"
into a full apply→archive→ship run.

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change>`; let the AI read the proposal +
   `tasks.md` + the context files it names.
2. **Reproduce the failure first** (Task 1.1). Run the isolated test and read argv[0] and
   the script arg to *name* the two leaks before touching source.
3. Add **optional injection seams** to `StrategyDeps` (`execPath?`, `realpath?`), defaulted
   in `defaults()`/`d()` to `process.execPath` / `realpathSync` — runtime stays byte-identical.
4. Convert the plain arg-builder to a **deps-closing factory** (`nodeScriptToArgv` →
   `makeNodeScriptToArgv(deps)`) and thread an injectable `realpath` through `resolveJsScript`.
   Wire the three executor defs (`pi`, `openspec`, `npm`) to the factory.
5. Verify in layers: `npx tsc --noEmit -p packages/shared` (scoped), isolated test
   (`HOME=$(mktemp -d) npx vitest run <test>`), then full `npm test` to confirm scope.
6. Mark `tasks.md` complete, `openspec validate --strict`, Biome-check only the touched files.
7. `archive and use ship-change skill` → `openspec archive` (auto-syncs specs), commit, push,
   open PR to `develop`, watch CI, apply CodeRabbit nitpicks, squash-merge, clean up worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read the change).** The AI read the apply skill, ran
`openspec status`/`instructions apply --json`, then read the source (`strategies.ts`,
`definitions.ts`) and the failing test. It grepped for the exact symbols in play
(`toArgv`, `StrategyDeps`, `resolveExecutor`, `execPath`, `realpath`) instead of reading
files blind — cheap orientation before any edit.

**Phase 2 — Reproduce before fixing.** Task 1.1 ran the isolated test and *named both
leaks* from the actual output (argv[0] = the bundled node path; script arg = the realpath
deref). This is the single most valuable move: the fix design fell straight out of the two
concrete leak sources.

**Phase 3 — Add seams, preserve runtime.** Two optional fields on `StrategyDeps`, defaults
merged in `d()`, and a factory (`makeNodeScriptToArgv(deps)`) closing over
`deps.execPath`/`deps.realpath`. `resolveJsScript` took an injectable `realpath` param
defaulting to `realpathSync`. The discipline: **only tests inject; production defaults keep
behavior byte-identical.**

**Phase 4 — Layered verify.** Scoped `tsc -p packages/shared` first (a full `tsc` surfaced
pre-existing cross-package `rootDir` noise in `image-fit-extension` — correctly diagnosed as
unrelated). Isolated test → 9/9 green. Full `npm test` → 17 failures, **all** in
`pi-image-fit-extension` (`Jimp is not a constructor`), zero in touched files. The AI
confirmed the diff was confined to `packages/shared/src/tool-registry/**` before trusting scope.

**Phase 5 — Ship.** `openspec archive` auto-synced specs — but the delta was mislabeled
`MODIFIED` when no existing requirement covered the new injectability; the AI reconciled it to
`ADDED` before archiving. Then commit → push → PR #230 → CI green (9m18s, proving the
image-fit failures were local-only) → one CodeRabbit nitpick (stale doc symbol
`nodeScriptToArgv` → `makeNodeScriptToArgv`) auto-applied → squash-merge → branch + worktree cleanup.

**Decision point (human):** at the ship gate the AI *stopped* and flagged the 17 red tests
rather than silently overriding the ship-change "never push a red gate" rule; the operator
gave the go-ahead once it was established they were pre-existing and unrelated.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change fix-node-electron-resolution-test-isolation`.
  Effective because the change already carried a proposal + `tasks.md`; the skill gave the AI
  a task list to execute and verify against, so it worked in disciplined, checkable increments.
- **High-leverage follow-up** — `archive and use ship-change skill`. Five words that unlocked
  the entire post-implementation pipeline (archive → spec sync → commit → PR → CI watch →
  CodeRabbit loop → merge → cleanup) without further babysitting.

Stronger kickoff for a future run (front-loads the scope guardrails):

> Apply `<change>` via openspec-apply. Reproduce the failing test FIRST and name each leaking
> value. Add injection seams with production defaults so runtime is byte-identical — tests
> inject only. Then archive and ship via ship-change; if the full suite has pre-existing
> unrelated failures, confirm they're on base before deciding on the gate.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after "apply" (implementation only) | `archive and use ship-change skill` | State the full apply→archive→ship intent in the goal prompt |
| Treat full-repo `tsc`/`npm test` failures as its own regressions | (self-corrected) diagnosed them as pre-existing `image-fit-extension` noise | Scope typecheck to `-p packages/shared` and diff-scope-check before trusting a red suite |
| Halt at the ship gate on a red `npm test` | approved proceeding once failures proven pre-existing + unrelated | Pre-agree the rule: "pre-existing failures on base ≠ a blocking gate" |
| Label the OpenSpec delta `MODIFIED` | (self-corrected) reconciled to `ADDED` — no existing requirement matched | Author delta headers as `ADDED` when the requirement is genuinely new |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session *consumed* existing skills:
`openspec-apply-change` (task-driven implementation), `openspec-archive-change`, and
`ship-change` (the full PR/CI/CodeRabbit/merge/cleanup pipeline). That chain is the reusable
asset: **apply → archive → ship** as three composable skills covers a change end-to-end.

The reusable *pattern* worth remembering (candidate for a memory): **the injection-seam
technique** — to make a test that leaks real-machine state (`process.execPath`, `realpathSync`,
env, cwd, clock) deterministic, add an *optional* dependency field defaulted to the real value,
route production through the default, and inject a pinned value only in the test. Runtime stays
byte-identical; the test becomes hermetic.

## 7. Pitfalls & dead ends

- **Full `tsc --noEmit` is noisy across the monorepo.** A cross-package `rootDir` error in
  `image-fit-extension` is pre-existing — scope with `-p packages/shared` and don't chase it.
- **`npm test` had 17 red (`Jimp is not a constructor`) in `pi-image-fit-extension`.** Local
  environment only — CI was green. If the touched diff is scoped away from the failing package,
  confirm on base and don't treat it as your regression.
- **`openspec archive` rejects a `MODIFIED` header** that matches no existing requirement.
  If the requirement is new, label the delta `ADDED`.
- **Worktree self-deletion breaks the shell.** After `git worktree remove`, the session's cwd
  is gone — later `cd <worktree>` / Bash spawns fail. Run final local-branch cleanup from the
  parent checkout (or the sandbox, which has its own cwd).
- **Squash-merge leaves the local branch "not fully merged."** Expected — the squash commit has
  a new SHA. Safe to `git branch -D` once GitHub shows it merged.
- **`gh pr merge --delete-branch` can fail the local checkout switch** (branch checked out in
  parent) even though the server-side merge + delete succeeded. Verify the remote branch state
  and delete explicitly if it survived.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-apply-change <change>` — read proposal + `tasks.md` + context files.
- [ ] **Reproduce the failing test first**; name each leaking real-machine value.
- [ ] Add optional seams to the deps type (`execPath?`, `realpath?`), default them in
      `defaults()`/`d()`; convert the arg-builder to a deps-closing factory.
- [ ] Verify layered: `npx tsc --noEmit -p packages/shared` → `HOME=$(mktemp -d) npx vitest run <test>`
      → full `npm test` (scope-check the diff).
- [ ] Mark `tasks.md`; `openspec validate --strict`; Biome only the touched files.
- [ ] `archive and use ship-change skill` → archive (auto spec-sync; fix `MODIFIED`→`ADDED` if
      needed) → commit → push → PR to `develop` → watch CI → apply CodeRabbit → squash-merge.
- [ ] Clean up from the **parent** checkout: delete remote branch, remove worktree, `git branch -D`.

**Inputs to have ready:** an OpenSpec change with proposal + `tasks.md`; `gh` auth; the
`develop` base branch (not branch-protected in this repo).

**Artifacts produced:** edits to `strategies.ts`, `definitions.ts`,
`node-electron-resolution.test.ts`, the synced `tool-registry/spec.md`; archived change;
merged PR #230 (squash SHA `0d6e5990`).

---

_Generated from session `019f2c9d` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-04. Source extract: deterministic facts sheet (`extract_session.ts`)._
