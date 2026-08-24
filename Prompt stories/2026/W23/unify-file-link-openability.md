---
session: 019e9e95
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); heavy steering (11 user prompts); large facts sheet (~11934 tok)"
upgrade_status: pending
openspec_changes: [unify-file-link-openability]
proposal_excerpt: "File references in the dashboard are openable on only one surface — tool *output* bodies (Bash/grep/ctx) rendered through `LinkifiedText` → `FileLink`. Three other surfaces leak:"
---

# How we did it: Unify file-link openability across dashboard surfaces — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single directive:

```
/skill:openspec-apply-change unify-file-link-openability
```

The *real* objective — clarified once the skill turned out to be missing and the work
got underway — was to **land a fully-specced OpenSpec change end-to-end**: make file
references clickable/openable on **all four** dashboard chat surfaces (tool-output
bodies, Read/Edit/Write headers, assistant prose + inline code, and the preview
overlay), not just tool output. Beyond writing the code, the operator wanted the whole
delivery pipeline run: isolated browser verification, verify-change, sync specs,
archive, commit, PR, CI watch, merge, and worktree cleanup.

## 2. TL;DR playbook

1. **Fire the apply skill.** `/skill:openspec-apply-change <change-name>`. If it
   *stalls with no procedure*, the skill body is missing on disk — don't debug the
   change, debug the skill install.
2. **Regenerate missing OpenSpec skills** with `npx openspec init --tools pi --force`
   (the `worktreeInit` hook is gated `test ! -d node_modules`, so it never fires in a
   worktree that already has `node_modules`).
3. **Re-run the apply skill.** It now reads `tasks.md`, groups the work, and implements
   tokenizer → resolution → shared hook → prose linkify → overlay highlighting.
4. **Run the affected vitest *projects*, not the full suite** — `npx vitest run
   --project @blackbelt-technology/pi-dashboard-web` (and `…-server`) with
   `HOME=$(mktemp -d)`. The monorepo suite is slow.
5. **Ask for an isolated browser harness** (own HOME + ports) to verify the surfaces
   that only render in a live chat stream. This is where a real bug surfaced.
6. **Delegate `docs/` writes to a subagent** (caveman-style rule verbatim); edit
   `CHANGELOG.md` directly (not under `docs/`).
7. **Verify → sync specs → archive** via the openspec-* skills (sync runs as a subagent).
8. **Commit clean:** revert incidental files (`.pi/settings.json` rewritten by
   `openspec init`, generated `plugin-registry.tsx`) before staging.
9. **Push → PR against `develop` → watch CI → squash-merge → delete branch + worktree.**

## 3. How the collaboration unfolded

**Phase 1 — Discovery: "why is openspec stuck?"** The apply directive produced nothing.
The AI grepped `.pi/skills/` and found only `openspec-shared/scripts/` — no
`openspec-apply-change/SKILL.md`. Correct diagnosis: *the skill body doesn't exist here*,
so `/skill:...` resolves to nothing. **Why it worked:** the AI treated "stuck" as a
missing-artifact problem, not a bug in the change.

**Phase 2 — Root cause: the init hook.** Prompted by the operator's hunch ("could the
init hook create that? some openspec profile parameter?"), the AI found the
`worktreeInit` hook in `.pi/settings.json` gated `test ! -d node_modules`, and the global
`~/.openspec/config.json` profile listing 10 workflows. `openspec init --tools pi`
scaffolds *one skill per workflow* — but the gate skips it when `node_modules` already
exists in the worktree. **Decision point:** operator said "run" → AI ran
`openspec init --tools pi --force`, regenerating all 10 skills.

