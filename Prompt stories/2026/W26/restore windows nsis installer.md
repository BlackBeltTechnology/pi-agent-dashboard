---
session: 019eecc7
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (9 user prompts)"
upgrade_status: pending
---

# How we did it: Resolve `bash` from bundled Git on Windows — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a terse, repeated bug report — a link and four words:

> `cannot be build https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/27922110070`

Taken literally the ask was "this CI run failed, fix it." But the run *had actually
succeeded* — the failing signal the user saw was a screenshot of the **Tools panel
showing `bash` as not found on Windows**. The real objective, surfaced only after the
`The electron contains bash [image]` steering turn, was: **make the `bash` tool resolve
on Windows**, where the Electron app bundles GNU bash as `resources\git\usr\bin\sh.exe`
(via dugite-native) but ships **no `bash.exe`**, so `where bash` misses and the panel
shows a red ✗.

## 2. TL;DR playbook

1. **Don't trust "cannot be build" at face value.** Pull the run: `gh run view <id>` and
   `gh run view --job=<id> --log`. Confirm `conclusion: success` and read the annotations —
   Node-20-deprecation + post-job `git.exe exit 128` are **harmless**, not build failures.
2. **Ask for the real symptom.** The user's screenshot (`bash` ✗ in the Tools panel) was
   the actual bug, not the CI run. State back the two possibilities and let them pick.
3. **Locate the resolver.** `grep` the tool-registry: `packages/shared/src/tool-registry/`
   (`strategies.ts`, `definitions.ts`). Find that the `bash` chain is `override → managed → where`.
4. **Diagnose the root cause.** dugite-native bundles bash as `sh.exe`, not `bash.exe`;
   `ensure-bundled-git.ts` prepends `resources\git\usr\bin` to PATH so `git` and `!`/`!!`
   work via `sh`, but `where bash` finds nothing → red ✗.
5. **Mirror the existing pattern.** Copy `bundledNodeStrategy` → new `bundledGitBashStrategy`
   (win32-only) resolving `bash → <resourcesPath>\git\usr\bin\sh.exe` via `resolveBundledGitDir`.
6. **TDD.** Write `bundled-git-bash-strategy.test.ts` FIRST (6 cases), watch it fail, then
   implement. Insert into chain `override → bundled-git-bash → managed → where`; add
   `bundled-git-bash → "bundled"` to `classify()`.
7. **Fix the fallout.** Update the existing chain-order assertion and add a win32 end-to-end
   resolve test; wire `resourcesPath` through `freshRegistry`.
8. **Verify wide.** `HOME=$(mktemp -d) npx vitest run packages/shared` + `tsc --noEmit`.
   Confirm the `no-hardcoded-bundled-git-paths` guard passes (use `path.win32.join` with
   separate args, never a literal `usr/bin/sh.exe` string — even in a test title).
9. **Commit → push → `gh run watch` → confirm merge.** Then remove worktree + delete branch.

## 3. How the collaboration unfolded

**Phase 1 — Chasing a phantom failure (prompts 1–4).** The user pasted the same CI link
four times. The AI pulled the run logs and, crucially, **pushed back**: the run was green,
the NSIS Setup.exe built, all QA tests passed, and the scary annotations (`Node.js 20 …
deprecated`, `git.exe failed with exit code 128` in post-job cleanup) were cosmetic. It
asked the user to clarify what "cannot be build" actually meant. *Why it worked:* refusing
to invent a fix for a non-failure saved a wild-goose chase.

**Phase 2 — The real bug appears (prompt 5).** `The electron contains bash [image]` — the
screenshot reframed everything. The AI immediately recognized the Tools panel showing `bash`
✗ and pivoted to reading the tool-resolution code. *Decision point:* the human's image was
the single highest-leverage input of the session.

**Phase 3 — Root cause + TDD fix.** The AI traced the `bash` chain, found dugite-native ships
`sh.exe` not `bash.exe`, proposed a fix mirroring `bundledNodeStrategy`, wrote the test first,
implemented `bundledGitBashStrategy`, then chased down every regression (chain-order test,
`freshRegistry` wiring, the hardcoded-path guard tripping on a test *title* string).

**Phase 4 — Land it (prompts 6–9).** `commit` → `monitor ci` → the AI committed `264634c3`,
pushed, and `gh run watch`ed to green. A full workday later the user asked `Is this merged?`;
the AI discovered PR #126 was **squash-merged** (so the original SHA wasn't a direct ancestor)
and verified the fix bytes landed in `develop`. Then `delete branch and worktree`.

## 4. Prompts that worked

- **The goal prompt** (`cannot be build <url>`) was *weak* — no symptom, just a link. A stronger
  kickoff: *"On Windows the Tools panel shows `bash` as not found even though the Electron build
  bundles it. Here's a screenshot. Fix the resolver."*
