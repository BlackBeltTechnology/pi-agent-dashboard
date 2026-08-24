---
session: 019e5e34
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (9 user prompts)"
upgrade_status: pending
openspec_changes: [eliminate-electron-runtime-install]
proposal_excerpt: "The Electron arm of the dashboard currently does at runtime — inside a sandboxed home directory `~/.pi-dashboard/` — most of what `npm i -g` does natively on a developer machine. It ships an offline npm cache, extract…"
---

# How we did it: Eliminate the Electron runtime install — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a bare `/opsx-apply` invocation of the **`openspec-apply-change`**
skill — no change name, just "implement tasks from an OpenSpec change." Context
resolved it to **`eliminate-electron-runtime-install`**, a large refactor that rips
the runtime `npm i -g`-style bootstrap out of the Electron app (the sandboxed
`~/.pi-dashboard/` home, offline npm cache, extraction/install machinery) and
migrates the app onto the clean `~/.pi/dashboard/` path with a slim first-run wizard.

The *real* objective, once the session ran: advance the change from **49/98 → 69/98
tasks** by knocking out Phases 3.11, 3.0.b, 6, 7 and 8 — then a long, unplanned
second act on **jj/git version-control hygiene** (detached-HEAD reattach) that
spawned a brand-new cross-platform skill helper. Two distinct bodies of work in one
session: the feature implementation, then a VCS tooling side-quest driven entirely
by steering.

## 2. TL;DR playbook

1. **Kick off with the apply skill, let context pick the change**: `/opsx-apply`
   → it infers `eliminate-electron-runtime-install`. Read `proposal.md` + `design.md`
   + `tasks.md` first (`wc -l` them, then read) — 49 tasks remain, do not blindly stream.
2. **Order phases smallest-first and by dependency**: 3.11 → 7.1 (needed by 6.3
   wiring) → 7.x → 6 → 8. State the order out loud before editing.
3. **TDD each phase**: write the test, run it red, add the minimal impl, run green,
   then check the tasks.md box. E.g. `bridge-register` identity dedup got 3 tests
   *before* the helper.
4. **Add repo-lint guard tests** to lock the refactor: a test asserting `cli.ts`
   references zero deleted bootstrap symbols, another asserting no `~/.pi-dashboard`
   references leak back in (with an explicit allowlist for legit ones).
5. **Delegate every `docs/` rewrite to a subagent** in caveman style (AGENTS.md
   rule) — spawn `Explore`/DocScribe, never edit `docs/` from the main agent.
6. **Commit the feature** on its feature branch. In this colocated jj repo, use
   `jj describe`/`jj new` — **not `git commit`** (protocol break happened here).
7. **When git shows detached HEAD**, don't `git checkout`. Verify the bookmark tip
   hash equals detached HEAD, then `git symbolic-ref HEAD refs/heads/<branch>`.
8. **Productize the fix**: write `reattach-head.mjs` (Node, built-ins only) with a
   7-code exit taxonomy + atomic `O_EXCL` lock; make the `.sh` a thin shim; document
   the 5 risks in the skill. Land the skill on `develop`, keep unrelated local edits
   as a working-copy diff.

## 3. How the collaboration unfolded

**Phase A — Discovery & sequencing.** The AI read `proposal.md`/`design.md`/`tasks.md`,
recognized "this change is massive — 49 remaining tasks," and declared a phase order
(smallest + dependency-first). *Why it worked:* stating the batching plan before
touching code kept a 3.5-hour, 148-message session coherent. **Decision point:** the
human didn't intervene here — good sequencing bought that trust.

**Phase B — TDD implementation (Phases 3.11, 7, 6, 3.0.b).** Each phase followed
write-test → red → minimal-impl → green → check-box. Highlights: `readPackageName`
identity-dedup in `bridge-register.ts` (+3 tests); `legacy-managed-dir.ts` module +
one-time server log + Doctor advisory row; wizard.html collapsed **883 → 179 LOC**;
repo-lint guard tests against bootstrap-symbol and `~/.pi-dashboard` regressions.
*Why it worked:* the guard tests convert a scary delete-heavy refactor into something
a future edit can't silently undo. Net **−385 LOC** in the feature commit.