**Phase 3 — Implementation (the apply skill).** 35 tasks, grouped: tokenizer branches
(POSIX `/…`, `file://`, Windows `C:\`) with an `absolute` token field; `FileLink`
pass-through (no cwd re-rooting for absolute); a shared `useFileOpenRouting` hook +
`OpenFileButton` preview fallback; prose/inline-code linkify via an optional `context`
prop on `MarkdownContent`; syntax highlighting in `FilePreviewOverlay`; a server-side
`decode-file-uri.ts` helper. **Why it worked:** the AI implemented in dependency order
and ran the *affected* test projects after each group instead of the slow full suite.

**Phase 4 — Isolated browser verification (caught a real bug).** Operator asked for an
isolated env with own home + ports. The AI built a tiny Fastify server reusing the
*real* `registerFileRoutes` (port 9123, `HOME=$(mktemp -d)`, stub session manager) + a
Vite harness page (port 8123) mounting the *real* components. Driving it in a browser
exposed defect ①-gap: absolute paths containing dot-dirs (`.worktrees`, `.git`, `.pi`)
were silently truncated because the tokenizer segment `SEG = [\w][\w.-]*` requires a
segment to *start* with a word char. Fixed the absolute branches to allow dot-segments +
added a regression test. **Why it worked:** real components + real routes over a live
HTTP path found what clean-path unit tests couldn't.

**Phase 5 — Docs, verify, sync, archive.** `docs/` writes delegated to a general-purpose
subagent (caveman style); CHANGELOG edited directly. Ran openspec-verify-change (34/34,
13/13 scenarios), then openspec-archive-change which synced delta specs (via an
openspec-sync-specs subagent) and moved the change to `archive/`.

**Phase 6 — Ship.** Reverted two incidental files, committed `6ff4b8f0`, pushed, opened
PR #85 against `develop`, watched CI green (lint→test→build, ~10m) + CodeRabbit pass,
squash-merged as `298c0605`, deleted remote+local branch and removed the worktree.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change <change>`: the right kickoff *when the
  skill exists*. Make it stronger by first confirming the skill is installed (see §7).
- **"Is it possible the init hook create that? some openspec profile parameter?"** —
  a high-leverage hypothesis that pointed the AI straight at `worktreeInit` + the
  profile config, short-circuiting a blind search.
- **"Create isolated test env (own home, ports) and tests with browser"** — one line
  that unlocked the harness which caught the dot-dir bug. Reusable verbatim.
- **"commit, push, create PR and monitor CI"** then **"merge PR"** then **"remove branch
  and worktree"** — tight, sequential ship commands that let the AI run the whole
  delivery tail autonomously.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Report the apply skill as "stuck" and stop at diagnosis | "why openspec stuck?" → then the init-hook hypothesis | State up front: if a `/skill:` call no-ops, check `.pi/skills/<name>/SKILL.md` exists; regen with `openspec init --tools pi --force` |
| Trust clean-path unit tests as sufficient | "Create isolated test env (own home, ports) and tests with browser" | Always add a live browser harness for surfaces that only render in a chat stream |
| Leave incidental worktree changes staged | (implicit, before committing) | Revert `openspec init` rewrites (`.pi/settings.json`) + generated files before `git add` |
| Edit `docs/` directly | Documentation Update Protocol | Delegate every `docs/` write to a subagent with the caveman-style rule verbatim |

## 6. Skills, tools & memory created — and why they're effective

- **Memory saved (project · insight):** the tokenizer bug — *`linkify-tool-output.ts`
  relative-path `SEG = [\w][\w.-]*` requires segments to START with a word char, which
  breaks absolute paths containing dot-directories (`.worktrees`, `.git`, `.pi`,
  `.config`)*. **Why effective:** dot-dirs are ubiquitous in absolute paths; this memory
  stops the exact regex class of bug from recurring in any future path-tokenizer work.
  Invoke it whenever touching path linkification or segment regexes.
- **Subagents used:** two general-purpose spawns — one for the `docs/` writes (per the
  Documentation Update Protocol), one for `openspec-sync-specs`. **Why effective:** keeps
  caveman-style doc prose and delta-spec folding out of the main context and isolated.
- **Recommended skill to create:** a project skill *"regenerate OpenSpec skills in a
  worktree"* capturing the `worktreeInit` gate + `openspec init --tools pi --force`
  workaround — this exact stall will recur in every worktree that already has
  `node_modules`.

## 7. Pitfalls & dead ends

- **`/skill:openspec-apply-change` no-ops.** The skill body wasn't on disk. Don't debug
  the change artifacts — run `npx openspec init --tools pi --force` to scaffold the
  workflow skills, then re-invoke.
- **`worktreeInit` never fires in an existing worktree.** Its gate `test ! -d
  node_modules` skips when `node_modules` is present, so skills silently go un-generated.
  The manual `openspec init` is the standing workaround.
- **Full monorepo `npm test` is slow.** Run affected projects only:
  `npx vitest run --project @blackbelt-technology/pi-dashboard-web` (+ `…-server`).
- **Tests need `HOME` set.** Prefix with `HOME=$(mktemp -d)` or the overlay/theme context
  fails to resolve.
- **Vite proxy flakiness in the harness.** The `/api` proxy to the file server returned
  empty intermittently; bypass it by pointing the client API base straight at the
  CORS-enabled file server port.
- **Clean-path unit tests miss dot-dir bugs.** Absolute paths with `.worktrees`/`.git`
  were truncated by the segment regex — only the live browser harness exposed it.
- **Incidental files sneak into the PR.** `.pi/settings.json` (rewritten by
  `openspec init`) and generated `plugin-registry.tsx` (from running the harness Vite
  server) had to be reverted before committing.

## 8. Reproduce it faster — checklist

- [ ] Confirm `.pi/skills/openspec-apply-change/SKILL.md` exists; if not, `npx openspec
      init --tools pi --force`.
- [ ] `/skill:openspec-apply-change <change>` — implement `tasks.md` in dependency order.
- [ ] Test affected projects only: `HOME=$(mktemp -d) npx vitest run --project
      @blackbelt-technology/pi-dashboard-web` (+ `…-server`).
- [ ] Build once green: `npm run build`.
- [ ] Stand up an isolated browser harness (own HOME + ports, real routes + real
      components); verify every surface; add regression tests for anything it catches.
- [ ] Delegate `docs/` writes to a subagent (caveman style); edit `CHANGELOG.md` directly.
- [ ] Verify → sync specs → archive via the openspec-* skills.
- [ ] Revert incidental files (`.pi/settings.json`, generated files) → commit → push →
      PR against `develop` → watch CI + CodeRabbit → squash-merge → delete branch +
      worktree.

**Inputs to have ready:** a fully-specced OpenSpec change (`proposal.md`, `design.md`,
`tasks.md`, `specs/`), the pi profile at `~/.openspec/config.json`, gh auth for PR/CI.
**Artifacts produced:** 11 new + 14 edited source/test files, archived change at
`openspec/changes/archive/2026-06-07-unify-file-link-openability/`, merged PR #85
(`298c0605` on `develop`).

---

_Generated from session `019e9e95-3a23-7734-a61e-8d0c72407d8b` · `pi-agent-dashboard/.worktrees/os-unify-file-link-openability` · 2026-06-06. Source extract: `/tmp/facts-yzlrNA.md`._
