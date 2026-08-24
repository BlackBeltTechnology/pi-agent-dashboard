---
session: 0eebe00c
week: 2026/W15
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (13 user prompts)"
upgrade_status: pending
openspec_changes: [sidebar-header-redesign]
proposal_excerpt: "The sidebar header crams 10 elements into a single row:"
---

# How we did it: Redesign the sidebar header from one crammed row to two clean rows — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** ("Enter explore mode. Think deeply. Visualize freely.") — a thinking-only stance, no code. The real objective surfaced almost immediately once the AI inventoried the sidebar header: **10 controls were jammed into a single horizontal row** (brand, ThemePicker, ThemeToggle, "Active only", "Show hidden", Pin+, InstallButton, TunnelButton, ServerSelector, Settings). The user wanted that header reorganized into a clean, non-overflowing layout — first *thought through* as an OpenSpec change, then *implemented, built, deployed, verified, and archived* end-to-end.

## 2. TL;DR playbook

1. **Enter explore mode** and let the AI inventory the surface first. It produced an ASCII mock + a 10-row table of every element — the shared picture that made the rest fast.
2. **Pick a direction from the AI's options** — the user replied `Option B` (keep everything visible, split into two rows). One word set the whole design.
3. **`create proposal`**, then **`/opsx:ff`** to fast-forward every OpenSpec artifact (proposal → design → specs → tasks) in one shot.
4. **Ask "Is there anything to clarify?"** before applying — the AI self-checked mobile reuse (same `SessionList` renders desktop + mobile) and confirmed no blockers.
5. **`/opsx:apply`** — tests-first: write the two-row layout tests (they fail), split the header JSX in `SessionList.tsx`, watch the 4 new tests go green.
6. **`build and deploy`** — `npm run build` + `curl -X POST http://localhost:8000/api/restart`.
7. **Iterate on live UI with terse steering** — "server selector wider, dropdown don't overflow", "theme selector left-aligned", "be after pi logo" + a screenshot. Rebuild + redeploy after each.
8. **`/opsx:verify`** to catch spec-vs-implementation drift, **`fix it`** to reconcile spec/design to the shipped layout, then **`/opsx:archive`**.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (explore mode).** The AI grepped for the header component, read `SessionList.tsx` / `App.tsx`, and rendered the problem as an ASCII diagram plus a numbered inventory table. *Why it worked:* naming all 10 elements and flagging which are "set-once-and-forget" gave the human a concrete menu to choose from instead of an open-ended "how should we lay this out?"

**Phase 2 — Design decision.** The AI offered layout options; the human answered `Option B`. The AI then reasoned about the *row split* (Row 1 = app-level nav/appearance/connectivity/settings; Row 2 = session filters + pin). *Decision point:* the human deferred to the AI's grouping but later overrode alignment (see §5).

**Phase 3 — Artifact generation.** `create proposal` → `/opsx:ff` scaffolded design, specs, and tasks. The AI re-read the header code to *ground* the design in real class names before writing tasks (5 tasks, tests-first).

**Phase 4 — Implementation (apply).** Tests-first: 4 new `data-testid`-based tests written to fail, header JSX split into two rows, tests pass. The AI correctly isolated **pre-existing failures** (spawn-button testid lives in `FolderActionBar`, not `SessionList`; a missing `localStorage` mock) from its own change and fixed only the localStorage mock.

**Phase 5 — Live iteration.** After `build and deploy`, the human eyeballed the running dashboard and fired terse corrections. The AI translated "wider / don't overflow / left-aligned / after the logo" into concrete Tailwind anchor changes (`max-w-[180px]`, `right-0`, `left-0`) across `ServerSelector.tsx` and `ThemePicker.tsx`, rebuilding after each.

**Phase 6 — Verify & archive.** `/opsx:verify` flagged that the shipped left/right grouping diverged from the spec (an intentional post-spec refinement). `fix it` reconciled spec + design to reality; `/opsx:archive` synced the delta spec into `openspec/specs/` and moved the change to `archive/`.

## 4. Prompts that worked

