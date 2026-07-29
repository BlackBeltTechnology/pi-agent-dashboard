---
session: 019f09aa
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "large facts sheet (~13978 tok)"
upgrade_status: pending
openspec_changes: [serve-agent-artifact-previews, inline-agent-screenshot-artifacts, inline-image-tool-results]
proposal_excerpt: "Tool output linkifies absolute paths and the dashboard previews them. Agent tools write artifacts to a **per-user, cross-repo temp dir**, not into any session repo. The `browser` skill saves screenshots to `~/.agent-b…"
---

# How we did it: Inline agent screenshot artifacts at capture — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a single skill invocation:

```
/skill:openspec-apply-change inline-agent-screenshot-artifacts
```

The *real* objective, once the change's spec and the three steering turns clarified
it: implement **Fix B** — when any agent tool (e.g. the `browser` skill's screenshot)
writes an image and echoes an absolute path in its result text, the bridge should
**inline the image bytes at capture** (`tool_execution_end`), emit a `type:"image"`
content block, strip the consumed path from the result, and have the dashboard
render it as an auto-expanded inline `<img>`. Then take it all the way to shipped:
implement → prove it with a Docker E2E → rebase → ship via the ship-change pipeline,
triaging CodeRabbit and landing a security gate before merge.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — read the change's `tasks.md` + context
   files first; implement tasks in order, tests before wiring.
2. Build the **pure** extraction module first (`tool-result-image-inliner.ts`), then
   wire it into `bridge.ts` at the `tool_execution_end` branch — pure core + thin
   bridge seam keeps it unit-testable.
3. DRY the client: one shared `ToolResultImages.tsx`, reused by Read/Generic/Bash
   renderers; let `ToolCallStep` auto-expand on `hasImages`.
4. Run the full unit suite with an isolated HOME: `HOME=$(mktemp -d) npm test` — a
   fresh worktree needs `npm install` first (no inherited `node_modules`).
5. When asked "can Docker E2E fulfil the QA task?" — verify the **faux** harness
   really executes the tool (faux emits only the *call*; pi runs it for real), then
   write a **terminating 2-step** faux scenario (tool call → text) + a Playwright spec.
6. Bake changes into the image (`packages/` are baked, only `qa/fixtures` is mounted):
   `docker compose -f compose.yml -f compose.test.yml build`, then run one clean
   container per run — stale/looping containers pollute the port and starve spawns.
7. `rebase to develop` on a clean tree (commit first), then drive `ship-change`:
   verify gate → `openspec archive` (syncs specs) → PR → watch CI + CodeRabbit.
8. Triage CodeRabbit: auto-apply safe/local fixes, reply-with-rationale on items that
   contradict the approved proposal — but when a 🔴 Critical security point stands,
   implement the gate (artifact-root allowlist) rather than defer it.
9. Squash-merge from within the worktree; do branch/worktree cleanup **from the parent
   repo** (develop is checked out there, and this session runs *inside* the worktree).

## 3. How the collaboration unfolded

**Phase 1 — Apply (implement the change).** The AI read the change status, context
files, and existing test conventions, then implemented top-down: a single-path
inliner (`inlineLocalImagePath`) added *alongside* the existing `inlineMessageText`
(not refactored into it — their cap-ordering differs, so a merge would be risky), a
new pure `tool-result-image-inliner.ts`, bridge wiring at `tool_execution_end`, and a
shared client `ToolResultImages` component consumed by three renderers. Tests were
written next to each unit. **Why it worked:** pure-core + thin-seam meant every piece
was unit-testable without a running bridge; the "add alongside, don't refactor"
judgment avoided destabilizing a working code path.

**Phase 2 — "Can Docker E2E fulfil the QA task?" (steering #1).** This question
turned a deferred manual step (task 4.2) into automated coverage. The AI first
*proved the mechanism*: the faux provider emits only the tool **call**, so pi really
executes the `bash` tool → a genuine `tool_execution_end` flows through the real
bridge (Fix B included). That justified writing a faux `tool-screenshot` scenario + a
Playwright spec. **The decision point:** confirming end-to-end reachability *before*
writing the test, rather than assuming the harness was a mock.

**Phase 3 — The debugging gauntlet.** Getting the E2E green surfaced two real bugs and
a swarm of environment faults (see §7). The AI methodically isolated each: an
infinite-loop faux scenario, a `useState(hasImages)` that never re-seeded for
post-mount images, baked-vs-mounted container confusion, a long-lived pi process that
ignored `docker exec` patches, BuildKit mis-caching `npm run build`, Docker daemon
crashes, ENOSPC, and a blocked Playwright Chromium CDN. **Why it worked:** each red run
was treated as a hypothesis to falsify with a container-inspection dump, not as a
reason to thrash the source.

**Phase 4 — Rebase (steering #2).** `rebase to develop`: the AI committed the 18-file
implementation first (clean tree precondition), rebased, and the 2 stale `file-preview`
commits auto-dropped (already in develop). Post-rebase sanity: tsc + targeted suites.

**Phase 5 — Ship (steering #3).** `use ship-cange skills` drove the full pipeline:
verify gate → `openspec archive` (syncs the delta spec into `openspec/specs/`) → PR
#177 → CI + CodeRabbit. CodeRabbit posted **10 actionable** comments. The AI fixed 6
safe/local ones, replied-with-rationale on 4 that contradicted the approved trust
model — then, on the 🔴 Critical security item, **implemented an artifact-root
allowlist gate** rather than shipping the deferral. Final: squash-merge, remote branch
deleted, worktree removed from the parent repo.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change inline-agent-screenshot-artifacts`.
  Effective because the change's `tasks.md` + proposal already encoded the objective,
  trust model, and acceptance criteria; the skill just executes a well-scoped spec.
  *Make it stronger by:* ensuring the change spec names the QA/manual tasks explicitly
  so the agent knows what "done" excludes.
- **High-leverage follow-up** — *"Is it possible to test with docker e2e to fulfill QA
  task?"* This one question converted a manual post-merge step into automated coverage
  **and** flushed out the real auto-expand product bug. A single "can we automate this?"
  paid for itself many times over.
- **"rebase to develop"** — short, unambiguous; the AI handled the clean-tree
  precondition (commit first) without being told.
- **"use ship-cange skills"** (typo and all) — enough to hand the whole landing
  pipeline to the ship-change skill.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at implementation + defer the manual QA task | "Is it possible to test with docker e2e to fulfill QA task?" | Make "can this manual task be an E2E?" a standing checkpoint in apply/ship |
| Trust a red E2E as a Fix-B defect | (self-corrected) inspect the live container before blaming source | Always dump container/DOM state on a red E2E before editing product code |
| Test against a stale/looping container | (self-corrected) recreate one clean container per run | One fresh container per E2E run; prune stale ones colliding on the port |
| Assume `docker exec` patches take effect | (self-corrected) found the long-lived boot-time pi process | Restart the container to recompile a patched bridge; exec-patching a running process is a no-op |
| Consider deferring the 🔴 Critical security finding | Chose "add gating → merge" | Treat a Critical security review point as blocking unless the proposal explicitly rules it out |

## 6. Skills, tools & memory created — and why they're effective

No new persistent skill or memory was created in-session, but the workflow leaned on
several existing skills as the backbone: `openspec-apply-change` (implement),
`ship-change` (land), and the Docker E2E harness (`docker/test-up.sh` + `tests/e2e/`).

**Recommended skill to create:** *"Docker-E2E-from-a-manual-QA-task"* — capturing the
reproducible sequence: (1) confirm the faux harness executes the real tool, (2) write a
**terminating** 2-step faux scenario, (3) rebuild the baked image for `packages/`
changes, (4) one clean container per run, (5) the Chromium-CDN-blocked fallback
(`channel: chrome` + symlink the system binary into the bundled path to satisfy the
self-heal guard). This session paid the full discovery cost once; a skill would remove
~2 hours of environment-fault archaeology next time.

## 7. Pitfalls & dead ends

- **Single-step faux scenario loops forever.** The faux router repeats the last step,
  so a one-step tool scenario re-fires the same `bash` call every ~1.2s and the agent
  never terminates. **Fix:** a 2-step scenario (tool call → text), like
  `ask-select-roundtrip`.
- **`useState(hasImages)` never re-seeds.** Tool cards mount at
  `tool_execution_start` (no images); images arrive at `tool_execution_end`. The
  initial `useState` value is frozen, so cards stayed collapsed. **Fix:** a one-shot
  `useEffect` that expands when images first appear (fixes auto-expand for all tools).
- **`packages/` are baked, not mounted.** Only `qa/fixtures` is bind-mounted; source
  changes require a **rebuild**. `docker exec` edits to `/app` do nothing to a
  long-lived boot-time pi process — **restart the container** to recompile.
- **BuildKit mis-caches `npm run build`.** `COPY packages → CACHED` even after an
  edit; the client dist stayed stale (16:20 timestamp). Verify the dist timestamp in
  the image; force a clean rebuild when the layer mis-caches.
- **Fresh worktree has no `node_modules`.** Run `npm install` before the suite; then
  restore `package-lock.json` (`git checkout package-lock.json`) since no deps changed.
- **Environment faults, not code faults:** Docker Desktop crashed mid-run; ENOSPC from
  accumulated build cache (freed 69GB via `docker builder prune`); Playwright Chromium
  CDN timed out repeatedly → worked around with `channel: chrome` + a config override
  inside the repo (a `/tmp` config can't resolve repo imports) + symlinking system
  Chrome into the bundled path to satisfy the `self-heal-host-playwright-browser` guard.
- **Stale review output.** `review-changes.ts` returned a cached parse from a *different*
  worktree ("5 Critical/Warning"). A fresh, correctly-scoped `coderabbit review` run
  showed 0 — always re-run the gate in the current worktree.
- **`--delete-branch` fails inside the worktree.** develop is checked out in the parent;
  do branch + worktree cleanup **from the parent repo**. Removing the worktree orphans
  this session's shell (expected final state) — verify everything *before* removal.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The OpenSpec change with `tasks.md` naming implementable vs. manual/QA tasks.
- A working Docker daemon with headroom (`docker builder prune` if ENOSPC).
- System Chrome (fallback when the Playwright Chromium CDN is blocked).
- `coderabbit` CLI for the advisory review gate.

**Checklist:**
1. `/skill:openspec-apply-change <change>` → read tasks + context first.
2. Pure extraction module → bridge seam at `tool_execution_end` → shared client
   component; tests beside each unit.
3. `HOME=$(mktemp -d) npm test` (after `npm install` in a fresh worktree); `tsc`; build.
4. Automate the manual QA task: confirm faux executes the real tool → **terminating**
   2-step faux scenario → Playwright spec.
5. Rebuild the baked image for `packages/` changes; **one clean container per run**.
6. `rebase to develop` on a clean tree (commit first).
7. `ship-change`: verify gate → `openspec archive` → PR → watch CI + CodeRabbit.
8. Triage review: fix safe/local; reply-with-rationale on proposal-contradicting items;
   **implement** any Critical security gate before merge.
9. Squash-merge; cleanup branch + worktree **from the parent repo**.

**Final artifacts produced (PR #177, merged `1d5b5d85`):**
- `packages/extension/src/tool-result-image-inliner.ts` (+ test)
- `packages/extension/src/artifact-roots.ts` (+ test) — security allowlist gate
- `packages/extension/src/markdown-image-inliner.ts` (+ `inlineLocalImagePath`)
- `packages/extension/src/bridge.ts` (wiring at `tool_execution_end`)
- `packages/client/src/components/tool-renderers/ToolResultImages.tsx` + Read/Generic/Bash renderers
- `packages/client/src/components/ToolCallStep.tsx` (one-shot auto-expand effect)
- `tests/e2e/inline-screenshot.spec.ts` + `qa/fixtures/faux-scenarios.ts` (`tool-screenshot`)
- `openspec/specs/inline-artifact-image-paths/spec.md` (synced delta)

---

_Generated from session `019f09aa-b46b-7c95-8f6b-54c12049972f` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-27. Source extract: `/tmp/facts-39195-25078.md`._
