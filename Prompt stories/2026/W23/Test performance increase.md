---
session: 019e9e7c
week: 2026/W23
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [parallelize-test-suite, add-end-user-docs]
proposal_excerpt: "The vitest suite runs effectively single-threaded. Every `packages/*/vitest.config.ts` pins `pool: \"forks\"` + `maxWorkers: 1`, so each project executes its test files one at a time. On a 16-logical-core box (8 physica…"
---

# How we did it: Parallelize the vitest suite — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`) — a thinking stance, not an
implementation task. The literal first prompt was the whole explore-mode skill preamble:
*"Enter explore mode. Think deeply… you must NEVER write code or implement features… You
MAY create OpenSpec artifacts."* The real objective that emerged: **figure out why the
test suite is slow and whether it can be parallelized safely, then capture that thinking
as an OpenSpec proposal.** The suite runs effectively single-threaded — every
`packages/*/vitest.config.ts` pins `pool: "forks"` + `maxWorkers: 1`, so ~858 test files
execute one-at-a-time on a 16-logical-core box. The ask was to root-cause *why* it was
set that way and design a safe rollout to lift the cap.

## 2. TL;DR playbook

1. **Start in explore mode** (`openspec-explore`) so the AI investigates and diagrams
   instead of jumping to edits. Say: "explore why the tests are slow — don't implement."
2. **Anchor on the real root config**, not mirror dirs. Tell it up front to ignore
   `.shadow/` and `.worktrees/` copies — they double the file counts and mislead the audit.
3. **Confirm the smoking gun**: grep every `vitest.config.ts` for `maxWorkers` + `pool`,
   and check `os.cpus()` vs the pinned worker count. One core of sixteen = the whole story.
4. **Ask "why was it set that way?"** — chase the commit that introduced the cap
   (`6a1b1d82 feat(testing): isolate test environment from live pi sessions`). The
   constraint (shared `HOME` / single localStorage file) explains the serial pin.
5. **Triage the contention surface file-by-file**, don't trust the blunt cap. Bucket every
   server/client test: pure · self-isolating · server-boot · shared-HOME. Most are already
   parallel-safe.
6. **Let the audit correct itself** — the real blocker turned out to be **hardcoded ports
   (6 outright collisions on 19200/19700), not HOME**. Re-scan when the first theory smells off.
7. **Create the proposal**: `openspec change new parallelize-test-suite`, write all four
   artifacts (proposal/design/tasks/spec), then `openspec validate`.
8. **Commit only your proposal files**: `git add openspec/changes/parallelize-test-suite`,
   verify staged scope, commit. Leave unrelated working-tree changes untouched.

## 3. How the collaboration unfolded

**Phase A — Discovery (explore stance).** The AI read the root + per-package vitest configs
and immediately flagged noise from `.shadow/`/`.worktrees/` mirrors, narrowing to real
config. It confirmed `maxWorkers: 1` + `pool: "forks"` across every project and measured
the box (16 logical / 8 physical). *Why it worked:* it grounded the claim in a CPU-vs-worker
count before theorizing — the diagram of "1 worker, 15 idle cores" made the problem undeniable.

**Phase B — Root-cause the constraint.** Rather than declaring the cap a mistake, the AI
traced *why* it exists: commit `6a1b1d82` isolates tests from live pi sessions via a shared
`HOME=$(mktemp -d)` + a single `--localstorage-file`. That shared state is the reason for
serial execution. *Decision point:* the human confirmed the direction ("I removed worktrees")
which cleared the mirror-dir noise and let the audit proceed on real files only.

**Phase C — Triage the contention surface.** The AI classified all 449 server+client files
into pure / self-isolating / server-boot / shared-HOME buckets. First optimistic pass said
"only ~6 real-HOME-risk files." Then it **self-corrected**: the true blocker is
**hardcoded ports** — 18 server-boot files use fixed ports, 6 of which collide outright
(19200 ×3, 19700 ×3). *Why it worked:* it re-ran the scan when the HOME theory undershot,
landing on a concrete, fixable blocker instead of a vague "tests share state."

**Phase D — Generate the proposal.** On "ok, create proposal," the AI scaffolded via
`openspec change new`, studied the existing `add-end-user-docs` change for format, and wrote
four artifacts with a **3-phase risk-ordered rollout** (pure→client→server, server gated
behind a per-file HOME hook + port migration). Then `openspec validate` passed.

**Phase E — Commit.** On "commit proposal," it staged *only* `openspec/changes/parallelize-test-suite`,
confirmed no stray files were caught, and committed (4 files, 219 insertions), explicitly
leaving other unstaged working-tree changes alone.

## 4. Prompts that worked

