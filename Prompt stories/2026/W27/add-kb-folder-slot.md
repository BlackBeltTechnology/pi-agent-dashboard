---
session: 019f2593
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts); large facts sheet (~16929 tok)"
upgrade_status: pending
openspec_changes: [add-kb-folder-slot]
proposal_excerpt: "The markdown knowledge base (`@blackbelt-technology/pi-dashboard-kb`) is invisible in the dashboard. Two facts about how it updates create a real trap:"
---

# How we did it: Ship the `add-kb-folder-slot` dashboard plugin — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened on a fully-drafted OpenSpec change (`add-kb-folder-slot`: proposal +
design + tasks + mockups already written) and asked simply: **"Is there anything to
clarify?"** The real objective, revealed across six terse steering turns, was the whole
delivery arc: **validate the spec is airtight, implement the 27-task `packages/kb-plugin`
(a Layer-3 dashboard plugin that surfaces the markdown knowledge base as a per-folder
sidebar row with a session-less reindex), prove it end-to-end with Playwright against the
Docker harness, then ship it — commit, PR, resolve conflicts, squash-merge, tear down the
worktree.** The whole run was one continuous "spec → code → live-verify → land" pipeline
driven by ~one-word prompts.

## 2. TL;DR playbook

1. **Kick off with "Is there anything to clarify?"** on a complete change — let the AI do a
   pre-implementation spec audit instead of coding blind. It found a real gap (the `error`
   row state was underivable from `/api/kb/stats`).
2. **Say "patch"** to fold the discovered gap back into design.md + spec.md + tasks.md
   *before* writing code — keep the artifacts the source of truth.
3. **Invoke `/skill:openspec-apply-change <name>`** to implement. Let the AI read the
   template plugin (`goal-plugin`) + the `kb` package API *in parallel* before writing.
4. **When the AI flags a host-seam blocker, pick "provide/consume"** — the plugin
   `consume()`s a `knownFolderCwds` getter the server `provide()`s, instead of editing core.
5. **Ask "can you verify with Playwright + Docker?"** — the harness builds from baked
   source, so `docker/test-up.sh -d --build` bakes the plugin in; drive the *real*
   containerized dashboard.
6. **Put fixtures in `docker/fixtures/`** (materializes writable at `/fixtures/<name>` in
   managed + manual modes) — not `qa/fixtures/` (read-only bind, KB db can't write).
7. **Scope E2E rows via an existing per-cwd testid** (`folder-urgency-sort-${cwd}` + xpath
   ancestor walk), never a new app testid.
8. **Before "merge PR", let the AI reconcile literal-vs-actual state** — there was no PR and
   nothing committed. Then: CodeRabbit gate → openspec archive → commit → push → PR → rebase
   conflict → squash-merge → remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Spec audit (prompt 1).** Rather than trust "looks complete", the AI ran
`openspec validate --strict`, read the delta spec + all five mockups, and cross-checked the
client's five-state derivation against the `/api/kb/stats` response shape. It surfaced **one
genuine gap**: the `error → Retry` state had no backing field — a failed async first index
would misrender as `not-indexed`. *Why it worked:* the audit compared two artifacts (state
machine vs API contract) that a human rarely diffs by hand.

**Phase 2 — Patch the artifacts (prompt 2 "patch").** The AI added `jobStatus` + `lastError`
to the stats contract in design §3/§5, spec.md (new error-state scenario), and tasks 1.1/
1.3/3.2 — then re-validated. *Decision point:* fix the spec first, not the code.

**Phase 3 — Implement (prompt 3, the apply skill).** The AI read the scaffold skill,
`goal-plugin` (template), and the `kb` package API in parallel, mapped the full surface, then
hit a **real blocker**: cwd validation needs `preferencesStore.getPinnedDirectories()`, but a
plugin's `ServerPluginContext` exposes only `sessionManager` — fatal for the session-less
worktree case (reachable only via pinned dirs). It **paused and asked** rather than silently
expanding scope. After the operator chose provide/consume, it wired a 12-line host seam in
`server.ts`, built the package (~20 source files + 47 tests), kept the server.ts diff surgical
(reverted Biome's whole-file reformat), and delegated all `docs/` rows to subagents.

**Phase 4 — Live E2E (prompts 4 + 5).** The AI confirmed Docker/Playwright present, found the
harness builds from **baked source**, and drove the real dashboard. Mapping the flow surfaced
a second **reachability gap** (settings unreachable in `not-indexed`/`error` states → the
worktree-bootstrap dead-ends); it fixed the label to be a settings link in every state. It
authored `tests/e2e/kb-folder-slot.spec.ts` + a two-folder Copy-from-parent scenario, fighting
through fixture-location, click-dispatch, locator-scoping, and loading-state-race issues (§7).

**Phase 5 — Ship (prompt 6 "merge PR and delete worktree").** The AI **caught that the literal
ask was impossible** — no PR, zero commits, everything uncommitted. It ran the CodeRabbit gate
(clean), archived the OpenSpec change, committed (45 files), pushed, opened PR #219, rebased a
1-commit conflict on `develop`, squash-merged, and removed the worktree.

## 4. Prompts that worked

- **The goal prompt — "Is there anything to clarify?"** Deceptively strong: on a complete
  spec it triggers an audit pass instead of coding. Stronger still: *"Audit this change for
  spec gaps before implementing — diff the client state machine against the API contract."*
- **"patch"** — a one-word unlock that told the AI to apply its own proposed fixes. Works only
  because the prior turn ended with a concrete, enumerated fix list.
- **"Is it possible to check the remaining tasks with playwright and docker?"** — high-leverage:
  converted two "can't-run-in-worktree" checkbox tasks into real automated coverage.
- **"yes"** — unlocked the full Copy-from-parent two-folder E2E after the AI proposed it.
- **"merge PR and delete worktree"** — intentionally literal; its value was forcing the AI to
  reconcile the ask against actual git state and lay out the real pipeline first.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat a "complete" spec as ready to code | "Is there anything to clarify?" | Always open an apply with a spec-audit prompt |
| Want to expand scope to fix the host-seam blocker silently | Being offered a choice and picking provide/consume | State up front: "pause and ask before editing core/shell" |
| Leave checkbox-only tasks (live QA) unverified | "check the remaining tasks with playwright and docker?" | Prefer real E2E over honest-but-unproven checkboxes |
| Let Biome `--write` reformat a whole core file | (self-caught) surgical-diff discipline | Run Biome scoped to changed files; revert unrelated churn |
| Interpret "merge PR" literally when no PR exists | (self-caught) reconciled literal vs actual state | Verify branch/commit/PR state before any irreversible step |

Corrections were mostly **self-caught** by the AI honoring project discipline (surgical
changes, confirm-before-major, pause-on-blocker) — the human's job was to unlock direction
with terse yes/patch/verify prompts.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session *consumed* existing project infrastructure
extremely well, which is the reusable lesson:

- **`/skill:openspec-apply-change`** — drove the 27-task implementation from `ready` artifacts.
  Invoke whenever a change reaches `ready` and you want disciplined task-by-task apply.
- **`docker/test-up.sh -d --build` + `PW_E2E_USE_RUNNING=1`** — build-baked harness once, then
  attach-iterate the spec with no rebuild. The single biggest time-saver for plugin E2E.
- **`SessionGuideline`-style subagent delegation for `docs/` rows** — the AI spawned 3
  general-purpose subagents to write file-index rows in caveman style, keeping the main context
  clean. Invoke for every `docs/` prose write per AGENTS.md.
- **Recommended new memory:** *"dashboard plugin fixtures go in `docker/fixtures/` (writable at
  `/fixtures/<name>`), never `qa/fixtures/` (read-only bind)."* This burned ~20 min this run.

## 7. Pitfalls & dead ends

- **Fixture in `qa/fixtures/` is read-only** → KB db write fails. Relocate to
  `docker/fixtures/kb-*` (materializes writable in every mode). *If your reindex writes 0
  chunks despite a valid config, check the mount is writable.*
- **`test-down` untags the per-worktree image** → the next `up` triggers a full rebuild that
  blows a 180s timeout. Use a long timeout on rebuild boots.
- **agent-browser `click` doesn't fire React `onClick`** for these labels (sibling Goals label
  too) — a tool click-dispatch quirk, not a bug. Verify navigation with a real Playwright
  click or a direct URL, not the browser tool.
