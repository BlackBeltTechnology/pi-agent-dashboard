# How we did it: Planning P/D/S/T artifact badges in a modal dialog — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was asked,
> how it was built with the AI, what had to be steered, and how to reproduce the result
> faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user wanted to change how **P/D/S/T artifact badges** (Proposal / Design / Specs / Tasks
for OpenSpec changes) behave when clicked. Today they navigate to a full-page overlay URL
route. The ask: **open them in a modal dialog instead**. During exploration, a critical
steering turn clarified the real shape — a *split behavior*: **desktop gets a local-state
modal (no URL, ephemeral, peek-and-dismiss); mobile keeps the existing URL route** (deep-linkable,
survives reload, but full-screen so UX is cramped). The goal is to build and plan this
change, then hand it off for implementation.

---

## 2. TL;DR playbook

1. **Enter explore mode** + ground the feature in the codebase. Trace where badges live
   (`openspec-helpers.tsx`), how they funnel through one callback (`onReadArtifact`), and
   what the current URL-driven navigation does. Confirm both the `Dialog` primitive and
   `useMobile()` hook already exist (no new infra needed).

2. **Crystallize the split-behavior design.** Write down exactly what the desktop modal
   does (local `activeTab` state, Dialog with full size, Esc/backdrop close, no URL)
   vs. what mobile does (unchanged — same URL route). Lay out the accepted trade:
   desktop loses deep-linking and reload-survival.

3. **Scaffold OpenSpec artifacts** (`proposal.md` / `design.md` / `specs/...` / `tasks.md`).
   Proposal: the why + scope, with trades spelled out. Design: the `isMobile` branch,
   local-state wiring, and why other shapes (dialog-everywhere, dialog-from-route)
   were rejected. Specs: modify the existing `openspec-artifact-reader` spec with
   a new "desktop dialog" requirement. Tasks: skeleton list of impl + test tasks.

4. **Invoke `plan-proposal`** to run the planning gates:
   - **Doubt-driven-review** (cycle 1): fresh-context adversarial pass on proposal + design
     → finds high-leverage issues (gate in wrong home, reuse claims false, cold-load handling).
   - **Cross-model review** (cycle 1): same artifacts, different model family (GLM)
     → corroborates findings + adds concrete edge cases.
   - **Reconcile** findings against actual code + fix artifacts.
   - **Cycle 2** (optional): fresh-context pass on corrected artifacts
     → finds a real flex-layout bug + a 5-vs-4 site miscount.
   - **Scenario-design**: enumerate all Triples (input × trigger × observable) for the feature.
     No spec gaps found; manifest routes 20 scenarios to L1 (unit) and L3 (e2e).
   - **Fold manifest into `tasks.md`**: each test task carries a manifest ref + exemplar pointer.

5. **Commit the change** to `develop`. All artifacts in `openspec/changes/openspec-artifact-dialog-desktop/`.
   The change is now ready for implementation (in a worktree).

---

## 3. How the collaboration unfolded

### Phase 1: Exploration — Ground the feature in code (10:19–10:24)

**What happened:**
- Started in explore mode. Immediately grounded "P D S T in dialog" by confirming it meant
  the artifact badges, then traced their call chain: badge click → `onReadArtifact` callback
  → `useOpenSpecActions.handleReadArtifact` → `navigate(buildOpenSpecPreviewUrl(...))`
  → full-page `<OpenSpecPreview>` route.
- Verified the primitives exist: `Dialog` component with size/footer/cancel/action, and
  `useMobile()` hook already used in `App.tsx`.
- Checked for prior/archived work (project convention: never duplicate archived changes).
  Found `overlay-url-routing` + `fix-openspec-artifact-tab-url-sync` as direct ancestry.

**Why this worked:**
The habit of grounding every "X in Y" ask in actual code before theorizing saved us from
building the wrong thing. Confirming the primitives exist meant zero new infra needed; we
were composing existing pieces. The coherence check against archives prevented proposing
the same thing twice.

**The decision point:**
The user clarified: "split behavior, desktop modal (local state, no URL), mobile unchanged."
That shaped everything downstream — the gate location, the new component, the tests.

### Phase 2: Crystallization — Write down the design (10:24–10:25)

**What happened:**
- Drafted `proposal.md` with the why (split UX: desktop peek-and-dismiss vs mobile shareable URL),
  the scope (only the badge click wiring, reuse existing reader + primitives), and the accepted
  trade (no deep-linking on desktop).