- **The goal prompt (explore mode):** launching via `openspec-explore` was the high-leverage
  move — it put the AI in *investigate + diagram, never implement* mode, which is exactly
  right for a "why is X slow + is it safe to change" question. Reuse: *"Enter explore mode.
  Root-cause why the tests are slow; audit whether they can run in parallel safely; don't
  write any implementation."*
- **"ok, create proposal"** — a 3-word unlock. It worked only because the exploration had
  already produced a grounded, self-corrected audit; the AI had all the material to write
  four coherent artifacts in one shot.
- **"commit proposal"** — clean handoff; the AI scoped the commit to just the proposal dir.
- *Weak-prompt rewrite:* "I removed worktrees" was reactive. Stronger up front:
  *"Ignore `.shadow/` and `.worktrees/` mirror dirs — audit only the real root config."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Count mirror-dir copies (`.shadow/`, `.worktrees/`) as real test files, inflating the audit | "okay. I removed worktrees" | State up front: audit the root config only; exclude mirror dirs |
| Trust the blunt `maxWorkers: 1` and the first "it's HOME contention" theory | (self-corrected, but prompt it) | Ask "verify the actual blocker file-by-file — is it HOME or ports?" |
| Stay in analysis | "ok, create proposal" | Give the explicit transition-to-artifact prompt once the audit is grounded |
| Potentially over-stage on commit | "commit proposal" (AI scoped it to the change dir) | Say "stage only `openspec/changes/<name>` and leave other changes" |

Key quality bar the human enforced implicitly: **explore first, propose second, implement
never (yet).** The proposal captures thinking; it does not touch a single `vitest.config.ts`.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session. The reusable asset is the **OpenSpec
proposal itself** (`parallelize-test-suite`) — a durable, validated artifact that encodes
the audit and a risk-ordered rollout so implementation can proceed later without re-deriving
the contention analysis.

*Recommended skill to create* if this pattern recurs: a **"parallel-safety audit"** procedure —
bucket test files (pure / self-isolating / boot-with-shared-state / hardcoded-port), then
gate any `maxWorkers` lift behind fixing the collision set. It removes the manual re-triage
and the temptation to trust the blunt worker cap over per-file reality.

## 7. Pitfalls & dead ends

- **Mirror-dir noise.** `.shadow/` and `.worktrees/` copies double test counts and derail the
  audit. Exclude them before counting anything.
- **"It's HOME contention" is the *wrong* first answer.** The shared `HOME` explains the
  historical cap but is mostly already handled (~6 real-risk files). The live blocker is
  **hardcoded ports** — 18 files, 6 colliding (19200, 19700). Verify per-file before concluding.
- **Sandbox cwd drift.** A `ctx_execute` loop-parser step failed and another needed an
  **absolute path** because the sandbox cwd differed from the repo root. Use absolute paths
  in analysis scripts.
- **Quote-escaping bug** in one scan command — mind shell quoting when grepping port literals.
- **Don't lift `maxWorkers` before the gate.** Server parallelism must be gated behind the
  per-file HOME hook (setupFiles) + migrating the 18 fixed-port files to `createTestServer()`/
  `port:0`, or the 6 collisions break the run.

## 8. Reproduce it faster — checklist

- [ ] Launch in **explore mode** (`openspec-explore`); state "root-cause + audit, don't implement."
- [ ] Exclude `.shadow/`/`.worktrees/`; grep `maxWorkers` + `pool` across all `vitest.config.ts`.
- [ ] Compare pinned workers to `os.cpus()` — confirm the serial cap.
- [ ] Trace the introducing commit (`git log -S maxWorkers` → `6a1b1d82`) for the *why*.
- [ ] Bucket server+client files: pure / self-isolating / server-boot / shared-HOME.
- [ ] Re-scan for **hardcoded port literals**; list collisions (expect 19200, 19700).
- [ ] `openspec change new parallelize-test-suite`; write proposal/design/tasks/spec; `openspec validate`.
- [ ] `git add openspec/changes/parallelize-test-suite`; verify scope; commit.

**Inputs to have ready:** repo root (not a worktree), `openspec` CLI, an existing change
(`add-end-user-docs`) to mirror the artifact format.

**Artifacts produced:**
- `openspec/changes/parallelize-test-suite/proposal.md`
- `openspec/changes/parallelize-test-suite/design.md`
- `openspec/changes/parallelize-test-suite/tasks.md`
- `openspec/changes/parallelize-test-suite/specs/parallel-test-execution/spec.md`

---

_Generated from session `019e9e7c-e6bf-79b4-8695-e571c811096b` · `pi-agent-dashboard` · 2026-06-06. Source extract: deterministic facts sheet (session-to-guideline)._
