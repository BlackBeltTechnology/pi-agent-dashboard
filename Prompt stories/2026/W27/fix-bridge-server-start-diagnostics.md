---
session: 019f164a
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [fix-bridge-server-start-diagnostics]
proposal_excerpt: "GitHub issue #99: \"fails to start, and there's no logfile as claimed.\""
---

# How we did it: Fix bridge server-start diagnostics — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change fix-bridge-server-start-diagnostics
```

The real objective behind the change (GitHub issue #99): the dashboard **"fails to
start, and there's no logfile as claimed."** The bridge auto-spawn path launched the
server with `stdio: "ignore"` and a 2-second readiness window, then — on failure —
pointed users at a `~/.pi/dashboard/server.log` it *never wrote*. That is a dead-end
diagnostic. The task: make the auto-spawn path write a real, inspectable log, give
slow cold starts enough time to boot without a false warning, and make every failure
message reference the log that actually exists. Then verify it, and land it.

## 2. TL;DR playbook

1. **Apply the change with the skill.** `/skill:openspec-apply-change fix-bridge-server-start-diagnostics` — it reads context files, walks tasks.md, and drives the edits.
2. **Confirm the real symbol name before editing.** The spec's shorthand `getServerLogPath()` does not exist; the exported helper is `getDashboardServerLogPath()`. Grep first (`grep -rn getServerLogPath packages/shared/src`), edit against reality.
3. **Make the two source fixes.** `server-launcher.ts`: `stdio: { logFile: getDashboardServerLogPath() }` + `healthTimeoutMs: 10_000`. `server-auto-start.ts`: derive the warning path from the shared helper; drop the now-unused `os`/`path` imports.
4. **Update tests to pin the contract** (extension stdio/timeout, warning text, a slow-cold-start scenario), then run the three touched files with `HOME=$(mktemp -d) npx vitest run …` so real-fs paths resolve.
5. **Filter the full suite.** `npm test 2>&1 | tee /tmp/pi-test.log` — expect environmental failures (live :8000 server, broken jimp dep). Confirm none are in your changed files.
6. **When asked to test in a real browser:** run Playwright against the docker harness with **system Chrome** (`channel: "chrome"`) via a throwaway config + a health-check-only globalSetup that skips the bundled-chromium preflight. Boot an isolated seeded container, attach with `PW_E2E_USE_RUNNING=1`, tear down after.
7. **Don't let E2E masquerade as the manual-QA task.** Verify the architecture: the bridge auto-spawn + TUI `ctx.ui.notify` warning is a surface Playwright cannot observe. Leave 5.3 as human QA.
8. **Ship with the skill.** `ship-change`: mark deferred manual task done, verify gate (filter environmental redness), sync delta spec surgically into `openspec/specs/`, archive, commit, push, open PR against `develop`.
9. **Wait out CodeRabbit rate-limit, then trigger a full review.** Triage each finding: fix real gaps (TDD), sweep doc-name shorthand, defer false positives with a posted rationale + resolve the thread.
10. **Loop until CI green + zero actionable threads, then squash-merge**, delete remote branch, remove the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Apply (spec-driven implementation).** The AI ran `openspec-apply-change`,
read the context + source files, and immediately hit the first landmine: the spec
referenced `getServerLogPath()` but the shared package actually exports
`getDashboardServerLogPath()`. It grepped to confirm, then edited against the real
symbol. It made the two source fixes, updated three test files to pin the new
`stdio:{logFile}` + 10 s contract and a slow-cold-start scenario, and ran them green
(44/44) with `HOME` set to a tmp dir. *Why it worked:* verifying the exported name
before editing avoided propagating a phantom symbol into code.

**Phase 2 — Full-suite triage.** `npm test` showed 29 (later 24) failures. Rather
than chase them, the AI proved they were environmental: a **live dashboard on :8000**
(port conflicts for server integration tests) and a **broken jimp native dep**
(`Jimp is not a constructor`). None touched the changed files. *Decision point:* the
human's standing bar was "no new failures in my diff," not "green everything."

**Phase 3 — System-browser E2E spike** (steering: *"run system browser with
playwright against docker image"*). No bundled Playwright chromium was cached, so the
AI drove the **OS Chrome** via `channel: "chrome"`. The committed globalSetup's
`assertBrowserInstalled()` hard-fails when bundled chromium is missing, so the AI
wrote a **throwaway** config + health-check-only globalSetup (both deleted after).
First run: 6 passed then 14 `ERR_CONNECTION_REFUSED` — the container vanished
mid-run. Root cause: a **concurrent worktree** (`os-optimistic-prompt-progress`) was
churning docker with a parallel `up --build`, reaping all `pi-dash-test-*` projects.
A clean retry on an isolated compose project gave **19 passed, 1 failed** (a UI
overlay timing quirk, not connectivity). *Why it worked:* the AI isolated the
container and diagnosed external interference instead of blaming its own config.

**Phase 4 — "Can manual tests be replaced with Playwright?"** The AI verified the
architecture rather than answering from intuition, and said **no** with three
code-confirmed blockers: (1) the docker harness boots the server via
`pi-dashboard start` — it never exercises the *bridge auto-spawn* path; (2) the "no
longer warns" signal is a **TUI** `ctx.ui.notify`, invisible to a browser; (3) the
"slow host" premise is non-deterministic. Manual QA (task 5.3) stays.

**Phase 5 — Ship** (steering: *"I will tests later, use ship-change skill"*). Marked
5.3 done (deferred), passed the verify gate as a filtered judgment call, **surgically
merged** the delta spec into `server-launch/spec.md` (a blind replace would have
dropped the requirement's other 5 scenarios), archived, committed, pushed, opened
PR #205 against `develop`.

**Phase 6 — CI + CodeRabbit loop.** CI green. CodeRabbit's first "pass" was a
**rate-limited ACK**, not a real review — the AI waited ~15 min, triggered
`@coderabbitai full review`, got 3 findings, and triaged: swept the `getServerLogPath`
doc shorthand; fixed a **real correctness gap** (the "See log:" suffix was appended
even for `JitiNotFoundError`, which throws *before* the log opens — the change's own
proposal said not to) via TDD; deferred the "move out of archive/" false positive with
a posted rationale + resolved thread. Re-pushed, re-watched CI green, exited the loop,
squash-merged (`8920382e`), deleted the remote branch, removed the worktree.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change fix-bridge-server-start-diagnostics`.
  A single skill invocation naming the change is the ideal kickoff: it hands the AI the
  full spec, tasks, and design context with zero ambiguity. Stronger still: pair it
  with the acceptance bar up front ("no new failures in my changed files; environmental
  redness is OK").
- **"run system browser with playwright against docker image"** — a terse redirect that
  unlocked a whole spike. Effective because it named the *constraint* (system browser,
  docker image), letting the AI discover the bundled-chromium blocker itself.
- **"Can manual tests be replaced with playwright one?"** — a high-leverage *question*
  (not an instruction). It forced an architecture verification that correctly preserved
  the manual-QA task instead of silently deleting it.
- **"I will tests later, use ship-change skill"** — the decisive scope-closer: defer
  manual QA, invoke the shipping skill. Repeated to keep the AI on the ship path through
  the CodeRabbit wait.
- **"go on"** — trivial but effective continuation past a long rate-limit wait.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat unit/task tests as sufficient verification | "run system browser with playwright against docker image" | State the verification surface in the goal ("also drive the rendered UI in a real browser") |
| Risk answering "replace manual with E2E?" from intuition | "Can manual tests replaced with playwright one?" (a question) | Ask the AI to *verify the architecture in code* before claiming a layer can replace another |
| Keep polishing / re-verifying instead of landing | "I will tests later, use ship-change skill" (x3) | Say "defer manual QA and ship" once the diff is green in its own files |
| Take CodeRabbit's first "pass" at face value | (implicit in ship-change skill) — waited out the rate-limit ACK | Always confirm CodeRabbit *actually reviewed* vs a rate-limited placeholder before merging |

Quality bars the human imposed: environmental failures (live :8000, jimp) are
acceptable and must be *proven* environmental, not assumed; the manual "slow host"
QA task is not something a browser test can stand in for; the change must honor its
own proposal ("no 'see log' when no log was written").

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created, but the session leaned on and validated three
existing skills — and surfaced a reusable pattern worth capturing:

- **`openspec-apply-change`** — walked tasks.md end-to-end; effective because it kept
  the edit/verify loop tied to the spec's task list.
- **`ship-change`** — carried the full land sequence (defer manual task → verify gate →
  sync spec → archive → PR → CodeRabbit loop → squash-merge → worktree cleanup). Its
  built-in guardrail ("CodeRabbit 'pass' can be a rate-limited ACK") is exactly what
  prevented a premature merge.
- **System-Chrome E2E override** — the throwaway `playwright.system-chrome.config.ts`
  (`channel: "chrome"`) + health-check-only `global-setup.system-chrome.ts` that skips
  `assertBrowserInstalled()`. **This should be a project skill:** it removes the need
  for bundled chromium, isolates its own compose project, and is the reproducible way
  to E2E-drive the docker harness with the OS browser. *Invoke it* whenever bundled
  Playwright chromium is missing but system Chrome is present.

## 7. Pitfalls & dead ends

- **Phantom symbol name.** The spec/design/tasks all said `getServerLogPath()`; the
  real export is `getDashboardServerLogPath()`. → Grep the shared package before
  editing; sweep the docs with `sed -i '' 's/getServerLogPath()/getDashboardServerLogPath()/g'`.
- **Vitest resolving real-fs paths fails without HOME.** → Prefix with
  `HOME=$(mktemp -d) npx vitest run …`.
- **Environmental test noise looks like regressions.** A live dashboard on :8000 and a
  broken jimp dep produced 20–29 failures unrelated to the change. → Filter to your
  changed files; confirm the failure reasons (`ERR port bind`, `Jimp is not a
  constructor`) are environmental.
- **Concurrent worktree reaped the E2E container mid-run.** A parallel `up --build` in
  another worktree destroyed all `pi-dash-test-*` projects → 14 `ERR_CONNECTION_REFUSED`.
  → Use an isolated compose project, and just retry on a quiet docker host.
- **Playwright cannot see the bridge warning.** The warning is a TUI `ctx.ui.notify`,
  and the harness boots the server via `pi-dashboard start` (never the bridge
  auto-spawn). → Don't try to automate task 5.3; keep it as manual QA.
- **CodeRabbit's first "pass" was a rate-limit ACK.** → Wait out the window (~15 min),
  post `@coderabbitai full review`, then triage the real threads.
- **Blind delta-spec replace would drop scenarios.** The delta was partial. → Surgically
  merge only the intended modifications into `server-launch/spec.md`.
- **`gh pr merge --delete-branch` failed the local checkout step** (worktree/`develop`
  collision). → Delete the remote branch explicitly, then remove the worktree from the
  parent repo.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; `gh` authenticated; docker running;
system Google Chrome installed; awareness of any live dashboard on :8000.

- [ ] `/skill:openspec-apply-change fix-bridge-server-start-diagnostics`
- [ ] Grep the real exported symbol before editing; sweep docs for the shorthand
- [ ] Source fixes: `stdio:{ logFile: getDashboardServerLogPath() }`, `healthTimeoutMs: 10_000`, shared-helper warning path, `logOwned` gate on the "See log:" suffix
- [ ] `HOME=$(mktemp -d) npx vitest run <3 touched files>` → green
- [ ] `npm test | tee /tmp/pi-test.log`; confirm failures are environmental only
- [ ] (optional) System-Chrome E2E: throwaway config + health-only globalSetup, isolated seeded container, `PW_E2E_USE_RUNNING=1`, tear down
- [ ] Keep manual "slow host" QA (5.3) — not automatable via browser
- [ ] `ship-change`: verify gate → surgical spec sync → archive → PR vs `develop`
- [ ] Wait out CodeRabbit rate-limit → `@coderabbitai full review` → triage (fix real, defer false-positive with rationale)
- [ ] Loop until CI green + 0 actionable threads → squash-merge → delete remote branch → remove worktree

**Final artifacts produced:**
- `packages/extension/src/server-launcher.ts`, `server-auto-start.ts` (+ their tests)
- `packages/shared/src/__tests__/server-launcher.test.ts`
- `openspec/specs/server-launch/spec.md` (synced)
- `openspec/changes/archive/2026-06-30-fix-bridge-server-start-diagnostics/`
- PR [#205](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/205) → merged `8920382e` on `develop`

---

_Generated from session `019f164a-a1ab-7162-b636-6f1230c7bdfa` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-30. Source extract: `/tmp/facts-82506-23696.md`._
