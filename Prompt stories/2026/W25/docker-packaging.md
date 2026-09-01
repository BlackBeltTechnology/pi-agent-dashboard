---
session: 019ee68d
week: 2026/W25
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [docker-packaging]
proposal_excerpt: "The pi-dashboard is a multi-component system (server, bridge extension, pi agent, code-server, zrok, tmux, terminals) that requires several tools installed and configured on the host. Packaging everything into a Docke…"
---

# How we did it: Docker-packaging the pi-dashboard (apply → ship) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single slash command: `/skill:openspec-apply-change docker-packaging`.
The *real* objective, once steering clarified it, was to **implement the entire
`docker-packaging` OpenSpec change end-to-end and land it** — 28 tasks that package the
whole multi-component dashboard (server + bridge + pi agent + code-server + zrok + tmux)
into a self-contained Docker image, add a matching Electron "remote mode", write all the
docs, then archive the change, open a PR, pass CI, resolve CodeRabbit, merge, and clean up
the branch + worktree. It ran ~18h wall-clock across two working blocks and cost ~$18 on
Opus.

## 2. TL;DR playbook

1. Kick off apply with `/skill:openspec-apply-change docker-packaging` **from the worktree**.
2. Immediately state the split-location rule: **artifacts/openspec live in the worktree's
   PARENT repo; code + `tasks.md` checkboxes land in the worktree branch.**
3. Let the AI read the proposal/design/tasks, then have it present a **grouped plan
   (28 tasks → 8 groups)** and confirm scope before writing anything.
4. Build the mechanical `docker/` files first (Dockerfile, entrypoint, seed-auth, compose,
   up.sh, env). These have no test surface — write straight through.
5. For the two **real code changes** (server pin-seed + Electron remote mode) go **TDD**:
   write the test first to pin the contract, then implement.
6. When a task's literal wording targets **legacy/dead code**, stop and surface the design
   gap with a concrete corrected plan — don't silently follow or silently deviate. Ask.
7. Route `docs/` writes through the DocScribe subagent (caveman style); write `README.md`,
   `docker/README.md`, and the `AGENTS.md` pointer directly.
8. Verify: scoped package test suites + `tsc --noEmit` + shell/JS syntax. Confirm a root
   `.dockerignore` exists before trusting the build context.
9. Ship: commit → rebase onto `origin/develop` → archive+sync specs → push → PR → watch CI
   → triage CodeRabbit (**apply valid, skip spec-contradicting, document the skip**) →
   squash-merge → delete branch + worktree from the **parent** repo.

## 3. How the collaboration unfolded

**Phase 1 — Orient & contract the location rule.** The AI hunted for the apply skill and
change directory, then the human injected the pivotal constraint: *"the opsx skills have to
search in worktree's parent instead of worktree."* The AI honored it explicitly — openspec
artifacts read/written against the parent repo, code implemented in the worktree. This one
rule shaped every path for the rest of the session.

**Phase 2 — Plan before code.** Rather than diving in, the AI read all artifacts, grounded
the two code-touching areas, and presented an **8-group plan for the 28 tasks** plus one
logistics question (where `tasks.md` checkboxes go). Human confirmed worktree-only for
`tasks.md`. This up-front grouping is why the long build stayed coherent.

**Phase 3 — Mechanical Docker files.** Multi-stage Dockerfile (node:22-bookworm-slim base +
tools + pinned code-server/zrok; non-root `pi` app stage), `seed-auth.js` (env→provider
mapping: `ANTHROPIC_API_KEY`→`anthropic`, etc.), `entrypoint.sh`, `compose.yml` with three
commented perf profiles, overrides, `up.sh`, env files. Written straight through.

**Phase 4 — TDD the real code.** Server `preferences-store.ts` got a first-run pin-seed
(`PI_DASHBOARD_PIN_DIRS` + a `pinSeeded` marker so persisted-wins), test written first
(46/46). Then the Electron remote mode — this is where the key decision point hit.

