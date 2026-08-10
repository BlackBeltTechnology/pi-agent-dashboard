---
session: 019ef5ff
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts); large facts sheet (~15321 tok)"
upgrade_status: pending
openspec_changes: [add-e2e-spawn-scenarios, add-playwright-e2e]
proposal_excerpt: "`add-playwright-e2e` (archived) landed the harness + smoke spec and left a follow-up backlog (its tasks §5) of real scenario specs: §5.1 spawn round-trip, §5.2 git panel, §5.4 terminal, §5.6 navigation. Authoring the…"
---

# How we did it: authoring Docker-based Playwright scenarios from a backlog — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a small, exploratory prompt:

> "There is a pending test task. Is it possible to make docker based playwright test for it?"

The *real* objective, once the AI located the task and the operator green-lit it, was:
**author the first real end-to-end Playwright scenarios from the `add-playwright-e2e`
backlog (§5.1 spawn round-trip, then §5.2 git panel / §5.4 terminal / §5.6 navigation),
wire them into the Docker harness so they pass in a clean managed boot+teardown,
capture the work as an OpenSpec change, pass a CodeRabbit review, and ship it via
`ship-change`.** What started as a yes/no feasibility question became a full
implement → verify → spec → review → ship loop.

## 2. TL;DR playbook

1. **Locate the "pending" task before assuming anything.** Ask the AI to find the exact
   unchecked tasks — here they were §5.1–5.8 of the *archived* `add-playwright-e2e`
   change, a deliberately deferred scenario backlog.
2. **Have the AI study the harness + UI flow first** (fixtures, testids, spawn handler)
   — delegate the testid/flow mapping to an `Explore` subagent to keep context clean.
3. **Write the smallest real scenario first** (§5.1: pin fixture → spawn → assert card).
   The card only appears after the WS round-trip, so it *is* the E2E proof.
4. **Expect a fresh container to be gated.** The UI-only test container has no
   credentials → onboarding gate blocks pin/spawn, and a network guard blocks
   `/api/browse` + `/api/providers`. Solve both at the harness entrypoint, behind a
   `PI_E2E_SEED` flag (manual QA stays UI-only).
5. **Verify fast, then verify clean.** Iterate with `PW_E2E_USE_RUNNING=1` against one
   booted container; then prove it with a clean managed boot+teardown run.
6. **Fold the non-obvious findings into an OpenSpec change** (`add-e2e-spawn-scenarios`)
   — the gates, the `git-branch-btn` vs worktree-only `composer-git-group` re-scope,
   the idempotent shared-container helper.
7. **Run the CodeRabbit gate on the uncommitted diff.** Treat findings as advisory +
   non-deterministic; apply engineering judgment (narrow `0.0.0.0/0` → RFC1918).
8. **Ship with `ship-change`** — but check the branch state first; resolve `develop`
   merge conflicts by taking develop's base and re-applying only your rows.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (what is "the pending task"?).** The AI resisted guessing. It
searched the OpenSpec changes, found the task was §5 of the *archived* `add-playwright-e2e`
("Follow-up scenario backlog, authored later"), and confirmed the harness (§1–4, §6–7)
was already wired. *Why it worked:* grounding the vague ask in the exact unchecked
checkboxes before writing a line of test code.

**Phase 2 — Study the flow (Explore subagents).** Before writing the spec the AI mapped
the pin-folder + spawn-session UI flow, the exact testids, and the spawn handler
(`onSpawnSession(group.cwd)` — no dialog). It delegated the mapping to `Explore`
subagents so the testid harvesting didn't pollute the main context.

**Phase 3 — First scenario + the gate wall.** Writing §5.1 immediately hit a wall: the
fresh container showed a **gated onboarding flow** ("Requires: credentials"), and even a
seeded `auth.json` api_key didn't flip `providersReady` (it needs a bridge-pushed
catalogue — chicken-and-egg). The AI drilled down methodically: `providersReady` ←
`/api/providers` (network-guarded, "Access denied") + `/api/provider-auth/status`. It
found that a **fake `anthropic` OAuth credential** flips `authenticated:true` with *no*
network-guard change — then hit a *second* gate (`/api/browse` also network-guarded) that
needed `trustedNetworks`. Both were seeded at the entrypoint behind `PI_E2E_SEED`.

