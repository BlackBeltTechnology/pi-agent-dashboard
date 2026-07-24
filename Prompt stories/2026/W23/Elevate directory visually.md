---
session: 019e9ee7
week: 2026/W23
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [separate-workspace-directory-cards, add-async-action-feedback]
---

# How we did it: Elevate directory cards in the sidebar — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore` skill) — "think, don't
implement." The real objective, which the steering turns clarified, was concrete and
visual: the directory cards inside a workspace group in the dashboard sidebar all
**blend into one indistinct slab**, and the user wanted to fix that — make each
directory read as a distinct card, then *capture the decision as an OpenSpec proposal*
rather than jump straight to code. The kickoff was a stance ("explore, visualize
freely"), but the work quickly became: diagnose the visual bug → let the user fine-tune
the fix live → freeze the tuned values into a committed proposal.

## 2. TL;DR playbook

1. **Ground before theorizing.** Find the exact component that renders the cards
   (`renderGroup` in `packages/client`) and read the *actual* color tokens from
   `index.css` — don't guess why things look wrong.
2. **Name the root cause precisely.** Here it was a **color collision**: card and
   workspace container both paint `--bg-secondary #141414`, so the `gap` between them is
   invisible. State it as "same-color, not spacing" so the fix space is obvious.
3. **Build an interactive HTML mockup** (`/tmp/…-mockup.html`) that replicates the real
   sidebar with the real palette and exposes sliders (fill, border width/opacity, gap,
   radius, presets A/B/C/D). Hand tuning to the human.
4. **Open it in the browser**, snapshot a couple of presets so before/after is visible
   in-chat too.
5. **Let the user set the knobs** (they'll often pick the *inverse* of your guess —
   sink cards to page-black `#0a0a0a` as recessed wells instead of lifting them lighter).
   Read the exact values off their screenshot.
6. **Scaffold the OpenSpec change**: `openspec/changes/<name>/` with `proposal.md`, a
   `specs/<cap>/spec.md` delta (validation requires it), and **copy the mockup into the
   change dir** so implementers can re-tune.
7. **`openspec validate`** until clean; flag *open decisions* in the proposal rather
   than silently picking (scope, which border token).
8. **Commit — and check `git` HEAD state.** If detached, immediately `git branch` the
   commit so it survives the next checkout.

## 3. How the collaboration unfolded

**Phase 1 — Discovery / root-cause (bash, read, one `Explore` subagent).**
The AI first spawned `Explore` to locate the card rendering; it returned nothing, so the
AI looked directly, found `renderGroup` (line ~584 in `packages/client`), and read the
nesting. It then read the *actual color values* from `index.css` and drew an ASCII
nesting diagram showing card and container both at `#141414`. **Why it worked:** the
diagnosis was pinned to real code + real tokens, so the fix wasn't a shot in the dark —
"color collision, not spacing."

**Phase 2 — Interactive mockup (write, browser).**
Rather than propose one fix, the AI built `/tmp/pi-sidebar-mockup.html` — a live replica
of the sidebar with the real palette and sliders/presets — opened it in the browser, and
snapped before/after screenshots. **Why it worked:** it moved the aesthetic decision to
the human with instant feedback, instead of the AI guessing a taste call.

**Phase 3 — Human sets the knobs (image steering).**
The user sent a screenshot of *their* chosen slider values. The AI read them off:
card `#0a0a0a`, container `#141414` unchanged, `1px` border @ `0.1`, `5px` gap, `14px`
radius — the **inverse** of the AI's instinct (sink, don't lift). Decision point owned
by the human; AI just transcribed and re-diagrammed.

**Phase 4 — Capture as proposal (write, bash, validate).**
The AI scaffolded the change dir, wrote `proposal.md` + a spec delta, copied the mockup
in, ran `openspec validate` (clean), and left **two decisions explicitly open**.

**Phase 5 — Commit & rescue (bash, 2 failures).**
Files "vanished between turns"; the AI recreated them, committed, then discovered the
repo was on a **detached HEAD** — the cause of the disappearing files — and parked the
commit on branch `os/separate-workspace-directory-cards` so it couldn't be
garbage-collected. A final `recheck` confirmed the commit survived a later switch to
`develop`.

## 4. Prompts that worked