- **`The electron contains bash [image]`** — the turn that unlocked everything. A screenshot +
  five words redirected the AI from CI-log spelunking to the actual code path. High leverage.
- **`commit` / `monitor ci` / `okay, delete branch and worktree`** — terse, trusting follow-ups
  that let the AI drive the mechanical landing steps without micromanagement.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat "cannot be build" as a literal CI failure | Re-pasting the link, then sending the real screenshot | Lead with the *observable symptom*, not the CI URL |
| Look only at the build/test pipeline | `The electron contains bash [image]` | Attach the failing UI screenshot in the first prompt |
| Risk conflating "PR merged" with "my SHA is an ancestor" | `Is this merged?` forcing a real verify | Assume squash-merge; verify by file bytes in `develop`, not SHA ancestry |

Additional guardrails surfaced:
- **Cosmetic CI annotations lie.** Node-20 deprecation and post-job `git.exe exit 128` look
  like failures but aren't. Always check `conclusion: success` before believing the red.
- **The hardcoded-path guard is strict.** It scans *test titles* too — never write a literal
  `usr/bin/sh.exe` / `cmd/git.exe` anywhere; build paths with `path.win32.join(dir, "usr", "bin", "sh.exe")`.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted this session. One subagent was used:

- **`general-purpose` subagent — "Update file-index-shared.md rows"**: delegated the `docs/`
  documentation update in caveman style per the Documentation Update Protocol, keeping the main
  agent focused on code. *Invoke it whenever a code change adds/edits an indexed file.*

**Skill worth creating:** a `resolve-bundled-tool-on-windows` project skill capturing the
pattern — *bundled tool ships under an alias (bash→sh.exe), add a win32-only strategy mirroring
`bundledNodeStrategy`, insert into the chain after `override`, classify as `bundled`, TDD, and
respect the `no-hardcoded-bundled-git-paths` guard.* This session is the second bundled-tool
resolver (after node); a third occurrence should trigger extraction.

## 7. Pitfalls & dead ends

- **Believing the bug report.** ~40 minutes and four prompts went into CI-log analysis for a run
  that had already succeeded. *If a "build failed" report doesn't match the logs, ask for the
  actual symptom before fixing anything.*
- **The guard test tripped on a string literal in a test title** (`cmd/git.exe`). Reword titles;
  the `no-hardcoded-bundled-git-paths` regex doesn't care that it's "just a title".
- **`freshRegistry` didn't pass `resourcesPath`** — the constructor read `deps.env`, so the new
  strategy got nothing. Wire the dep through the test harness constructor, not just the call site.
- **Squash-merge hides your SHA.** `git merge-base --is-ancestor 264634c3 develop` returns false
  after a squash even though the fix is in. Verify by diffing the file blob, not the commit graph.
- **One failed command:** an early `gh pr view 126 --json … merged …` used an invalid field combo;
  re-running with the corrected `--json` field list worked.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the failing-UI screenshot (not just the CI URL), `gh` authenticated,
the worktree on the feature branch.

- [ ] `gh run view <id>` + `--log` → confirm real vs cosmetic failure.
- [ ] Identify the true symptom (Tools panel `bash` ✗ on Windows).
- [ ] Open `packages/shared/src/tool-registry/{strategies,definitions}.ts`; find the `bash` chain.
- [ ] Confirm dugite-native ships `resources\git\usr\bin\sh.exe`, no `bash.exe`.
- [ ] Write `bundled-git-bash-strategy.test.ts` first (6 cases) → fail.
- [ ] Add `bundledGitBashStrategy` (win32-only, `path.win32.join`, `resolveBundledGitDir`).
- [ ] Chain `override → bundled-git-bash → managed → where`; `classify` → `"bundled"`.
- [ ] Update chain-order test + win32 e2e resolve test; wire `resourcesPath` through `freshRegistry`.
- [ ] `HOME=$(mktemp -d) npx vitest run packages/shared` + `tsc -p packages/shared/tsconfig.json --noEmit`.
- [ ] Delegate `docs/file-index-shared.md` rows to a subagent (caveman style).
- [ ] `git commit` → `git push` → `gh run watch <id> --exit-status` → verify green.
- [ ] After merge: verify fix bytes in `develop`, then `git worktree remove` + `git branch -D`.

**Final artifacts produced:**
- `packages/shared/src/tool-registry/strategies.ts` (new `bundledGitBashStrategy`)
- `packages/shared/src/tool-registry/definitions.ts` (chain + `classify`)
- `packages/shared/src/tool-registry/__tests__/bundled-git-bash-strategy.test.ts` (new)
- `packages/shared/src/__tests__/tool-registry-definitions.test.ts` (updated chain-order + win32 e2e)
- Commit `264634c3` → squash-merged as `d773f20a` on `develop` via PR #126.

---

_Generated from session `019eecc7-23cc-7566-b211-b6f9a6948ae8` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-22. Source extract: session facts sheet._