**Phase 4 — Verify.** §5.1 passed in 5.1s (fast path) and 3/3 in a clean managed run.
The operator then said "1. ok / 2. ok" — greenlighting both the OpenSpec scaffold and
authoring 5.2/5.4/5.6. The AI discovered `composer-git-group` is **worktree-only**, so it
re-scoped 5.2 to `git-branch-btn` (renders for any git-repo session). It built an
**idempotent `ensureGitSession()` helper** because Playwright specs share one container
and state accumulates. All 6 specs passed on a clean managed lifecycle.

**Phase 5 — CodeRabbit ("coderabbit").** The gate flagged one major, then 0 on re-run
(non-deterministic incremental review). Rather than fight the tool, the AI applied
judgment: the only legitimate major on the diff was the **overly-broad
`trustedNetworks: ["0.0.0.0/0"]`**. It narrowed to the three RFC1918 blocks (Docker
published-port traffic is SNAT'd through the bridge gateway → always private), verified
6/6 still passed, and propagated the CIDR change through docs/spec.

**Phase 6 — Ship ("use ship-change skill").** The AI checked branch state first and found
the work was uncommitted on top of an existing PR #156 (`feat/coderabbit-review-gate`).
It confirmed the bundle decision, archived the OpenSpec change, and pushed. `develop`
advanced **twice** — each time producing conflicts (kb rows; then a `parallelize-test-harness`
overlap on the same E2E harness `env`). It merged develop, kept its `PI_E2E_SEED` seed +
develop's dynamic-port logic, verified the combined harness ran 6/6, applied a final
CodeRabbit regex-escape fix, and squash-merged as `417847ee84`.

## 4. Prompts that worked

- **Goal prompt** — *"There is a pending test task. Is it possible to make docker based
  playwright test for it?"* Effective because it framed a **feasibility question**, which
  forced the AI to *locate and confirm* the task before building. A stronger version:
  *"Find the unchecked test tasks in the E2E backlog and, if feasible, author the first
  as a Docker Playwright spec that passes in a clean managed run."*
- **"yes"** (steering #1) — a high-leverage unlock: after the AI presented a grounded plan
  + task table, one word authorized the whole implement path.
- **"1. ok / 2. ok"** (steering #2) — approved two parallel tracks at once (OpenSpec
  scaffold + authoring the next three scenarios), keeping momentum.
- **"coderabbit"** and **"use ship-change skill"** — terse skill invocations that worked
  *because the project has those skills*; the AI knew the full procedure from the name.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Wait for a go-ahead after presenting feasibility | "yes" | State up front: "if feasible, implement it and verify" |
| Pursue one scenario at a time | "1. ok / 2. ok" (approve two tracks) | Say "scaffold the OpenSpec change AND author 5.2/5.4/5.6 in parallel" |
| Stop after writing tests | "coderabbit" then "use ship-change skill" | Name the full pipeline up front: "implement → verify → openspec → coderabbit → ship" |
| Treat the archived design.md as gospel | (self-corrected) discovered the credential/network gates the design missed | Expect a fresh container to be gated; plan the `PI_E2E_SEED` seed before writing |

Note the operator steered *only 5 times in 2h16m* — the heavy lifting was the AI's
methodical gate-drilling. The steering was almost entirely **scope unlocks**, not
corrections, because the AI grounded each step in live evidence (curl the endpoint,
read the hook, verify against a running container) before acting.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was saved this session, but three reusable assets emerged that a
future operator should lift:

- **The `PI_E2E_SEED` harness pattern** — seed a fake `anthropic` OAuth credential
  (clears `providersReady`) + `trustedNetworks` RFC1918 (clears the network guard) at the
  container entrypoint, gated behind a flag so manual `docker/test-up.sh` stays UI-only.
  *Reusable problem:* any Docker E2E scenario that must clear the onboarding/credential
  gate. Now captured in the `add-e2e-spawn-scenarios` OpenSpec change + `tests/e2e/README.md`.
- **The idempotent `ensureGitSession()` helper** — Playwright specs share one container,
  so state accumulates and file order matters. A helper that reuses an existing card or
  arranges one from any state makes each spec self-contained. *Invoke it* whenever adding
  a scenario that needs a pre-existing session.
- **`Explore` subagents for testid/flow mapping** — delegate "find the exact testid
  sequence for flow X" so the harvesting stays out of the main context. *Recommendation:*
  a `docker-e2e-scenario` skill capturing the gate-seed + idempotent-helper pattern would
  make the next backlog item a 20-minute job instead of a 2-hour drill.

## 7. Pitfalls & dead ends

- **Seeded `auth.json` api_key ≠ provider-ready.** `/api/provider-auth/status` only marks
  api_keys authenticated if the provider is in a bridge-pushed catalogue (empty on a
  session-less container). *Fix:* seed a fake **OAuth** credential for `anthropic` instead.
- **Seeding the derived `resolvedTrustedNetworks` does nothing.** It's computed at load
  from the *source* field. *Fix:* seed `trustedNetworks` (config-api.ts deletes the
  derived one). Confirm `parseTrustedNetworks` accepts your CIDR first.
- **In-container `pi-dashboard restart` kills PID 1** → container exits. *Fix:* seed
  config **before** the server starts, at the entrypoint — not via restart.
- **`composer-git-group` is worktree-only** (`showGit && session.gitWorktree`). A plain
  git-repo session won't render it. *Fix:* assert `git-branch-btn` (renders for any
  git-repo session).
- **Brittle first selectors** — `terminal-card` didn't exist (use the `"Terminal input"`
  xterm textbox); navigation's MIME console error is noise (assert no uncaught `pageerror`
  instead); `.first()` card raced (assert page-level).
