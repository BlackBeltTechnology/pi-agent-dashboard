---
session: 019f6ccc
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); large facts sheet (~13537 tok)"
upgrade_status: pending
openspec_changes: [unify-message-severity-colors]
proposal_excerpt: "Message surfaces use multiple parallel color systems, so severity no longer maps reliably to color. Most visibly, `showToast` defaults to the `error` (red) variant, so a **successful** session spawn and a **successful…"
---

# How we did it: unify-message-severity-colors — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was a single directive: **run the `ship-it` skill** inside the
worktree for the OpenSpec change `unify-message-severity-colors`. There was no prose
task — the operator handed the AI a skill and let its own preconditions define the
work.

The *real* objective, once the change's artifacts were read, was concrete: toast and
banner surfaces in the dashboard client used several parallel color systems, so
severity no longer mapped reliably to color. The worst symptom — `showToast` defaulted
to the **error (red)** variant, so a *successful* session spawn flashed red. The fix
was to introduce one canonical set of `--severity-*` CSS tokens, a 5-value
`ToastVariant` with a **neutral** default, and to retag every call site and banner to
the new tokens — all gated behind a WCAG-contrast sweep across 9 themes × light/dark.

## 2. TL;DR playbook

1. **Kick off `ship-it` inside the worktree** — it orients on `openspec status`, reads
   all planning artifacts, and checks *filesystem reality* (does the L3 spec exist yet?)
   before trusting the tasks.md checkboxes.
2. **Merge `origin/develop` early** (ship-it step 2.5) so you implement against the
   integrated tree; resolve the trivial `.openspec.yaml` archive-bookkeeping conflicts.
3. **Pre-flight the hard gate offline.** Before writing any tokens, import the real
   `themes.ts` values at runtime and run a `color-mix` + WCAG-contrast solver in a
   throwaway `.mjs` — do NOT iterate the slow docker harness blind.
4. **When the math proves the spec unsatisfiable, STOP** — trigger the boundary-reverse
   escape hatch (`SHIP_IT_BLOCKED.md`), save the finding as a project memory, and
   surface the design decision to the human via `ask_user`.
5. **After the human decides the gate, lock the exact percentages** with the offline
   solver (maximin worst-case), then implement tokens → Toast → call sites → banners.
6. **Write L1 vitest** (behavioral where clean, static-inspection for token scans) and
   an **L3 Playwright sweep** that sets `localStorage` + reloads per theme/mode and
   reads `getComputedStyle` — only a real CSS property forces `color-mix()` resolution.
7. **Build the harness with `--build`** so it bakes local source, run L3 in attach
   mode, always tear down, then run the full unit suite and confirm new failures are
   yours vs pre-existing (stash-and-rerun to prove it).
8. **Update artifacts to the chosen gate, run Biome (`biome lint`, not `check`) +
   CodeRabbit, checkpoint before the irreversible squash-merge**, then drive
   `ship-change` inline: archive → PR → watch CI → squash-merge → remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Orient & integrate.** The AI read `openspec status` and every artifact,
found all tasks unchecked and the L3 severity spec absent (a genuinely fresh run), then
merged `origin/develop` early. The three merge conflicts were all `.openspec.yaml`
archive bookkeeping — resolved `--theirs`/`rm` with no code divergence. *Why it worked:*
checking filesystem reality (not just checkboxes) and merging before implementing keeps
you from building on a stale tree.

**Phase 2 — Prove the gate offline (the pivotal move).** Rather than author tokens and
discover contrast failures in a 5-minute harness loop, the AI imported the actual
`THEMES` object and ran a WCAG solver over all 90 cells. The finding was decisive and
**not a tuning miss**: 5 of 18 theme/mode combos already fail 4.5:1 for their *own* base
body text, and the accent tiers mix an accent *into* those same tokens — which only
*reduces* contrast. The spec's "AA 4.5:1 everywhere" gate was **provably unsatisfiable**.

**Phase 3 — Reverse the boundary, ask the human.** This is a `ship-it` step-5 trigger:
implementation reveals the design is wrong. The AI did **not** headlessly rewrite the
artifacts. It wrote `SHIP_IT_BLOCKED.md`, saved a durable project memory, and used
`ask_user` to present the resolution options. The human chose **B** (relative gate),
then after the AI refined the numbers, **A** (absolute 3:1 floor with one documented
exception). Only then did the AI edit artifacts and implement.

**Phase 4 — Implement & verify.** Tokens in `index.css` (`color-mix` bg 10% / fg 46% /
border 40%, neutral = literal base tokens), canonical 5-value `ToastVariant` (neutral
default), call-site retagging (spawn ternary split, `notifyError`→error, commit→success,
still-working→neutral), banners + `ToastSlot` → tokens. L1 vitest (17 tests) + an L3
Playwright contrast sweep in the docker harness confirmed real browser margin
(worst 3.15, documented exception tokyo-night/light/info 2.71).

**Phase 5 — Land it.** Biome + CodeRabbit (doc-consistency nits fixed), a checkpoint
before the irreversible merge, then `ship-change` inline: archive → PR #348 → CI green →
squash-merge `9726a8b` → worktree + branches cleaned up.

## 4. Prompts that worked

- **The goal prompt** — literally invoking the `ship-it` skill. This works only because
  the skill carries its own preconditions, escape hatches, and step ordering; the
  operator delegated *judgment* to the skill, not just steps. Effective kickoff for a
  well-specified change with a mature orchestration skill.
- **High-leverage follow-up: `B`** — a single letter. It unlocked the entire redesign
  because the AI had already done the offline analysis and framed a decision-forcing
  menu. The leverage came from the AI's setup, not the prompt length.

