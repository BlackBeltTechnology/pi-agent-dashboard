---
session: 019ec134
week: 2026/W24
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-mobile-back-depth-aware, redesign-openspec-board]
proposal_excerpt: "On mobile, the back-arrow and swipe-back can't return to the session-card list (depth 0) from ChatView (depth 1). Reported repro: shrink a desktop window to mobile size while a session is open, then press back — you s…"
---

# How we did it: Mobile navigation "back" is wrong — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`) with a bug report: on the
mobile dashboard, the back-arrow and swipe-back gesture can't return to the session-card
list. The concrete repro was *"shrink a desktop window to mobile size while a session is
open, then press back — you stay stuck in the session instead of dropping to the cards."*
The real objective, once the exploration clarified it, was **not** to write a fix but to
*capture the root cause and a design* as a complete OpenSpec change proposal:
`fix-mobile-back-depth-aware` — proposal → design → spec delta → tasks, then commit.

## 2. TL;DR playbook

1. Enter `openspec-explore` — thinking only, no code. State the repro precisely.
2. Consult the file index / grep for the real symbols (`getMobileDepth`, `MobileShell`,
   `goBackOrHome`, `useContentViews`) instead of the reporter's vocabulary ("card view").
3. Trace **both** back paths (header arrow + swipe) to the single primitive they share —
   here `window.history.back()`.
4. Name the mismatch in one sentence: **shell is depth-based, back is history-based.**
5. Write `proposal.md` directly in the repo's format (the CLI had no scaffold command).
6. `openspec-continue-change` → write `design.md` with numbered decisions (D1–D4) + risks.
7. `openspec-ff-change` → fast-forward `specs/` + `tasks.md`; **verify the capability name
   against the real spec folder** before writing the delta.
8. `openspec validate` until it passes; commit all artifacts + `groups.json` with `[ci skip]`.

## 3. How the collaboration unfolded

**Phase A — Discovery (grep for real symbols).** The AI ignored the reporter's phrase
"card view" (not a literal in the code) and grepped for the actual navigation primitives,
landing on `mobile-depth.ts`, `MobileShell.tsx`, `history-back.ts`. *Why it worked:*
mapping fuzzy bug language onto concrete symbols early prevented chasing a non-existent
"card view" component.

**Phase B — Trace to one primitive.** It followed the header back-arrow
(`SessionHeader → MobileHeader`, `App.tsx:1173`) and the swipe (`MobileShell useSwipeBack`,
`App.tsx:1651`) and showed both funnel through `goBack = goBackOrHome(navigate)` →
`window.history.back()`. *Decision point:* this reframed the bug — it's **depth-1→depth-0**,
not a depth-2 content-view issue as first assumed.

**Phase C — Root cause + the browser constraint.** The AI articulated the model clash
(deterministic depth vs. whatever URL happens to precede `/session/:id` in the browser
stack) and surfaced the hard constraint: **browsers won't let you read the previous history
entry's URL**, so "is the predecessor a shallower in-app route?" can only be answered by the
app tracking its own depth-tagged nav stack.

**Phase D — Generate artifacts.** Wrote `proposal.md` by hand (no CLI scaffold), then via
`openspec-continue-change` wrote `design.md` (D1 hybrid, D2 depth-tagged tracker, D3 pure
`computeBackTarget`, D4 keep the `goBack` name so call sites are untouched).

**Phase E — Fast-forward + self-correct.** `openspec-ff-change` produced `specs/` and
`tasks.md`. The key correction: the proposal named a **non-existent `mobile-navigation`
capability**; the behavior is actually owned by the existing **`url-routing`** spec (which
mandates the broken `history.back()` at line 42). The AI rewrote the delta as a MODIFIED
against `url-routing` and corrected the proposal's capability name for coherence.

**Phase F — Commit.** `openspec validate` passes (4/4). Committed all artifacts +
`groups.json` (registers the change into the `ui` group) with `[ci skip]`, pushed to
`develop`.

## 4. Prompts that worked

- **The goal prompt (`openspec-explore`)** — the explore stance kept the AI in
  investigate-and-capture mode, so it produced a *diagnosis* and *proposal* rather than
  jumping to a half-understood code fix. Good kickoff because the bug was underspecified.