- **CodeRabbit is non-deterministic** — 1 finding then 0 on re-run. Don't chase it; apply
  judgment to the real smell (`0.0.0.0/0` → RFC1918).
- **`develop` advancing mid-ship** → PR goes `DIRTY`, which *blocks CI from firing*.
  Merge develop, take its base for doc-index conflicts, re-apply only your rows, verify
  the combined harness runs, then push.
- **`gh pr merge --delete-branch` collides with the parent worktree** holding `develop`.
  The merge still lands on GitHub; finish cleanup manually (delete remote branch, remove
  worktree). "Working directory does not exist" *confirms* the worktree was removed.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the Docker E2E harness (`docker/`, `tests/e2e/`), a fixture git
repo baked into the image (`/fixtures/sample-git`), Playwright + Chromium, `gh` + a PR
target, the CodeRabbit CLI.

- [ ] Find the exact unchecked test tasks (don't guess the "pending" one).
- [ ] `Explore`-map the testids + spawn flow before writing a spec.
- [ ] Seed `PI_E2E_SEED` at the entrypoint: fake `anthropic` OAuth cred + `trustedNetworks`
      RFC1918; keep manual `test-up.sh` UI-only.
- [ ] Write the smallest real scenario first (pin → spawn → assert card = WS proof).
- [ ] Iterate fast with `PW_E2E_USE_RUNNING=1`; prove with a clean managed run.
- [ ] Use an idempotent session helper (specs share one container).
- [ ] Capture the non-obvious findings in an OpenSpec change; `openspec validate --strict`.
- [ ] Run the CodeRabbit gate on the uncommitted diff; fix the real smell, ignore noise.
- [ ] `ship-change`: check branch state, resolve `develop` conflicts (base + your rows),
      verify combined harness, squash-merge, manual worktree cleanup.

**Artifacts produced:** `tests/e2e/session-spawn.spec.ts`, `git-panel.spec.ts`,
`terminal.spec.ts`, `navigation.spec.ts`; the `PI_E2E_SEED` wiring in
`docker/test-entrypoint.sh` + `compose.test.yml` + `tests/e2e/global-setup.ts`; the
`add-e2e-spawn-scenarios` OpenSpec change; merged as squash commit `417847ee84` in PR #156.

---

_Generated from session `019ef5ff-dc12-7423-8605-ffd1f990354f` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-23. Source extract: `/tmp/cr_facts.md`._
