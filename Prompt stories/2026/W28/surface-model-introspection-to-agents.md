---
session: 019f34c1
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [surface-model-introspection-to-agents]
proposal_excerpt: "Agents inside a pi session repeatedly need to answer \"which models can I actually reach, and with what capabilities?\" — for cross-model review (pick a non-Anthropic reviewer), vision routing (needs `input: [image]`),…"
---

# How we did it: Surface model introspection to agents — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single line: `/skill:openspec-apply-change surface-model-introspection-to-agents`. There was no free-form brief — the *entire* specification already lived in the OpenSpec change. The real objective, drawn from the proposal, was to give agents inside a pi session a first-class way to answer **"which models can I actually reach, and with what capabilities?"** — for cross-model review, vision routing (`input: [image]`), etc. — without forcing them to parse `providers.json`/`models.json` by hand. Concretely that meant: ship an ungated `GET /api/models` route backed by the shared model registry, plus a skill command and docs so agents know to call the API instead of scraping config. The four human turns across a 6.5-hour session were almost pure orchestration: *apply the change → ship it → rebase onto the develop fix → go on*.

## 2. TL;DR playbook

1. **Start from the spec, not a prose brief.** `/skill:openspec-apply-change <change>` — let the OpenSpec `tasks.md` drive every step.
2. **Read the apply instructions and context files first** (`openspec instructions apply --change <name> --json`), then explore the exact server code the tasks touch (registry singleton, existing route wiring, the auth-gate boundary).
3. **Mirror the sibling.** Model the new route on the closest existing one (`model-proxy-routes.ts`) — same registration site in `server.ts`, same auth posture (`/api/*` JWT gate, **not** the `/v1/*` proxy Bearer gate).
4. **Write the unit test alongside the route** and run it isolated: `HOME=$(mktemp -d) npx vitest run <test>` to dodge worktree-env HOME pollution.
5. **Run the quality gate per-file** when `biome check --changed` won't resolve in a worktree: `npx biome check --error-on-warnings <changed files>`. Remove `any` from *new* code (CI lints changed files with `--error-on-warnings`), even if the sibling gets a pass for being unchanged.
6. **Diagnose failing tests before blaming your change:** stash your diff and re-run; check the base branch's own CI. Separate *worktree-env artifacts* (pass in clean CI) from *genuinely-red baseline* (red on develop CI too).
7. **`use ship-change`** — archive + sync specs, commit, push, open PR, watch CI, run CodeRabbit.
8. **If CI is red only on inherited/pre-existing failures, stop and report** rather than merging or editing out-of-scope code. Wait for the baseline fix.
9. **When develop lands the fix: rebase, re-verify locally, force-push, watch CI green, squash-merge.**

## 3. How the collaboration unfolded

**Phase 1 — Discovery (spec → code).** The AI pulled the OpenSpec apply instructions and read every context file, then grep/`cat`-explored the server: the model-registry singleton, how routes are wired in `server.ts`, and crucially *where the auth boundary lives* between the ungated `/api/*` surface and the Bearer-gated `/v1/*` proxy. **Why it worked:** locating the exact registration site and the sibling route (`model-proxy-routes.ts`) up front meant the new code could be a faithful mirror instead of a novel design — the fastest way to stay consistent with a subsystem.

**Phase 2 — Implement (route + test + docs).** New `models-introspection-routes.ts` exporting `registerModelsIntrospectionRoute`, wired unconditionally next to `provider-auth-routes` (so it inherits the dashboard JWT gate). `?annotated=1` adds `excludedReason`; the payload is capability/cost metadata only — **no credential material** — and 503s when pi-ai is unresolved. Then a 4-case unit test, the `dashboard-list-models` skill command (explicitly telling agents *never to parse providers.json/models.json*), and AGENTS.md + slash-command + api-reference doc rows.

**Phase 3 — Verify & quality-gate.** The test's credential-leak regex first falsely matched `maxTokens`; the AI tightened it to real credential patterns. `biome check --changed` wouldn't resolve inside the worktree, so the AI ran each gate component explicitly on the changed files, and — noticing `noExplicitAny` is `warn` globally but hard-gated on *changed* files via `--error-on-warnings` — refactored its own 3 `any`s away even though the unchanged sibling keeps them. **Decision point:** the full suite showed 22 red tests; the AI stashed its diff and re-ran to prove they were pre-existing, then checked develop's own CI.

**Phase 4 — Ship (steered: "use ship-change").** Archive + sync specs, commit via a message file (to dodge backtick issues), push, open PR #245, watch CI. CI came back red — but the AI precisely isolated the failures to exactly 2 pre-existing `event-reducer` specs already red on develop's own CI, and proved its new test *passed* in CI (937 passed vs develop's 936, the +1 being the new test). **Decision point:** rather than merge red or edit unrelated `pi-dashboard-web` code, it stopped and reported, asking how to proceed.