- Drafted `design.md` with the exact `isMobile` branch logic, the new `openArtifact` handler
  in `App.tsx`, the new `OpenSpecArtifactDialog` component (mirroring the existing
  `ArchiveArtifactReader` 15-line pattern), and a decision table explaining why other shapes
  (dialog-everywhere, dialog-from-route) were rejected.
- Modified `openspec-artifact-reader/spec.md` to add the "desktop modal" requirement.

**Why this worked:**
Writing it down forces precision. The design table — why-we-rejected-X — proved crucial
in steering off weak ideas downstream. The proposal's explicit "deep-linking trade-off" gave
everyone a shared mental model for what we were accepting.

### Phase 3: Review cycles — Adversarial verification (10:36–11:37)

**What happened:**
- **Cycle 1 — doubt-driven-review** on proposal + design:
  - Fresh-context reviewer (no claim, just artifacts) found 6 actionable issues:
    - Gate in wrong home: all badge call sites pass 2 args; cwd is closure-bound in `App.tsx`
      → gating *inside* `useOpenSpecActions` couples a generic hook to App UI state.
    - "Thin wrapper reusing OpenSpecPreview" is false: that component hardcodes `navigate()`
      → must build `OpenSpecArtifactDialog` as a full mirror of the existing `ArchiveArtifactReader`.
    - Cold-load / not-found edge cases unhandled.
    - Affordances wrong: no ✕ button, `size="full"` = 95vw/92vh.
  - **Cross-model pass** (GLM, different architecture family):
    - Corroborated all cycle-1 findings.
    - Added concrete edge cases (resize mid-dialog, abort race).
  - **Reconciliation**: Verified each finding against code, fixed artifacts:
    - Moved gate to `App.tsx` via a new `openArtifact(cwd, changeName, artifactId)` handler.
    - Drafted `OpenSpecArtifactDialog` as a 3rd copy of the `ArchiveArtifactReader` pattern
      (documented as DRY debt, but safer than reuse).
    - Added cold-load handling + empty-artifacts guard.
    - Corrected affordances (Esc/backdrop/back close, no ✕).

- **Cycle 2 — corrected artifacts, fresh-context adversarial pass**:
  - Found a **HIGH layout bug**: `MarkdownPreviewView` root is flex (`flex-1 flex flex-col`)
    but the `Dialog` container is not; reader won't grow. → Wrap in `flex flex-col h-[...]`.
  - Found a **site miscount**: 5 wiring sites, not 4. `SessionList onReadArtifact={handleReadArtifact}`
    is a bare reference (no paren). → Correct count; ensure all 5 sites can swap by reference.
  - Found: empty `artifacts` still triggers a fetch → generic error. → Add explicit not-found guard.
  - Noise: "abort-race" — verified each `loadContent` closure captures its own controller; stale
    writes are properly suppressed. Not a real issue.

**Why this worked:**
Doubt-driven-review caught architectural issues *before* implementation (cycle 1: gate location,
reuse target). Cross-model review corroborated and added depth. The second cycle refined implementation
detail (layout, exact site count). Two cycles hit the stop condition: findings converged from
architectural to implementation-detail, and the core design (App-level gate, local-state tabs,
resize-close) never wavered. Cycling twice proved we had a solid foundation.

### Phase 4: Scenario design & manifest folding (11:38–11:41)

**What happened:**
- Enumerated all test scenarios using ISTQB technique (boundary values, error paths, UI quirks):
  - **Boundary**: `useMobile` width thresholds (767/768 px), height thresholds (599/600 px).
  - **Error**: artifact not found, change removed mid-dialog, cold-load (no `artifacts` yet).
  - **Resize**: dialog open, then viewport shrinks → should close (per the design).
  - **Affordances**: Esc, backdrop click, back button, tab switches via local state.
- All Triples (input × trigger × observable) filled concretely. No spec gaps. No HARD-gate stops.
- Manifest `test-plan.md`: **20 automated (L1 unit + L3 e2e), 1 manual (visual QA)**.
- Folded manifest into `tasks.md` vanilla checkboxes: each test task carries a manifest ref
  (`#En/#Fn/#Xn`), the Triple, and an exemplar pointer (e.g., `ArtifactLettersButton.test.tsx`).

**Why this worked:**
Concrete boundary values (from source code, not guessed) meant all scenarios were testable.
The manifest folding meant each test task was self-contained: a developer can open the task,
read the manifest ref + Triple, jump to the exemplar, and write the test without ambiguity.