**Phase C — Docs (delegated).** Phase 8's `docs/` rewrites were handed to a subagent
(`Explore`) in caveman style per AGENTS.md — the main agent orchestrated, never wrote
prose. *Why:* keeps the docs voice consistent and the main context lean.

**Phase D — Commit & the jj protocol break.** Human said `commit`. The AI staged its
own files (skipping the unrelated `win-11.pkrvars.hcl`) and ran **`git commit`** — a
forbidden mutating git op in this colocated jj repo. It landed (git pre-existed jj's
snapshot) but the AI self-flagged the break: "next time I'll use `jj describe`."

**Phase E — The VCS side-quest (steering-driven).** The human noticed jj's `@` sat on
an empty commit *above* the bookmark and that git HEAD was detached. Six steering
prompts turned a one-off fix into a durable tool: (1) get work back on the feature
branch, (2) reattach detached HEAD, (3) can the jj skill do this reattach for us,
(4) what are the risks / parallel-agent safety, (5) can an LLM resolve it, (6) does
it work on Windows. Each answer deepened the artifact. **Decision points** were the
human's — every prompt widened scope deliberately.

**Phase F — Productize & land.** The reattach logic became `reattach-head.mjs`
(Node built-ins, atomic `O_EXCL` lock, `process.kill(pid,0)` liveness, 7 exit codes),
with the `.sh` demoted to a thin `exec node` shim (one implementation, no drift). The
skill gained a "Reattaching a detached git HEAD" section + a 5-risk table. Landed on
`develop` as `8d8d929f`; the unrelated win-11 edit kept as a working-copy diff.

## 4. Prompts that worked

- **The goal prompt** (`/opsx-apply`, no args): fine *because* the change was
  inferable from context and the apply skill self-announces its selection. Stronger
  version for ambiguity: name it — `/opsx-apply eliminate-electron-runtime-install`.
- **`commit`** — one word, high leverage: triggered a full stage-the-right-files +
  message flow. (But see §5 — in a jj repo this should route to `jj describe`.)
- **"back to feat/enable-standalone-npm-install so the jj commits be on there"** —
  precise redirection that told the AI exactly which bookmark the work belonged on.
- **"Is it possible to improve jj skill that possible make detached git state back to
  the branch?"** — the pivot prompt. Turned a one-off fix into a reusable skill.
- **"What is the risks? … parallel agent works on same branch?"** — forced a rigor
  pass (5-risk table) instead of a happy-path script.
- **"Is it possible to resolve the reattaching issues with LLM?"** — pushed the AI to
  separate LLM-tractable checks (4 of 5) from the fundamental concurrency limit (1).
- **"Is it working with windows?"** — the portability gate that drove the rewrite from
  bash (flock/symlink/`kill -0`) to Node built-ins.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reach for `git commit` in a colocated **jj** repo (forbidden) | (self-caught, but implied by "the jj commits") | Route ALL commits through `jj describe`/`jj new`; never `git commit` when `.jj/` exists |
| Leave `@` on an empty commit above the bookmark, looking "off-branch" | "back to feat/… so the jj commits be on there" | After apply, verify `@`'s parent = the intended bookmark; fold empties back |
| Leave git HEAD detached (jj-normal but IDE/`git push` hostile) | "The git is pointing headless commit" | Run the reattach helper post-apply; verify bookmark-tip hash == HEAD first |
| Ship a one-off fix instead of a durable tool | "improve jj skill … make detached git state back to the branch?" | When a fix repeats, upgrade it to a skill script immediately |
| Write a happy-path script with no failure analysis | "What is the risks? … parallel agents?" | Author risk tables + exit-code taxonomies up front for VCS-mutating tools |
| Default to bash (flock, symlinks, `kill -0`) | "Is it working with windows?" | Write cross-platform helpers in Node built-ins from the start |

Quality bars the human imposed: parallel-agent safety must be *named* (the helper is
single-agent-only; parallel needs `jj workspace add`), Windows/PowerShell/cmd must all
work, and unrelated local edits (`win-11.pkrvars.hcl`) must never be swept into a commit.