**Phase 5 — Land (steered: "develop fix presented, rebase to develop" → "go on").** Once develop carried the event-reducer fix (#248), the AI fetched, rebased cleanly, re-verified locally (the 2 specs now green, own test still green), force-pushed, watched CI go green + CodeRabbit pass, and squash-merged (commit `756eef81`, PR MERGED). Remote branch deleted, worktree removed. The only casualty: the shell's cwd was the just-removed worktree, so two trivial cleanup commands were left for the operator to run from the parent repo.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change surface-model-introspection-to-agents`. Effective *because the spec was already complete*: a well-formed OpenSpec change is the strongest possible kickoff — the tasks.md is the brief, the plan, and the acceptance criteria in one. No prose needed.
- **High-leverage follow-up** — `use ship-change skill`. Two words that unlocked the entire archive→commit→PR→CI→review pipeline. When a repo has a ship skill, naming it is far better than describing the steps.
- **`develop fix presented, rebase to develop`** — a precise, minimal steer that told the AI the blocker was cleared and named the exact recovery move (rebase). No re-explaining the situation.
- **`go on`** — worked only because the prior turn had left an unambiguous next action queued. Cheap continuation prompts are safe when the AI has already narrowed to one path.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Finish implementation and pause without shipping | "use ship-change skill" | State the ship path in the goal prompt: "apply the change **and** ship it via ship-change". |
| Sit blocked when CI was red on inherited failures | "develop fix presented, rebase to develop" | Tell the AI up front the stop-vs-merge rule: never merge red, but resume automatically once the baseline is green. |
| Wait for confirmation at each ship sub-step | "go on" | Grant a standing "proceed unless it's irreversible or ambiguous" so cheap continuations aren't needed. |

The strongest self-steering the AI did *without* prompting: refusing to merge a red PR or edit out-of-scope `pi-dashboard-web` code to force green. That's the right instinct — it kept the change surgical and stopped to ask.

## 6. Skills, tools & memory created — and why they're effective

No pi *skills or memories* were created this session — the work rode existing ones (`openspec-apply-change`, `ship-change`). The reusable **product asset** it shipped is the `dashboard-list-models` skill command: it captures the "which models can I reach?" question as an API call and explicitly warns agents **never to parse `providers.json`/`models.json`** (the silent-failure trap). Invoke it whenever an agent needs to pick a reviewer model, route vision work, or check a capability — instead of scraping config.

**Skill worth creating:** a short "diagnose pre-existing vs. my-change test failures in a worktree" procedure — stash-and-rerun, check the base branch's own CI, distinguish worktree-env artifacts (green in clean CI) from a red baseline. This session executed that dance manually across ~8 commands; codifying it would save the next operator the reasoning.

## 7. Pitfalls & dead ends

- **`biome check --changed` won't resolve inside a worktree.** Fall back to `npx biome check --error-on-warnings <explicit changed files>`.
- **`noExplicitAny` is `warn` globally but hard-gates changed files** via `--error-on-warnings`. A sibling file's `any` passes only because it's unchanged — your *new/edited* file must be clean or CI blocks.
- **Worktree HOME pollution breaks vitest.** Run isolated tests with `HOME=$(mktemp -d) npx vitest run <test>`.
- **A credential-leak regex matched `maxTokens`.** Tighten leak-detection patterns to real credential shapes, not any `*Token*` substring.
- **Don't assume every red test is yours.** `image-fit-extension`/`EditorFileTree` failures were worktree-env artifacts (green in CI); 2 `event-reducer` specs were genuinely red on develop's own CI. Prove it: stash + rerun, and inspect the base branch's CI conclusion.
- **`null as const` is invalid TypeScript** — surfaced by tsc in the test; use the correct literal.
- **Squash-merge kills the worktree your shell lives in.** After `git worktree remove`, the bash cwd is gone and can't spawn commands. Run final `git worktree prune` / `git branch -d` from the **parent repo**.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a complete OpenSpec change (`openspec/changes/<name>/tasks.md`), `gh` authenticated, a clean worktree, and the base branch (`develop`) green.

1. `/skill:openspec-apply-change <change>` — read apply instructions + context files.
2. Explore the exact code the tasks touch; **find the sibling route and mirror it** (registration site + auth posture).
3. Implement route + test + skill command + doc rows in one pass.
4. Test isolated: `HOME=$(mktemp -d) npx vitest run <test>`.
5. Quality gate per-file: `npx biome check --error-on-warnings <changed files>`; strip `any` from new code; `npx tsc --noEmit`.
6. If tests are red, **stash + rerun and check base-branch CI** to separate your failures from the baseline's.
7. `use ship-change` — archive, sync specs, commit (via message file), push, PR, watch CI, CodeRabbit.
8. **Red only on inherited failures → stop and report.** Resume on "rebase to develop" once the fix lands.
9. Rebase → re-verify → force-push → CI green → squash-merge → clean up worktree **from the parent repo**.

**Artifacts produced:** `packages/server/src/routes/models-introspection-routes.ts`, its `__tests__/models-introspection-routes.test.ts`, `packages/extension/.pi/skills/pi-dashboard/commands/dashboard-list-models.md`, plus edits to `server.ts`, api-reference/slash-commands docs, and AGENTS.md rows. Landed as PR #245 (merge commit `756eef81`).

---

_Generated from session `019f34c1` · `pi-agent-dashboard` · 2026-07-06. Source extract: deterministic facts sheet (session-to-guideline)._