### Phase 5: Commit to develop (11:41–21:37)

**What happened:**
- All 5 artifacts created + validated `--strict`:
  - `proposal.md`, `design.md`, `specs/openspec-artifact-reader/spec.md`, `tasks.md`, `test-plan.md`.
- Scoped commit to *only* the change directory (other tree changes left untouched).
- Ready for implementation phase.

---

## 4. Prompts that worked

| Prompt | Why it worked |
|--------|---------------|
| **Initial:** Load openspec-explore, then ask "think deeply about P/D/S/T in dialog" | Ground-truth: the skill's stance (curious, open threads, visual) surfaced all the context before theorizing. No prescriptive script meant the user was free to clarify. |
| **Steering:** "No, this is a split behavior: desktop dialog (local state, no URL), mobile unchanged" | Specificity + acceptance of trade-offs. This one sentence dissolved three cycles of wrong hypotheses. |
| **Escalation:** "Run plan-proposal" | Delegates planning gates (doubt + scenario) to a bounded, repeatable orchestrator. Single invocation = doubt cycles + scenario folding without the human steering each step. |
| **Reconciliation:** "Verify the two load-bearing code facts before you reconcile" | Prevents reviewer-word-for-it fixes. Forced us to ground cycle-1 findings in actual code, catching the false reuse claim before it went into the design. |

**Strong rewrite for future use:**

Instead of a vague "let's think about this," use:
> "I want P/D/S/T artifact badges to open in a local-state modal on desktop
> (no URL, Esc/backdrop close, tabs stay local). Mobile keeps the URL route.
> Start by grounding this in code — trace the badge click chain, verify Dialog
> and useMobile exist, check for archived work. Then use plan-proposal to run
> doubt cycles + scenario design."

---

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Assume a "thin wrapper" reuse was safe | Verified against code; found OpenSpecPreview hardcodes `navigate()`, so no wrapper possible | Explicitly prompt: "Check if the component you want to reuse has hard-coded dependencies before proposing reuse" |
| Gate the split behavior inside the hook | Cycle-1 reviewer found this couples a generic hook to App UI state | Say upfront: "Gates live at the call site, not in generic utilities." Save this as a memory/convention. |
| Miss the 5th badge wiring site (bare reference in SessionList) | Cycle-2 reviewer caught it; grep for bare `handleReadArtifact` not just `handleReadArtifact(` | Prompt: "Find ALL call sites, including bare references and method refs, not just `foo(...)`" |
| Assume Esc alone is enough to close | Revised to Esc + backdrop + mobile back button | Affirm: "Dialog affordances = Esc + backdrop + any platform back. Spell it out per platform." |
| Skip the flex-layout anchor for the reader | Cycle-2 found real layout bug | After drafting, prompt: "Check that nested flex children have a height-constrained parent" |

---

## 6. Skills, tools & memory created — and why they're effective

### doubt-driven-review skill

**What it captures:** Adversarial review of a proposal/design BEFORE implementation, with optional
cross-model second opinion (mandatory when interactive, omitted for batch).

**Why it's effective:**
- Catches architectural issues early (gate location, reuse assumptions) when course-correction is cheap.
- Cross-model review corroborates and adds findings; different model families see different edge cases.
- Bounded (2–3 cycles); stops when findings converge from architectural to implementation-detail.
- Focused on the *artifacts* (proposal + design) and *contract* (spec delta + invariants), not the code.

**When to invoke it:**
Anytime a non-trivial decision is about to stand — especially visibility splits (desktop/mobile),
reuse claims, or trades. Run it BEFORE implementation starts. If the proposal is vague, doubt-review
itself will surface what's missing (gap in the spec = hard stop).

### scenario-design skill

**What it captures:** ISTQB-style test scenario enumeration (boundary values, error paths, UI quirks)
that routes each scenario to the right test level (L1 unit, L3 e2e, manual QA) and produces a
manifest.

**Why it's effective:**
- Concrete boundary values (not guessed) from source code mean zero ambiguity for test authors.
- Manifest folding into `tasks.md` makes each test task self-contained (Triple + exemplar pointer).
- Catches spec gaps early (if a scenario's observable can't be filled, the spec is incomplete).
- Produces a reusable test catalog even after the change is shipped.

**When to invoke it:**
After proposal + design are solid. The manifest becomes the source of truth for test coverage;
it outlives the `tasks.md` checkbox. If the spec has unfillable gaps, it HARD-stops before implementation.

