---
session: 019f53ab
week: 2026/W28
type: development
model: "@fast"
premium: true
premium_reason: "large facts sheet (~17576 tok)"
upgrade_status: pending
openspec_changes: [add-flow-plugin-e2e-tests]
proposal_excerpt: "The three flow-adjacent plugins — `flows-plugin`, `subagents-plugin`, `flows-anthropic-bridge-plugin` — plus their pi-session bridge extensions have NO end-to-end coverage of their activation/resolution path."
---

# How we did it: add-flow-plugin-e2e-tests — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single slash command: `/skill:openspec-apply-change add-flow-plugin-e2e-tests`. The *real* objective, once implementation started, was to give the three flow-adjacent plugins (`flows-plugin`, `subagents-plugin`, `flows-anthropic-bridge-plugin`) and their pi-session bridge extensions their first end-to-end coverage of the **activation/resolution path** — L1 unit tests, L2 contract-pinned reducer tests, and L3 browser Playwright specs that spawn a real pi session inside the Docker harness, launch a synthetic flow, and assert the UI renders it. The two later prompts (`rebase to develop`, `ship-change`) drove the change all the way to a merged PR.

This was an 8.5-hour, single-model (Opus, high-thinking) marathon: 290 assistant turns, 225 bash calls, 30 edits, one squash-merged PR (#274). Most of the time went not into writing the tests but into **discovering why a real pi-flows session would not spawn headlessly** — a chain of four independent harness bugs.

## 2. TL;DR playbook

1. **Trust tasks.md, verify the filesystem.** Before implementing, confirm the "done" tasks actually left artifacts. Here 1.1–2.6 were marked `[x]` but the test files were missing — dropped by a `git reset`. Recover from the orphaned commit (`git log --all --oneline`, `git show <sha>:<path>`), don't re-write.
2. **Study the event/harness shapes first.** Read the flow reducer's finish-latch, the e2e harness lifecycle, an existing full-stack spec, and the Docker fixtures/entrypoint before writing a line of test.
3. **Consult `edit-flow` for the pi-flows authoring model** (agents at `.pi/flows/agents/<name>.md`, flows as **directories** `.pi/flows/flows/<ns>/<name>/flow.yaml` with explicit `type:` on every step).
4. **Add faux fixtures** (a per-agent-branching scenario family + a `faux-roles.json` all-roles→`faux/faux-1` preset) so the flow runs deterministically with no real model.
5. **Wire a `PI_TEST_PEERS` selector** through Dockerfile → compose.test.yml → test-up.sh → test-entrypoint.sh (`both`/`no-am`/`legacy`/`bad-registration`), baking pi-flows + the anthropic peer into the image.
6. **Debug the headless spawn** against a *running* container (USE_RUNNING) with tmux pane capture — this is where the four fixes live (see §7).
7. **Validate via the managed path** (fresh build→boot→run→teardown) with a warm build cache, then run the gate: Biome on changed files, `tsc`, `npm test`, `npm run build`.
8. **Ship:** `rebase to develop` → `ship-change` → archive+sync specs → PR → wait out CodeRabbit rate limit → resolve mid-ship conflicts → squash-merge → clean up worktree.

## 3. How the collaboration unfolded

**Phase A — Discovery (recover dropped work).** The AI opened by *distrusting the checkboxes*: it diffed tasks.md's claimed deliverables against HEAD, found the two new reducer test files and the peer-probe extension missing, located them intact in orphaned commit `7378e01e0` (a prior session committed then `git reset` away), and recovered only the three real files — deliberately excluding a `FLOWS_HANDOFF_CHECKLIST.md` it judged to be cruft. **Why it worked:** treating tasks.md as a claim to verify, not a ground truth, caught a silent regression before it compounded.

**Phase B — Ground the shapes.** It read the flow-reducer finish handling, the e2e harness helpers, the faux router, existing specs, and Docker fixtures; consulted `kb_search` and the `edit-flow` skill for the flow YAML/agent format. **Why it worked:** every later fixture matched a real contract instead of a guessed one.

**Phase C — Build fixtures + peer harness.** Added the faux scenario family and role preset (§3), then the `PI_TEST_PEERS` selector across the Docker stack (§4), and three Playwright specs asserting on rendered text (no test-ids — the proposal forbade production-code changes).

**Phase D — The long debug (the real story).** Against a running container, headless flow spawns hit `REGISTER_TIMEOUT`. The AB test that cracked it: `faux-text` (a normally-green spec) passed with peers unset but failed with `PI_TEST_PEERS=both`, isolating the harness wiring as the culprit. tmux pane capture then revealed the spawned pi was blocked on a **"Trust project folder?"** prompt. Four independent fixes followed (§7).

**Phase E — Ship.** `rebase to develop` forced a decision about *which* develop (local was 8 commits ahead of origin); `ship-change` then archived specs, opened PR #274, waited out a ~54-min CodeRabbit rate limit for a clean review, resolved a mid-ship `qa/AGENTS.md` union conflict when origin/develop advanced 7 commits, and squash-merged.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change add-flow-plugin-e2e-tests`.** A slash command that loads the apply workflow. Effective because the change was already spec'd; the operator just points the skill at it. Stronger next time: prefix with *"verify each already-checked task's artifacts exist on disk before continuing"* — it would have surfaced the dropped work as an explicit first step.
- **`rebase to develop`** — a two-word steering prompt that triggered a full PR-hygiene reconciliation (commit uncommitted work, pick the right base, resolve divergence). High leverage because the AI already held all the git context.
- **`ship-change`** — one word that ran the entire ship pipeline (gate → archive → PR → CI watch → CodeRabbit → merge → cleanup). The payoff of having a `ship-change` skill: the human never touched git plumbing.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust tasks.md's `[x]` and assume artifacts exist | (self-corrected) — verified filesystem, found the `git reset` gap | Add a standing rule: *apply-change verifies each checked task's files exist before continuing* |
| Base the branch on **local** develop (8 commits ahead of origin) | `rebase to develop` → forced choosing `origin/develop` for a clean PR diff | State the PR base explicitly up front: "branch off origin/develop" |
| Leave debug sessions/containers polluting the harness | (self-corrected) — stale cards confused `spawnFreshGitSession`; torn down for a clean managed run | Always debug against a disposable USE_RUNNING container, tear down before the official run |
| Prune the Docker build cache mid-debug | (self-corrected) — cold `npm install` then blew the 180s globalSetup window | Keep the build cache warm; never `docker system prune` the cache mid-loop |

The through-line: the human's two steering prompts were tiny, but each unlocked a large autonomous sequence because the AI held deep context. The corrections that mattered most were **self-corrections** — the AI catching its own optimistic assumptions (checkboxes = truth, local = the right base).

## 6. Skills, tools & memory created — and why they're effective

- **A project skill capturing the pi-flows e2e harness wiring** (created via `skill_manage` near the end). It encodes the four hard-won fixes — trust pre-seed, flow **directory** layout with explicit step `type:`, `spawnRegisterTimeoutMs` bump + jiti warm-up, and the schema-valid faux `finish` shape. **Why effective:** each fix cost 20–60 min of container spelunking; the skill turns the next flow-e2e task from a multi-hour debug into a checklist. **Invoke it** whenever adding Playwright coverage that spawns a real pi-flows session in the Docker harness.
- **Faux `faux-roles.json` preset + branching scenario family** — reusable deterministic flow fixtures; any future flow spec can reuse them instead of standing up a real model.
- **`PI_TEST_PEERS` selector** — a permanent harness knob (`both`/`no-am`/`legacy`/`bad-registration`) for exercising bridge activation/resolution variants.

If you land here without that skill, **create it** — this workflow is unambiguously repeatable.

## 7. Pitfalls & dead ends

The four fixes that made headless flow spawn work — each was a dead end first:

1. **Trust gate blocks headless RPC.** Adding `.pi/flows/` + `node_modules` to the fixture triggered pi's *"Trust project folder?"* prompt, which hangs a headless RPC session → `REGISTER_TIMEOUT`. **Fix:** pre-seed `~/.pi/agent/trust.json` with `{ "<cwd>": true }`. This was the root cause behind the whole `REGISTER_TIMEOUT` chase.
2. **pi-flows ignores loose `.yaml` flows.** v0.3.2 discovers flows only as **directories** `<ns>/<name>/flow.yaml`, and requires an explicit `type:` on every step. A bare `synthetic.yaml` with typeless steps → `0 flows discovered`. **Fix:** move to `e2e/synthetic/flow.yaml`, add step types.
3. **Cold jiti compile under load exceeds the 30s spawn timeout.** pi-flows ships raw TS; the first UI spawn pays the full jiti compile and blows `spawnRegisterTimeoutMs` (default 30000, clamp max 120000) when many containers contend. **Fix:** bump the timeout in the peer block **and** warm the jiti compile cache at boot.
4. **Faux `finish` must be schema-valid or the step loops forever.** pi-flows' finish latch only fires on a non-error finish; the faux agent emitting `{note}` errored silently → infinite loop at `0/2 agents`. **Fix:** emit `{ status, summary, files, ...typedOutputs }` inline (replicated, not imported from pi-flows).

Other traps: `docker system prune` of the build cache mid-debug caused cold `npm install` to overrun the 180s globalSetup timeout (twice); disk hit 98% from accumulated 4GB debug images; the `--delete-branch` step failed on a worktree collision (parent worktree holds `develop`) — delete the remote branch and clean the worktree manually instead.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change (`add-flow-plugin-e2e-tests`), Docker + a warm build cache, host Chrome or chromium (`PW_CHANNEL=chrome`), and the pi-flows e2e harness skill.

- [ ] Verify each already-`[x]` task's artifacts exist on disk; recover dropped work from orphaned commits, don't rewrite.
- [ ] Read the flow reducer, harness helpers, faux router, and an existing full-stack spec before writing tests.
- [ ] Add faux scenario family + `faux-roles.json` preset (all roles → `faux/faux-1`).
- [ ] Author the flow as a **directory** `.pi/flows/flows/<ns>/<name>/flow.yaml` with explicit step `type:`; agents at `.pi/flows/agents/<name>.md`.
- [ ] Wire `PI_TEST_PEERS` through Dockerfile → compose.test.yml → test-up.sh → test-entrypoint.sh; bake the two peers.
- [ ] Pre-seed `~/.pi/agent/trust.json`, bump `spawnRegisterTimeoutMs`, warm jiti at boot, emit schema-valid faux `finish`.
- [ ] Debug against a disposable USE_RUNNING container (tmux pane capture); tear it down before the managed run.
- [ ] Managed run (build→boot→run→teardown, cache warm) → gate: Biome changed + `tsc` + `npm test` + `npm run build`.
- [ ] Ship: `rebase to develop` (choose origin/develop base) → `ship-change` → wait out CodeRabbit → merge → clean worktree.

**Final artifacts:** PR #274 (squash `236e9adfb9`); `tests/e2e/{flow-roundtrip,anthropic-bridge-activation,subagent-inspector,real-flow-regression}.spec.ts`; `qa/fixtures/faux-roles.json`; `docker/fixtures/sample-git/.pi/flows/{agents/e2e-alpha.md,agents/e2e-beta.md,flows/e2e/synthetic/flow.yaml}`; the Docker peer-harness wiring; 7 requirements synced into `openspec/specs/flow-plugin-e2e/`.

---

_Generated from session `019f53ab-a920-7029-b126-66fb90ac6ab4` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-12. Source extract: session facts sheet._