- **Goal (explore-mode stance):** effective because it forced *grounding before
  implementing* — the AI diagnosed real code and produced a proposal instead of a raw
  patch. A stronger explicit kickoff for a repeat: *"The sidebar directory cards blend
  together — find the component + tokens, tell me the root cause, then build a tunable
  mockup. Don't implement."*
- **"create mockup for that to help user fine tune"** — high-leverage: converted an
  open aesthetic question into an interactive artifact the human could drive.
- **"The parameters I set. [image]"** — a screenshot of slider values is a dense,
  unambiguous way to hand a taste decision back; better than typing six hex/px values.
- **"capture proposal and place mockup there"** — pinned the workflow: freeze the
  tuned result into OpenSpec *with the mockup travelling alongside*.
- **"recheck"** — a one-word audit prompt that caught the detached-HEAD/branch state
  drift. Cheap and worth repeating after any git-state uncertainty.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to *propose a single fix* for a visual bug | "create mockup … to help user fine tune" | Default to a **tunable mockup** for any aesthetic/color decision |
| Guess the fix direction (lift cards lighter) | Sending a screenshot with the **inverse** choice (sink to `#0a0a0a`) | Hand color/taste decisions to the human via live sliders, don't pre-commit |
| Stay purely in "thinking" mode | "capture proposal and place mockup there" | Treat explore-mode output as a **committed OpenSpec proposal + mockup**, not chat |
| Commit without checking HEAD | "commit proposal", then "recheck" surfaced detached HEAD | **Check `git symbolic-ref HEAD` before/after committing**; branch immediately if detached |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was saved this session, but the workflow is **clearly
repeatable** and worth codifying. Recommended skill to create:

- **`tunable-ui-mockup-to-proposal`** — Given a visual/CSS complaint about a client
  surface: (1) locate the component + real design tokens, (2) generate a self-contained
  HTML mockup that mirrors the palette and exposes sliders/presets, (3) open it, (4) read
  the human's chosen values off a screenshot, (5) scaffold an OpenSpec change with the
  mockup copied in and a validated spec delta, (6) verify git HEAD before committing.
  **Why effective:** it removes the AI's weakest move (guessing taste) and its riskiest
  (committing onto a detached HEAD), while producing a proposal an implementer can re-tune.

Tools that carried the session: **browser** (live mockup + preset snapshots),
**write** (mockup + proposal + spec), **`openspec validate`**, and one `Explore`
subagent (which missed — see Pitfalls).

## 7. Pitfalls & dead ends

- **`Explore` subagent returned nothing** for "find directory card rendering." When a
  targeted code-location subagent misses, **look directly** — don't re-spawn; grep the
  client package and read `renderGroup`.
- **Two failed git commands** while hunting for the "vanished" files — the real cause was
  a **detached HEAD**, so files written one turn were dropped on an implicit checkout the
  next. *If files you wrote disappear between turns, run `git symbolic-ref HEAD` — a
  detached HEAD is the usual culprit; recreate and branch the commit at once.*
- **Don't silently pick contested design choices.** The AI left scope (workspace-only vs
  every card) and token choice (`--border-card` @0.1 vs `--border-subtle` @0.06) as
  explicit open decisions in the proposal — correct behavior for explore mode.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the failing UI screenshot, the client package path
(`packages/client`), the design-token file (`index.css`), a clean-ish git tree.

- [ ] Locate the rendering component (`renderGroup`) + read the real color tokens.
- [ ] State root cause as a **collision/precise** claim, not a vague "spacing" guess.
- [ ] Write `/tmp/<surface>-mockup.html` — real palette, sliders, presets; open in browser.
- [ ] Snap before/after presets into the chat.
- [ ] Read the human's chosen knob values off their screenshot; re-diagram.
- [ ] `mkdir openspec/changes/<name>/`; write `proposal.md` + `specs/<cap>/spec.md`;
      copy the mockup into the change dir.
- [ ] `openspec validate <name>` → clean; leave contested choices as **open decisions**.
- [ ] `git symbolic-ref HEAD` → if detached, commit then `git branch <os/name>` at once.
- [ ] Final `recheck` to confirm the commit survives branch drift.

**Artifacts produced:** `openspec/changes/separate-workspace-directory-cards/`
(`proposal.md`, `specs/sidebar-directory-cards/spec.md`, `mockup.html`), committed as
`75e72a10` on branch `os/separate-workspace-directory-cards`.

---

_Generated from session `019e9ee7` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-06. Source extract: deterministic facts sheet (session-to-guideline)._