### plan-proposal skill

**What it captures:** Orchestrator for the planning phase. Chains doubt-review + scenario-design,
auto-folds the manifest, and commits the artifacts. Runs ONLY in the main interactive session.

**Why it's effective:**
- Single invocation (no per-step steering) = bounded, repeatable planning.
- Calls doubt-driven-review + scenario-design in sequence; no need to remember the order.
- Auto-folds manifest into `tasks.md` so test coverage is reproducible.
- Clear boundary: planning phase ends with a commit; implementation phase happens in a worktree.

**When to invoke it:**
After the explore session has drafted proposal + design. One line: `/plan-proposal` (or override
with a specific change name). It runs all gates and stops at the git-worktree boundary.

---

## 7. Pitfalls & dead ends

| If you hit… | Do this |
|---|---|
| "The design reuses Component X; that's thin and safe" | Stop. Open Component X and search for hard-coded behavior (`navigate()`, `dispatch()`, direct API calls). Reuse is only safe if it's truly behavior-agnostic. If it's not, build a new thin component that IS behavior-agnostic and mirror an existing exemplar. |
| Cycle N of doubt-review keeps finding findings | You're probably in a NOISE loop, not a convergent loop. Check: are the findings converging from architectural → implementation-detail, or drifting into subjective style? Convergent = run 1–2 more cycles. Drift = stop after 2 cycles max, reconcile what you have, and move to scenario-design. |
| "The mobile back button should close the dialog too, right?" | YES but only on mobile. Desktop has no back button. If you're splitting behavior (desktop vs mobile), spell out every affordance per platform. Esc + backdrop works everywhere; back button only on mobile; ✕ only on desktop. |
| Scenario has a boundary value you can't concretely fill | That's a spec gap, not a scenario gap. HARD stop. Go back to design and clarify the spec before scenario-design proceeds. Examples: "what's the viewport width threshold?" → source it from `useMobile` or you're guessing. |
| Manifest fold into `tasks.md` breaks the parser | Run `npx openspec status --change <name> --json` to confirm vanilla checkboxes. The fold must NOT introduce special syntax; `tasks.md` stays vanilla `- [ ] …` lines. Each test task *references* the manifest (via `#En/#Fn` in prose) but doesn't embed it. |

---

## 8. Reproduce it faster — checklist

### Inputs ready?

- [ ] Codebase on `develop` branch, working tree clean.
- [ ] Identified the feature: P/D/S/T badges, current navigation behavior.
- [ ] Confirmed the shape: split (desktop modal + local state, mobile unchanged) or one-everywhere?

### Execute

1. Start in explore mode (`/skill:openspec-explore`). Ground the feature in code.
   - Where do badges live? (`openspec-helpers.tsx`)
   - What callback? (`onReadArtifact`)
   - What's the current UX? (URL-driven full-page route)
   - Do the primitives exist? (Dialog, useMobile)
2. Crystallize the design: write down the `isMobile` branch, the handler location, the new
   component mirroring, the affordances (Esc/backdrop/back).
3. Scaffold: `/openspec-explore` → guide to writing proposal + design + spec delta.
4. Run: `/plan-proposal` (default change name auto-detected).
   - Doubt cycles run; reconcile findings against code.
   - Scenario-design enumerates Triples; manifest auto-folded into tasks.
5. Commit + hand off to `/ship-it` for implementation (worktree).

### Artifacts produced

- `openspec/changes/openspec-artifact-dialog-desktop/proposal.md` — why + scope + trades
- `openspec/changes/openspec-artifact-dialog-desktop/design.md` — the split-behavior logic
- `openspec/changes/openspec-artifact-dialog-desktop/specs/openspec-artifact-reader/spec.md` — modified requirement
- `openspec/changes/openspec-artifact-dialog-desktop/tasks.md` — 26 checkboxes (7 impl, 16 test, 3 validate)
- `openspec/changes/openspec-artifact-dialog-desktop/test-plan.md` — manifest: 20 automated, 1 manual

### Cost / Time

- Session: 11h 18m (exploratory + planning).
- Tokens: ~6.6M (doubt cycles + code reading).
- Cost: ~$10 (high due to cross-model doubt, 2 cycles, and long reflection).
- Faster next time: re-run with cycle 1 only (~$4), or use `@compact` model for cycle 2 (~$6).

---

_Generated from session `019f6a01-b4eb-7a18-a5db-4076e89c1792` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-16. Source extract: `/tmp/facts_019f6a01.md`._
