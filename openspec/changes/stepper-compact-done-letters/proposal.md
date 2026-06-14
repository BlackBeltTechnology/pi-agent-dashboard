## Why

On the full-page OpenSpec board the lifecycle stepper renders in `compact` variant, which hides the per-node text label. In that variant a completed artifact node (`Proposal`, `Design`, `Specs`, `Tasks`) collapses to a generic green check — identical to every other done node. The check answers "is this phase done?" but erases *which* phase it was, so a run of four done nodes reads as four indistinguishable green checks. In a stepper, node identity at each position **is** the information, and compact mode has no label to recover it.

The current behavior cites `design.md §6` of the archived `redesign-session-card-and-composer` change, but §6 says the opposite — artifact letters "stay as letters because they're semantic identifiers, not glyphs." The canonical stepper spec (`openspec-attach-combo`, "Done nodes SHALL render … an mdi-check icon **or** the artifact letter") leaves the choice as an unresolved "or"; the code always picks the check. The board spec then hard-codes "(check)". This change resolves the "or" by variant so identity survives where the label is gone.

## What Changes

- **Compact done artifact nodes render the artifact letter (`P`/`D`/`S`/`T`), not the check.** Green border + green tint still signal `done`; the letter restores identity. Applies only to artifact nodes that own a `letter`.
- **Sidebar (labelled) variant is unchanged** — done artifact nodes keep the mdi-check, because the text label below already carries identity.
- **Non-letter nodes are unchanged in both variants** — `Explore`, `Apply`, `Archive` have no artifact letter, so they keep the mdi-check when done (no identity to lose; falling back to their phase icon would mis-signal "not done").
- **Correct the mis-citing code comment** in `OpenSpecStepper.tsx` (drop the false "per design.md §6" reference).

**Not changed:**
- `deriveStepperState` and all node-state derivation logic.
- Done-node green border + tint, current-node orange halo pulse, todo dimming, disabled opacity.
- The `sidebar` / `compact` variant sizing, label-hiding, and `scale(.92)` behavior.
- Connecting-line color logic and opaque node base.

## Capabilities

### Modified Capabilities
- `openspec-attach-combo`: the stepper's done-node rendering rule resolves the existing "check or letter" choice by variant — `compact` done artifact nodes render the letter, `sidebar` done artifact nodes render the mdi-check. Non-artifact done nodes render the mdi-check in both variants.
- `openspec-board`: board cards (compact stepper) render done artifact nodes with the artifact letter; the "(check)" expectation narrows to non-artifact done nodes.

## Impact

**Code touched**
- `packages/client/src/components/OpenSpecStepper.tsx` — `renderContent` gates the `mdiCheck` branch for letter-bearing nodes on `!isCompact`; the mis-citing comment is corrected.

**Tests**
- `packages/client/src/components/__tests__/OpenSpecStepper.test.tsx` — add coverage: compact done artifact node renders its letter; sidebar done artifact node renders the check; compact done `Explore`/`Apply`/`Archive` still render the check.

**Risk / trade-off**
- In compact-done, state is signalled by color (green letter) without a check. The existing green vs orange `tintStyle` wash on the node base gives a second, non-hue cue, mitigating color-blind ambiguity. No new motion or layout.