Rewrite for next time: the one-letter answers were fine *because the AI presented
crisp options*. If you're the operator, when you see an `ask_user` menu, answer with the
letter **plus one constraint** ("B, but keep colored boxes") so the AI doesn't have to
re-ask for the sub-decision (which is exactly what happened here — B then A).

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust the spec's "AA everywhere" gate as achievable | (AI self-corrected via offline proof, then) choosing gate **B** | State up front that derived/tinted colors can never beat their source token contrast |
| Frame the relative gate loosely (`min(4.5, base)`) | Picking **A** — a concrete absolute 3:1 floor + one documented exception | Demand a *satisfiable, measured* gate definition before touching artifacts |
| Risk a silent sub-decision (colored boxes vs strict contrast) | Being asked again (colored-box tradeoff) | Present the visible-product tradeoff explicitly, don't pick it silently |

The core discipline the human reinforced: **a mid-flight design defect is a human
decision, not an autonomous rewrite.** The AI honored the project's "confirm before
irreversible changes" rule twice (the design pivot, and again before the squash-merge).

## 6. Skills, tools & memory created — and why they're effective

**Project memory saved (1):** *"Dashboard theme contrast ceiling: severity/status tokens
derived via color-mix from `--accent-*`/`--bg-tertiary`/`--text-secondary` can NEVER
exceed the theme's own base-text contrast; 5 of 18 theme/mode combos already fail AA for
base text."*

- **What it captures:** a mathematical invariant of the theme system that isn't obvious
  from the tokens — tinting text toward an accent strictly *reduces* contrast.
- **Why it's effective:** any future severity/status/badge color work would otherwise
  re-derive this the hard way (a wasted harness loop or a shipped a11y regression). The
  memory short-circuits that.
- **When to invoke:** any task that mixes accent color into text/background and claims a
  WCAG target across all themes.

No new skill was created (the session *ran* `ship-it`, `ship-change`, the harness, and
the local-changes E2E skill). The reusable asset that *should* exist — an **offline
theme-contrast solver** wired to `themes.ts` — is a strong candidate for a small repo
script, since it was hand-built twice mid-session.

## 7. Pitfalls & dead ends

- **`color-mix` serializes as `color(srgb 0.94 …)` with 0–1 floats, not `rgb(0–255)`.**
  The L3 probe's `lin()` divided by 255, collapsing every accent cell to ~black →
  contrast 1.00. The tokens were correct; the *test parser* was wrong. If your sweep
  reports uniform 1.00 contrast, dump the raw computed string first.
- **`color-mix()` stays unresolved in a custom property** — only reading `getComputedStyle`
  of an element that *uses* `var(--x)` in a real CSS property forces resolution. Probe
  styled elements, not the variable.
- **The harness reuses a cached image** — you must pass `--build` (via `test-up.sh`) or
  the browser tests run against stale source.
- **A relative gate `min(4.5, base)` is still unsatisfiable** when a theme's ceiling is
  barely above 4.5, because *any* tint converges fg/bg. Compute the achievable maximin
  floor, don't assume the relaxed gate is met.
- **Pre-existing failures masquerade as yours.** ~20 unit failures were in untouched
  packages (jimp/iconv/bus-client). Prove it: `git stash` your work and re-run the
  failing files — CI is the authoritative full gate.
- **Malformed main spec blocks archive.** `openspec/specs/toast-notifications/spec.md`
  had a delta header (`## ADDED Requirements`) where a main spec needs `## Requirements`;
  a one-line header fix unblocked the sync.
- **Worktree `--delete-branch` collides** with the parent repo holding `develop`; the
  squash-merge still succeeds. Re-anchor your shell to the parent (the cwd is the removed
  worktree) and force-delete the local branch with `-D`.
- **`biome check` ≠ `biome lint`** — CI runs `biome lint` (errors only). A lone `check`
  "error" was an assist rule CI never runs; don't chase it.

## 8. Reproduce it faster — checklist

- [ ] Run `ship-it` in the change's worktree; verify filesystem reality before checkboxes.
- [ ] Merge `origin/develop` early (step 2.5); resolve `.openspec.yaml` conflicts.
- [ ] **Solve the contrast gate offline** against real `themes.ts` values before writing tokens.
- [ ] If the gate is unsatisfiable → `SHIP_IT_BLOCKED.md`, save the invariant as memory, `ask_user`.
- [ ] Lock exact `color-mix` percentages with a maximin solver after the human decides.
- [ ] Implement tokens → `ToastVariant` (neutral default) → call sites → banners.
- [ ] L1 vitest (behavioral + static-inspection); L3 Playwright sweep (localStorage+reload, parse `color(srgb …)` AND `rgb(…)`).
- [ ] `test-up.sh --build`; run L3 in attach mode; always tear down.
- [ ] Prove new unit failures are yours via stash-and-rerun; align artifacts to the chosen gate.
- [ ] `biome lint` + CodeRabbit; checkpoint before merge; `ship-change` inline → PR → CI → squash-merge → cleanup.

**Key inputs:** the worktree + its OpenSpec artifacts, docker harness, Playwright/chromium,
the `themes.ts` token values.

**Artifacts produced:** `packages/client/src/index.css` (`--severity-*` tokens),
`Toast.tsx` / `useAsyncAction.ts` / `useMessageHandler.ts` / `SessionList.tsx` /
`App.tsx` / `SpawnErrorToastHost.tsx` / `SpawnErrorBanner.tsx` / `ToastSlot.tsx`,
`packages/client/src/components/__tests__/Toast.test.tsx`,
`tests/e2e/severity-contrast.spec.ts`, updated OpenSpec artifacts — shipped as PR #348
(squash `9726a8b`).

---

_Generated from session `019f6ccc` · `pi-agent-dashboard` · 2026-07-17. Source extract: `/tmp/facts-niL5oi.md`._