- **E2E locator scoped to `sortable-workspace-folder` matched zero** — the KB row isn't a DOM
  descendant of that wrapper. Scope via the unconditional per-cwd testid
  `folder-urgency-sort-${cwd}` + an xpath ancestor walk.
- **Row-state race:** the row briefly reports `data-state="loading"`; a single `getAttribute`
  caught "loading" and skipped the click → infinite wait. Settle out of `loading` first.
- **Playwright `--grep`/filter ignored** → ran the whole 29-test suite (looked like a hang).
  Target the spec file explicitly.
- **CodeRabbit `--agent` mode "6 findings / 4 Critical"** was a parsing artifact (identical
  generic preamble on every "finding"); two plain-mode reviews returned "No findings". Use
  plain mode to triage.
- **`gh pr merge` printed `fatal: 'develop' is already used by worktree`** — harmless; it was
  only the local-branch switch failing. The remote squash-merge succeeded.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a `ready` OpenSpec change with mockups; Docker + Compose +
Playwright installed; system Chrome (skips the chromium download via `PW_CHANNEL=chrome`);
the `goal-plugin` as a copy-template; the `kb` package API.

**Sequence:**
1. Open the apply with a **spec-audit prompt**; patch any gap into design/spec/tasks first.
2. `/skill:openspec-apply-change <name>`; let the AI read template + API in parallel.
3. On any host-seam blocker, choose **provide/consume** over editing core.
4. Keep core-file diffs surgical; revert Biome whole-file reformats.
5. Put fixtures in `docker/fixtures/`; build the harness `-d --build`; attach-iterate with
   `PW_E2E_USE_RUNNING=1`.
6. Scope E2E via existing per-cwd testids; settle out of `loading` before asserting.
7. Before shipping, reconcile literal ask vs git state; run CodeRabbit plain-mode.
8. archive → commit → push → PR → rebase → squash-merge → remove worktree.

**Artifacts produced:** `packages/kb-plugin/` (~20 src + 47 tests), the `server.ts` host
seam, `tests/e2e/kb-folder-slot.spec.ts` (2 scenarios), `docker/fixtures/kb-sample` +
`kb-parent`, archived change `openspec/changes/archive/2026-07-03-add-kb-folder-slot`, main
spec `openspec/specs/kb-folder-slot/spec.md`, **merged PR #219** (squash `6e325e076`).

---

_Generated from session `019f2593` · `pi-agent-dashboard` · 2026-07-03. Source extract: `/tmp/kb_facts_final.md`._