**Phase 5 — Catching the design gap (the high-value moment).** The spec's tasks 7.x targeted
`wizard-state.ts` / `server-lifecycle.ts`, but the AI delegated an `Explore` subagent to
trace the *live* mode path and discovered those files are **legacy** (LAUNCH_SOURCE_V2=false)
— startup (`main.ts`) never reads `mode.json`, so editing only the spec's named files would
produce **dead code**. The AI stopped, laid out "what the spec assumes vs what's actually
true," and offered a corrected end-to-end plan (extend `ModeConfig`, add a
`wizard:persist-mode` IPC, wire the renderer, short-circuit startup). Human replied
*"Correction: Option 1."* → build the version that actually works.

**Phase 6 — Docs by protocol.** New top-level `docker/` area: `docs/` writes (new
file-index split + change-note rows) delegated to a subagent in caveman style;
`docker/README.md`, `README.md`, `AGENTS.md` pointer written directly.

**Phase 7 — Ship (the 7-step flow).** Human enumerated the finish line:
*"1. archive and sync 2. create pr 3. monitor ci 4. fix coderabbit issues 5. merge pr
6. delete branch 7. delete worktree."* AI committed, rebased onto `origin/develop`
(was 7 behind), archived+synced (11 requirements → specs), opened PR #143, watched CI
(pass 8m24s), triaged **9 CodeRabbit findings — fixed 8, skipped 1** that contradicted the
just-archived spec (documented in a PR comment), re-ran CI (pass), squash-merged, then
deleted the branch and worktree **from the parent repo** (the shell was pinned to the
now-deleted worktree — it fell back to the sandbox shell to finish).

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change docker-packaging`. Effective because the
  proposal/design/tasks already existed: a single slash command loads the whole spec-driven
  contract. The lesson: *do the planning in OpenSpec first, then apply is one line.*
- **High-leverage steering** — *"the opsx skills have to search in worktree's parent instead
  of worktree."* Nine words that fixed every artifact path for 18 hours. State environment
  invariants once, up front.
- **Unlock prompt** — *"Correction: Option 1."* A three-word decision that let the AI abandon
  the literal (dead-code) task wording and build the working version. Short, because the AI
  had already framed the choice crisply.
- **Finish-line prompt** — the numbered 7-step ship list. A single enumerated sequence let
  the AI run the entire land-it flow autonomously (only pausing on two genuinely ambiguous
  gates). Rewrite of a weaker "now ship it": **enumerate the steps** so the AI has an
  explicit checklist to execute and report against.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Search openspec artifacts inside the worktree | "search in worktree's PARENT instead of worktree" | State the artifacts-in-parent / code-in-worktree split in the FIRST message of any worktree apply |
| Follow the literal task wording (which pointed at legacy `wizard-state.ts`) | Choosing the corrected end-to-end plan ("Option 1") | Have the AL verify the LIVE code path (via `Explore`) before editing spec-named files; flag legacy/dead targets as a design gap and ask |
| Wait for direction at the finish | Enumerating the exact 7 ship steps | Give the whole ship sequence as one numbered list; let it run autonomously and pause only on real ambiguity |
| Blindly execute reviewer prompts | Verifying each CodeRabbit finding against code | Treat reviewer findings as claims to validate, not commands — apply valid, skip spec-contradicting, document the skip |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — it was a pure application of existing
project skills (`openspec-apply-change`, the archive/ship flow, the doc protocol). Two
subagents did the isolatable work:

- **`Explore` — "Trace Electron mode.json read/write live path."** Its value was catching
  that the spec's target files were legacy before a single line was written, converting a
  would-be dead-code deviation into a deliberate, approved redesign. *Invoke it whenever a
  task names specific files but you're unsure they're on the live path.*
- **`general-purpose` (DocScribe-style) — "Add docker file-index split + change notes."**
  Kept the caveman-style `docs/` writes out of the main context per the repo doc protocol.
  *Invoke it for every `docs/` prose write.*

**Recommended skill to create:** a `worktree-apply-and-ship` playbook capturing the
artifacts-in-parent rule + the 7-step land flow + the "delete worktree from the parent
repo, expect the shell to lose its cwd" gotcha — this session is the reference implementation.

## 7. Pitfalls & dead ends

- **Legacy-file trap:** the spec named `wizard-state.ts`/`server-lifecycle.ts`, but those
  are behind `LAUNCH_SOURCE_V2=false` and off the live startup path. Editing only them =
  dead code. → Always trace the live path (`main.ts` → `selectLaunchSource()`) first.
- **Monorepo test-filter miss:** the workspace filter didn't pick up newly-added test files.
  → Run vitest **scoped to the package** (`cd packages/electron && npx vitest run src/...`).
- **Pre-existing TS noise:** `tsc --noEmit` reports errors in `image-fit-extension` /
  `automation-plugin` unrelated to your change. → Filter them out
  (`grep -vE "image-fit-extension"`); confirm none reference your files; CI resolves them.
- **Heredoc choked the PR body:** special chars broke the inline `gh pr create` heredoc.
  → Write the body to a file (`/tmp/pr-body.md`) and pass `--body-file`.
- **CodeRabbit finding that contradicts the spec:** #1 wanted `PI_GATEWAY_BIND` default
  `127.0.0.1`, but the archived spec requires "external pi sessions connect by default."
  → **Skip it and document why in a PR comment** — don't create code/spec drift.
- **Shell pinned to a deleted directory:** after removing the worktree, the bash tool's cwd
  no longer existed. → Operate branch/worktree deletion from the **parent** repo path; fall
  back to the sandbox shell (spawns fresh) to run final verification.
- **Missing `.dockerignore` risk:** build context is the repo root — without it,
  `node_modules`/`.git`/`.worktrees` ship to the daemon. → Verify a root `.dockerignore`
  exists (it did) before trusting the build.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the completed OpenSpec change (`openspec/changes/docker-packaging/`
proposal + design + tasks) in the parent repo; a worktree on `os/docker-packaging`;
`gh` authed; `origin/develop` as the base branch.

**Steps:**
1. From the worktree: `/skill:openspec-apply-change docker-packaging`.
2. First message: **artifacts→parent repo, code+checkboxes→worktree branch.**
3. Confirm the grouped plan (28 tasks → 8 groups) before any write.
4. Mechanical `docker/` files straight through; the two code changes TDD-first.
5. Trace the live mode path before editing spec-named Electron files; approve the corrected
   plan if they're legacy.
6. Delegate `docs/` writes (subagent, caveman style); write `README`/`docker/README`/
   `AGENTS.md` directly.
7. Verify: scoped vitest + `tsc --noEmit` (filter pre-existing) + shell/JS syntax + root
   `.dockerignore`.
8. Ship: commit → rebase `origin/develop` → archive+sync → push → PR (`--body-file`) →
   watch CI → triage CodeRabbit (apply valid / skip+document spec-contradicting) →
   re-run CI → squash-merge → delete branch + worktree **from the parent repo**.

**Final artifacts produced:** the `docker/` tree (Dockerfile, entrypoint.sh,
scripts/seed-auth.js, compose.yml + overrides + dev overlay, up.sh, .env.example, README);
server `preferences-store.ts` pin-seed + test; Electron remote mode across `wizard-state.ts`,
`wizard-ipc.ts`, `preload.ts`, `wizard.html`, `main.ts`, `server-lifecycle.ts` + test;
docs (`docker/README.md`, `README.md` section, `AGENTS.md` pointer, `docs/file-index-docker.md`);
archived change `archive/2026-06-21-docker-packaging` + synced spec (11 requirements);
merged PR **#143** on `develop` (squash `d3ac3f04`).

---

_Generated from session `019ee68d` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-21. Source extract: deterministic facts sheet (docker-packaging)._