- **`openspec-continue-change` (steering #1)** — a single skill invocation that moved
  proposal → design without re-explaining context; the AI picked up the "next ready
  artifact" automatically.
- **`openspec-ff-change` (steering #2)** — high-leverage: "generate everything remaining in
  one go" unlocked spec delta + tasks together.
- **"commit and push changes with [ci skip]"** — terse and effective; the `[ci skip]`
  instruction is worth stating explicitly for docs-only OpenSpec commits.

*Stronger goal prompt to reuse:* "Explore this mobile-back bug. Repro: <exact steps>. Find
the real primitive both back gestures share, name the model mismatch, and capture it as an
OpenSpec proposal — don't fix code."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Take the reporter's word "card view" literally | (self-corrected) grep for real symbols | State "map fuzzy terms to code symbols first" in the explore prompt |
| First assume a depth-2 content-view bug | (self-corrected) trace both gestures to one primitive | Always find the shared primitive before theorizing |
| Invent a `mobile-navigation` capability | (self-corrected) check existing spec folders | "Verify the capability name against `openspec/specs/` before writing a delta" |
| Try the CLI scaffold (`openspec change new`) | Fall back to writing `proposal.md` by hand in repo format | Know the CLI has no scaffold command here |

Most corrections were self-driven mid-flow — the human's explicit steering was thin
(continue → fast-forward → commit). The reusable lesson is the *checks* the AI ran, not
human redirection.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created. The workflow was carried entirely by the three OpenSpec
skills in sequence:

- **`openspec-explore`** — holds the AI in think/capture mode; produces a diagnosis + safe
  artifacts without touching code. Invoke for any underspecified bug where root cause is the
  deliverable.
- **`openspec-continue-change`** — advances to the next ready artifact with no context
  re-statement. Invoke once a proposal exists.
- **`openspec-ff-change`** — batches the remaining artifacts (specs + tasks). Invoke when
  proposal + design are settled and you want to reach "ready to implement" in one pass.

*Recommended memory to save:* "The `url-routing` capability owns both `Back navigation
button` and mobile depth derivation — don't invent `mobile-navigation`." This would have
skipped the mid-session rename.

## 7. Pitfalls & dead ends

- **`openspec change new` has no scaffold here** → if the CLI fails, write `proposal.md`
  by hand following an existing change's format.
- **`openspec validate` flags a missing spec delta right after the proposal** → expected in
  the experimental workflow; the `specs/<capability>/spec.md` delta is the *next* artifact,
  not a proposal error.
- **Naming a capability from the proposal's assumptions** → cost a rename. Grep
  `openspec/specs/` for the requirement that already governs the behavior first.
- **`history.length > 1` guards assume the prior entry is in-app** → it usually isn't after
  a desktop→mobile resize; that false assumption is the actual bug.

## 8. Reproduce it faster — checklist

- [ ] Enter `openspec-explore`; state the exact repro (shrink-to-mobile → back).
- [ ] Grep real symbols (`getMobileDepth`, `MobileShell`, `goBackOrHome`), ignore reporter jargon.
- [ ] Trace **both** back gestures to their shared primitive.
- [ ] Name the model mismatch in one line (depth-based shell vs history-based back).
- [ ] Confirm the owning capability in `openspec/specs/` **before** writing any delta.
- [ ] Write `proposal.md` by hand (no CLI scaffold) → `openspec-continue-change` (design)
      → `openspec-ff-change` (specs + tasks).
- [ ] `openspec validate` until 4/4; commit artifacts + `groups.json` with `[ci skip]`.

**Inputs to have ready:** the repro steps, write access to `openspec/changes/`, a working
`openspec` CLI. **Artifacts produced:** `openspec/changes/fix-mobile-back-depth-aware/`
{`proposal.md`, `design.md`, `specs/url-routing/spec.md`, `tasks.md`} + `groups.json`;
commit `01d8d082` on `develop`.

---

_Generated from session `019ec134` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-13. Source extract: deterministic facts sheet (session-to-guideline)._