- **Goal prompt (explore mode):** effective because it forced *thinking before coding* — the AI inventoried before proposing, so the design rested on real code, not assumptions.
- **`Option B`** — a one-word decision on a well-framed menu. High leverage: the AI had already laid out the trade-offs, so a single token committed the whole layout.
- **`/opsx:ff`** — collapsed four artifact-creation steps into one; the strongest single accelerator in the session.
- **`Is there anything to clarify?`** — invited a pre-implementation self-audit that caught the mobile-reuse question *before* coding.
- **`build and deploy`** — a repeatable two-command muscle (`npm run build` + `/api/restart`) the AI executed without further instruction.
- **`be after pi logo` + screenshot** — pairing a terse instruction with an image removed all ambiguity about placement. *Reusable pattern: screenshot + one line beats a paragraph of description.*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Right-align the whole appearance cluster per its own spec | "theme selector be left aligned" + "Be after pi logo" (with screenshot) | State grouping/alignment intent in the proposal ("theme controls sit left, next to brand") so the spec matches the shipped layout |
| Let dropdowns anchor left and overflow the narrow sidebar | "dont let the dropdown overflow in sidebar" | Note the sidebar width constraint up front; anchor situational dropdowns `right-0` by default |
| Leave ServerSelector trigger too narrow | "be server selector more wide" | Give explicit min/max widths for selectors in the design |
| Ship a layout that diverged from the written spec | `/opsx:verify` → `fix it` to reconcile | Update spec/design in the *same* pass as the live UI tweak, not after |

The corrections were all **cosmetic/alignment**, applied live against the running dashboard — the human treated build+deploy as a fast feedback loop rather than reviewing static diffs.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session. The workflow leaned entirely on existing OpenSpec skills (`explore` → `ff` → `apply` → `verify` → `archive`) and the project's build/restart muscle.

**Recommended skill to capture:** a *"live-UI-tweak loop"* micro-skill — after any `src/client/` edit, run `npm run build && curl -X POST http://localhost:8000/api/restart`, then re-screenshot. It's repeated verbatim here and in most client-facing sessions and is worth a one-liner so the model never re-derives it.

**Reusable insight worth a memory:** in this repo, `SessionList.tsx`'s header renders on **desktop sidebar, mobile shell, and mobile overlay** — any header change is a mobile change too. Flagging this before layout work avoids a second pass.

## 7. Pitfalls & dead ends

- **Pre-existing test failures masquerade as regressions.** The spawn-button `data-testid` lives in `FolderActionBar`, not `SessionList` — those failures predate the change. *If a test fails on a testid you didn't touch, `grep` for the testid before "fixing" it.*
- **Missing `localStorage` mock** broke the `SessionList` test suite. Add the mock to test setup before writing new component tests.
- **`ls openspec/specs/sidebar-header/spec.md` failed** during archive because the main spec dir didn't exist yet — `mkdir -p openspec/specs/sidebar-header` first, then sync the delta.
- **Spec drift is silent until you verify.** The live alignment tweaks were never fed back into the spec until `/opsx:verify` caught it. Run verify before archive, always.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the dashboard running locally on `:8000` (so `/api/restart` works), and a screenshot tool for live UI corrections.

1. `/opsx:explore` → let the AI inventory the target surface (ASCII + element table).
2. Choose a layout option in one word.
3. `create proposal` → `/opsx:ff` → all artifacts scaffolded.
4. `Is there anything to clarify?` → self-audit (esp. mobile reuse).
5. `/opsx:apply` → tests-first, split the JSX, green.
6. `build and deploy` (`npm run build` + `curl -X POST :8000/api/restart`).
7. Eyeball live UI → terse fixes + screenshots → rebuild each time.
8. `/opsx:verify` → `fix it` (reconcile spec to shipped) → `/opsx:archive`.

**Artifacts produced:**
- `openspec/changes/archive/2026-04-10-sidebar-header-redesign/` (proposal, design, specs, tasks)
- `openspec/specs/sidebar-header/spec.md` (synced main spec)
- `src/client/components/SessionList.tsx` (two-row header)
- `src/client/components/ServerSelector.tsx`, `ThemePicker.tsx` (dropdown anchoring)
- `src/client/components/__tests__/SessionList.test.tsx` (localStorage mock + 4 layout tests)

---

_Generated from session `0eebe00c-857b-4fb7-a13b-b5f9e867a729` · `pi-agent-dashboard` · 2026-04-10. Source extract: session facts sheet (deterministic extract)._