## 6. Skills, tools & memory created — and why they're effective

**`.pi/skills/jj-workspace/scripts/reattach-head.mjs`** (+ `.sh` shim, + SKILL.md section)
- **Captures:** safe reattachment of a detached git HEAD to its bookmark in a
  colocated jj repo, with pre-flight guards (ref-verify, hash-match, in-flight-jj-op
  detection, multi-workspace anchoring) and an atomic lock.
- **Why effective:** removes the "rediscover the safe `symbolic-ref` incantation the
  hard way" tax; the 7-code exit taxonomy lets an agent branch deterministically on
  outcome; Node built-ins + `O_EXCL` lock make it work identically on macOS, Linux,
  WSL, Git Bash, PowerShell, cmd — no flock/symlink portability holes.
- **Invoke next time:** whenever `git status` shows "detached HEAD" after a jj apply
  and the bookmark tip is the same commit. Different hash → use `jj edit`/`jj new`.

The SKILL.md now also documents the **5 risks** (wrong-commit reattach, concurrent jj
op, `HEAD@git` desync, no ref validation, multi-workspace bleed) with per-risk
mitigation/recovery, and an explicit "single-agent only" boundary.

## 7. Pitfalls & dead ends

- **`git commit` in a colocated jj repo** — forbidden by `jj-workspace/SKILL.md`. It
  worked by luck (git pre-existed jj's snapshot) but is a protocol break. Use
  `jj describe -m "…"`.
- **Heredoc commit message failed** — the inline `git commit -m "$(cat <<'EOF' …)"`
  errored; recovered by writing the message to `/tmp/commit-msg.txt` and using
  `git commit -F`. For long messages, always go via a file.
- **`jj new <bookmark>` reverted the win-11 file** — moving `@` to a fresh empty child
  orphaned the local edit into the old commit. Recovered with
  `jj restore --from <orphan> qa/packer/vars/win-11.pkrvars.hcl` then `jj abandon`.
- **`git checkout`/`git switch` to reattach** — don't. They touch the working tree/index.
  `git symbolic-ref HEAD refs/heads/<branch>` is a pure ref op (still: verify hash first).
- **bash-only helper on Windows** — `flock` absent, `ln -s` needs Developer Mode,
  `kill -0` can't see native PIDs. The Node rewrite was the fix.
- **Concurrency is NOT LLM-solvable** — TOCTOU between `jj status` and the ref update
  is a distributed-systems problem; the helper mitigates with a lock, doesn't eliminate it.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; a clean read of
`proposal.md`/`design.md`/`tasks.md`; awareness the repo is **colocated jj** (`.jj/` present).

**Checklist:**
- [ ] `/opsx-apply <change>` — name it if ambiguous; confirm the announced selection.
- [ ] `wc -l` then read the three artifacts; declare a smallest-first + dependency phase order.
- [ ] Per phase: write test → red → minimal impl → green → check tasks.md box.
- [ ] Add repo-lint guard tests (no deleted-symbol refs, no legacy-path regressions, with allowlist).
- [ ] Delegate every `docs/` write to a subagent in caveman style.
- [ ] Commit via `jj describe`/`jj new` — never `git commit`; long messages via `git commit -F <file>`.
- [ ] Stage only your files; keep unrelated local edits (e.g. `win-11.pkrvars.hcl`) as a working-copy diff.
- [ ] If HEAD detaches: run `reattach-head.mjs <branch>` (or verify hash-match then `git symbolic-ref`).
- [ ] Land tooling/skill changes on `develop`; feature on its feature branch.

**Artifacts produced:** feature commit `85c5954b` (24 files, +913/−1298, net −385 LOC)
on `feat/enable-standalone-npm-install`; skills commit `8d8d929f` on `develop`
(`reattach-head.mjs`, `reattach-head.sh`, updated `jj-workspace/SKILL.md`); change
advanced **49 → 69 / 98** tasks.

---

_Generated from session `019e5e34-e942-7ed0-a587-fa50565e7467` · `pi-agent-dashboard` · 2026-05-25. Source extract: `/tmp/facts-1784850901N.md`._
