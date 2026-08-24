---
session: 019f5cae
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [fix-list-models-empty-on-unhydrated-registry]
proposal_excerpt: "The agent-facing list_models tool can return { \"models\": [] } — an empty catalogue — in two structurally different situations that are indistinguishable to the caller"
---

# How we did it: fix `list_models` empty-on-unhydrated-registry — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single slash command:

```
/skill:openspec-apply-change fix-list-models-empty-on-unhydrated-registry
```

The real objective — clarified only by the follow-up `ship-it` invocations — was:
**apply an already-specced OpenSpec change end-to-end and land it in `develop`.** The
change fixes an observability bug: the agent-facing `list_models` tool returned a bare
`{ models: [] }` in two structurally different states — *registry absent* (spawned
before hydration; the caller should retry) and *registry present but genuinely empty*
(the real "no credentialed models" answer) — with no way to tell them apart. The fix
adds a `registryReady` discriminator so callers can distinguish "retry shortly" from
"no models exist." The session ran the full arc: TDD implementation → verify → the
ship pipeline (archive, PR #309, CI, CodeRabbit, squash-merge, worktree teardown).

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change-name>` — the change was already
   specced, so this drives TDD straight from `tasks.md`.
2. Let the AI write the **failing tests first** (4 cases: absent / hydrated-empty /
   populated / annotated-absent), run them, confirm red.
3. Implement the minimal discriminator: a `buildModelsResult(registry, annotated)`
   wrapper that keeps the pure `buildModelRows` unchanged and adds `registryReady` +
   a `reason`. Emit the envelope through **both** `content` and `details` channels.
4. Update the `AGENTS.md` per-file row with a `See change:` note; run regression
   (`npx vitest run packages/extension`) + `openspec validate`.
5. Say `ship-it`. Expect the defer gate to **stop** on live-session verification tasks
   (V.2/V.3) whose wording doesn't match the defer keyword set.
6. When the gate stops on a live-deploy task, steer to real proof:
   **"Use e2e playwright tests with docker to test."** This converts an un-runnable
   manual reload step into a deterministic harness test.
7. Build a **faux scenario** that calls the real tool (`fauxToolCall("list_models", {})`
   executes the *actual* bridge tool against the live registry), plus a step-2 factory
   that echoes `registryReady=… count=… hasFaux=…` as plain text (robust marker).
8. Boot the per-worktree docker harness with `PW_CHANNEL=chrome` attach mode, run the
   one spec, tear the harness down.
9. `ship-it` again — verify gate → archive+sync → commit → PR → watch CI → triage
   CodeRabbit → auto-apply safe nitpick → re-watch CI → squash-merge → remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Apply (TDD).** The AI read the change's context files and the existing
`role-model-tools.ts`, then wrote 4 failing tests and confirmed red *before* touching
the implementation. It caught its own mis-step twice: an edit that violated the
"keep `buildModelRows` pure" task (reverted), and a malformed `oldText2` edit key that
silently no-op'd (re-done properly). Result: 11/13 tasks green, full extension suite
1194/1194, `openspec validate` clean. **V.2/V.3 left unchecked** as live-session deploy
steps.

**Phase 2 — First ship attempt, hard stop.** `ship-it` drove `ship-change` inline. Rather
than eyeball keywords, the AI ran the authoritative `deferDecision` script against the two
leftover `- [ ]` lines. It returned `action: "stop"`: V.3 was deferrable (`manual`), but
**V.2's wording** ("confirm… reload:check") didn't match the defer keyword set
(`qa|manual|verify|smoke|e2e|acceptance|test by hand`), so the gate treated it as undone
work. The AI **refused to rewrite the task to sneak a keyword past the gate** and handed
back untouched — no commit, no push.

**Phase 3 — The decisive steer.** A second `ship-it` hit the identical stop. The human then
redirected: **"Use e2e playwright tests with docker to test."** This was the turning point.
The AI investigated the faux fixture system and discovered the key mechanism: **the faux
provider fakes only the model stream — the real pi agent loop runs**, so
`fauxToolCall("list_models", {})` executes the *actual* registered bridge tool against a
registry that contains `faux/faux-1` (hydrated, non-empty) → genuine `registryReady: true`.
It built a two-step scenario (execute tool → factory echoes a deterministic marker via
`lastToolResultText`) to dodge tool-card collapse / transcript virtualization.

**Phase 4 — Harness run.** It built the docker image from local source (baking the
`role-model-tools.ts` change), booted the per-worktree harness on port 18270, ran the one
spec in Chrome attach mode (bundled Chromium was absent; 4 other containers were already
running), got `registryReady=true hasFaux=true`, then tore the harness down. V.2 now
e2e-proven, V.3 unit-proven; all 13 tasks checked.

**Phase 5 — Final ship.** Third `ship-it` ran the verify gate: `npm test` showed **18
failures in 3 files** — but the AI diagnosed them as *environment-only* (jimp
`not a constructor` in a separate untouched package; a load-flaky doctor perf assertion
that passed in isolation) and confirmed develop's CI was green. It surfaced the evidence,
got the go-ahead, then archived + synced specs, committed, opened PR #309, watched CI
(green, 10m31s — proving the local red was env-only), triaged CodeRabbit's single Trivial
nitpick (assert the `content` channel in tests B/C/D), auto-applied the additive fix,
re-watched CI (green again), and squash-merged. The final worktree removal invalidated the
shell's cwd (a cosmetic-cleanup casualty), but the ship was complete.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change fix-list-models-empty-on-unhydrated-registry`.
  Effective because the change was already specced: the slash command drops the AI straight
  into TDD-from-`tasks.md` with full context, no re-explaining.
- **`ship-it`** (used 3×) — a single word that hands the whole land-it pipeline to the AI.
  High leverage: it triggers verify → archive → PR → CI-watch → CodeRabbit → merge as one
  motion. Re-invoking after a halt cleanly resumes.
- **"Use e2e playwright tests with docker to test"** — the highest-leverage follow-up.
  It reframed a blocked live-session verification into a *reproducible* automated proof and
  unlocked the whole faux-drives-real-tool insight. A stronger phrasing to reuse verbatim:
  *"Verify V.2 with a real Playwright + docker-harness e2e test instead of a manual reload —
  drive the actual bridge tool via a faux scenario."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop the ship on a live-deploy task whose wording missed the defer keyword set (V.2) | Re-invoking `ship-it`, then redirecting to an e2e test | State up front: "V.2/V.3 are live-session steps — prove them with a docker e2e, don't block on wording" |
| Halt at a locally-red verify gate (18 env-only failures) and ask before pushing | Confirming once with the evidence (CI green on develop) | Pre-authorize: "if a red suite is a separate untouched package and CI on develop is green, treat it as env-only and proceed" |
| Try `gh pr merge --delete-branch` from inside the worktree | (pitfall, self-recovered) | Run merge/branch-delete from the **parent** checkout, never the worktree being removed |
| Its own edit slipped: violated "keep `buildModelRows` pure" and emitted a malformed `oldText2` key | (self-caught + reverted) | Re-read the file state after every non-trivial edit; verify the diff matches intent |

The recurring theme: the AI is **correctly conservative at irreversible gates** (defer
stop, red verify, pre-merge) and surfaces the decision rather than overriding it. Give it a
standing rule for each so it doesn't stall.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted this session — the work rode existing skills
(`openspec-apply-change`, `ship-it`, `ship-change`) and the docker/faux e2e harness. The
**reusable asset produced** is a *pattern*, not a file:

- **Faux-scenario-drives-real-tool** (`tool-list-models` in `qa/fixtures/faux-scenarios.ts`
  + `tests/e2e/list-models-registry-ready.spec.ts`). Captures how to get **genuine e2e
  proof for an in-process agent tool that has no REST caller**: faux fakes only the model
  stream, so `fauxToolCall("<tool>", args)` executes the *real* registered tool; a step-2
  factory reads the result via `lastToolResultText` and echoes a plain-text marker that
  survives tool-card collapse and transcript virtualization. **Invoke it whenever a task
  demands proving an agent-tool contract end-to-end** rather than via a manual reload.

If this pattern recurs, it is worth a project skill: *"e2e-prove an agent tool via a
two-step faux scenario."*

## 7. Pitfalls & dead ends

- **Defer gate stops on non-keyword task wording.** V.2 said "confirm… reload:check" — no
  defer keyword — so `deferDecision` returned `stop` even though it's a live-deploy step.
  *Fix:* either word live-verification tasks with a defer keyword, or prove them for real
  (the e2e route taken here). Do **not** silently reword the task to pass the gate.
- **`--changed` finds 0 files in a worktree** (biome VCS-base quirk). *Fix:* lint the
  specific touched files directly (`npx biome check <file> …`).
- **Malformed edit keys silently no-op** (`oldText2` was ignored). *Fix:* verify file state
  after each edit; don't trust the edit succeeded.
- **Locally-red verify gate that is environment-only.** jimp `not a constructor` (separate
  untouched package, broken local `node_modules`) + a doctor perf assertion flaky under
  4-container host load. *Fix:* run the suspect suites in isolation and check develop's CI
  health; CI is the authoritative gate, not local `node_modules`.
- **`gh pr merge --delete-branch` from the worktree** collides with the parent checkout that
  holds `develop`. The server-side squash still succeeds; only branch-delete fails. *Fix:*
  merge from the parent; delete the remote branch explicitly afterward.
- **Removing the worktree kills the shell's cwd.** The session's Bash was anchored to the
  worktree; `git worktree remove` left it unable to spawn further commands. *Fix:* do
  worktree teardown as the very last step, or run it from the parent checkout.
- **Cold docker build vs the 180s health poll** + heavy host load (4 running containers,
  no bundled Chromium). *Fix:* use the manual up + attach fallback with `PW_CHANNEL=chrome`
  and system Chrome.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a specced OpenSpec change (`openspec/changes/<name>/`), a clean
worktree, docker + system Chrome, `gh` auth.

- [ ] `/skill:openspec-apply-change <change-name>` — TDD from `tasks.md`.
- [ ] Write failing tests first; confirm red; implement the minimal fix (keep pure helpers
      pure; emit envelopes through `content` **and** `details`).
- [ ] Update the `AGENTS.md` per-file row with `See change:`; run
      `npx vitest run packages/extension` + `npx openspec validate <name>`.
- [ ] `ship-it`. If the defer gate stops on a live-verification task → **prove it with a
      docker e2e**, don't reword the task.
- [ ] Build a faux scenario that runs the real tool + a marker-echo factory; boot the
      per-worktree harness (`PW_CHANNEL=chrome` attach on its derived port); run the one
      spec; tear the harness down.
- [ ] `ship-it` again. At the verify gate, isolate any red suite; if it's a separate
      untouched package and develop's CI is green → env-only, proceed.
- [ ] Let the pipeline archive+sync, open the PR, watch CI, triage CodeRabbit, auto-apply
      safe additive nitpicks, re-watch CI, squash-merge.
- [ ] Do worktree teardown **last**, from the parent checkout (never from inside the
      worktree).

**Artifacts produced:**
- `packages/extension/src/role-model-tools.ts` — `buildModelsResult` + `ModelsResult`.
- `packages/extension/src/__tests__/role-model-tools-registry-readiness.test.ts` — 4 cases.
- `qa/fixtures/faux-scenarios.ts` — `tool-list-models` scenario.
- `tests/e2e/list-models-registry-ready.spec.ts` — L3 e2e proof.
- PR **#309**, squash-merged into `develop` (merge commit `4d89918b`).

---

_Generated from session `019f5cae-7866-738d-91a1-17008678ffcb` · `pi-agent-dashboard` · 2026-07-13. Source extract: `/tmp/facts-71399-29296.md`._
