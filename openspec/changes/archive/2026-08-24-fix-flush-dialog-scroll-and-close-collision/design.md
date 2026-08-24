## Context

`Dialog` (`packages/client-utils/src/Dialog.tsx`) is the shared modal shell for
the whole dashboard. Its `flush` prop was introduced by
`improve-flow-graph-dialog-and-card-interaction` to let a self-framed child
(one with its own header and its own scrollable body) fill the dialog as a
single window. `add-route-backed-overlay-dialogs` then routed six full-page
surfaces through `RouteBackedOverlay`, which renders every one of them as
`Dialog size="full" flush`.

Current state of the `flush` branch:

```
className={ flush
  ? "overflow-hidden"
  : "overflow-y-auto p-5 space-y-4" }
```

plus, unconditionally, `max-h-[92vh]` (full) or `max-h-[80vh]` (sm/md/lg) and
an absolutely-positioned ✕ at `top-3 right-3`.

Two properties follow that nothing in the tree states:

1. The panel is **not** a flex container and has **no definite height** — only
   a cap. A child sized `h-full` resolves `height: 100%` against an indefinite
   parent, falls back to `auto`, and grows to content. Its own
   `overflow-y-auto` is therefore never bounded and never becomes a scroller,
   while the panel's `overflow-hidden` clips the surplus away unreachably.
2. With `flush` there is no header, so nothing applies the `pr-8` that the
   headered branch uses to reserve the ✕ corner. The child paints edge-to-edge
   underneath it.

Measured consequence (1440×900, production bundle): five of five non-plugin
overlay routes clip content with zero working scrollers — worst case 18 353 px
of a README unreachable — and three surfaces have an interactive control
underneath the ✕. Full evidence table in `proposal.md`.

The tree already carries four local workarounds for these two defects
(`h-[92vh]`, `h-[85vh]`, `h-[70vh]`, `closeInset`), each with a comment
diagnosing the trap correctly and fixing it only for itself.

Constraint worth naming up front: this is a **shared primitive**. Every dialog
in the app is in the blast radius, so the non-flush branch must come out
byte-identical in behaviour.

## Goals / Non-Goals

**Goals:**

- Make the `flush` contract satisfiable: a flush child that sizes itself
  `flex-1 min-h-0` and carries an internal `overflow-y-auto` gets a bounded
  height, so tall content scrolls and short content still shrinks to fit.
- Stop the container's own close control from occluding the child's controls.
- Fix the defect once, in the primitive, and delete the workarounds it makes
  redundant — rather than adding a fifth.
- Add verification that can actually observe this class of defect, generalised
  across every overlay route rather than the five that happen to be broken now.
- Write down the ✕ behaviour, which `dialog-system/spec.md` currently omits.

**Non-Goals:**

- Changing non-flush `Dialog` behaviour in any way.
- Changing routing, dismissal semantics, the escape-stack, the focus trap, the
  overlay dismiss guard, or `RouteBackedOverlay`'s frozen-underlay contract.
- Redesigning any of the six converted surfaces. Their internals are touched
  only where `h-full` must become `flex-1 min-h-0`.
- Removing `AgentToolRenderer`'s deliberate `h-[70vh]` pin (see D5).
- Renaming `flush` (see Open Questions).
- Mobile. The mobile shell renders these surfaces as full pages and is
  untouched.

## Decisions

### D1 — `flush` establishes a flex column instead of receiving a definite height

**Decision.** The `flush` branch becomes `overflow-hidden flex flex-col
min-h-0`. The panel keeps its `max-h` cap and gains **no** definite height.

**Why.** A `max-h`-constrained flex column bounds a `flex-1 min-h-0` child
without any element needing a definite height. Below the cap the panel is
shrink-to-fit; at the cap the child's free space is computed from the clamped
container and its `overflow-y-auto` becomes a real scroller.

**Alternatives considered.**

- *Definite height per size variant* (`h-[92vh]` for full, `h-[80vh]` for
  sm/md/lg). Simpler, but it imposes a height the container cannot know is
  correct. `AgentToolRenderer` renders `size="lg" flush` and deliberately pins
  `h-[70vh]` inside an `80vh` cap; a primitive-level `80vh` would override that
  intent and impose it on every future `lg` flush consumer. It also destroys
  shrink-to-fit for short flush content.
- *Copy the `h-[92vh]` wrapper to the five remaining call sites.* This is the
  status quo strategy. It leaves defect 2 untouched on three surfaces and
  re-encodes a vh constant at a seventh site — which is precisely the drift
  that already produced `70` / `85` / `92` against caps of `80` / `92`.

**Consequence.** Children must size with `flex-1 min-h-0`, not `h-full`. That
is a contract change on the child, so it is written into the spec delta rather
than left implicit — the implicitness is what caused this.

### D2 — `flush` suppresses the container's ✕, with an opt-in to restore it

**Decision.** When `flush` is set, `Dialog` does not render its built-in ✕. A
new `showClose?: boolean` restores it for a flush child that renders no header
of its own.

**Why.** `flush` already *means* "the child is self-framed and renders its own
header". A self-framed header is exactly where a close/back affordance lives,
so the container's ✕ is a duplicate that lands in a corner the container does
not reserve. Verified: all six route-backed children render their own back
arrow: `SettingsPanel`, `DirectorySettings`, `MarkdownPreviewView` (behind
`OpenSpecPreview`), `PreviewOverlayView` (its own header, NOT via
`MarkdownPreviewView`), `ZrokInstallGuide`, and the plugin claims.
`AgentToolRenderer` and `FlowAgentCard` render one too, via `MinimalChatView`
popout mode.

**Nine surfaces lose the ✕, not six.** Four call sites pass `flush`, but
`RouteBackedOverlay` multiplexes six routes, and `OpenSpecArtifactDialog`,
`AgentToolRenderer` and `FlowAgentCard` are three more surfaces. Every
verification of the close/focus change must cover all nine, not the six routes.

**The plugin back-target guarantee is weaker than it looks.** The existing
`shell-overlay-route` requirement "Overlay claims SHALL declare a reachable
back target" constrains `depth`/`parentPath` METADATA, checked by manifest
scan. It does not require a rendered control. In-repo claims all render one,
but that is an observed fact about today's plugins, not a contract — which is
precisely why `showClose` exists.

**The seventh consumer breaks that rule and is corrected, not excepted.**
`OpenSpecArtifactDialog` is a `flush` dialog that is NOT a route, so it fell
outside the "six route-backed children" audit above. Its own comment
(`OpenSpecArtifactDialog.tsx:41`) reads *"No back button: the host Dialog
supplies the standard close (✕ / Escape / backdrop). `closeInset` reserves
header space so search doesn't collide."* Suppressing the ✕ there would delete
its only visible dismissal AND leave a `pr-12` reservation for a control that
no longer exists.

Resolution: it gains an `onBack` like every other flush child, after which
suppression is uniform across all nine surfaces and `closeInset` is deleted
entirely rather than kept as a paired contract. Keeping `showClose` +
`closeInset` as a documented pair was the smaller change and was rejected: it
preserves the two-competing-affordances smell in the one place the smell was
first hand-patched, and it makes the primitive's opt-in depend on a child prop
the primitive cannot see.

**`showClose` therefore ships with no in-repo consumer.** That is deliberate:
it exists for the PUBLIC plugin API (`UiDialogProps`), where a third-party
flush child may legitimately render no header. An unused-in-repo prop is a
real cost — accepted because removing it would leave plugin authors with no
escape hatch from a suppression rule they cannot override.

**Alternatives considered.**

- *Promote `closeInset` into the primitive* (auto `pr-12` on flush children).
  Reserves the corner but keeps two competing dismissal affordances in one
  header — the underlying UX problem rather than the fix. It also cannot work
  generically: the padding has to land on the child's header element, which
  the container does not own.
- *Fix each colliding child.* This is what `closeInset` already is. It is
  opt-in, so it fails exactly where someone forgets — demonstrated by
  `MarkdownPreviewView` colliding on the route path and not on the ephemeral
  dialog path, same component, purely because one call site passes the prop.

**Why this does not weaken dismissal.** `Esc` (via the escape-stack) and
backdrop click are untouched, and both still route through the overlay dismiss
guard, so the unsaved-edits prompt still fires on the two guard registrants
(`SettingsPanel`, `InstructionsPage`). What is removed is a redundant gesture,
not the only exit.

**Correction — an earlier revision asserted more than is true here.** It claimed
both guard registrants "already route their own back arrows through the same
dirty prompt (`requestBack`)". Verified: `requestBack` exists ONLY in
`SettingsPanel.tsx:912`. `InstructionsPage` guards via `leaveOverlay`
(`InstructionsPage.tsx:66`) and passes `onBack={isDesktop ? undefined :
backToTree}` — so on DESKTOP, the only context where the flush dialog exists,
it renders no back arrow at all. Its desktop dismissal is the enclosing
`SettingsPanel`/`DirectorySettings` chrome plus Esc/backdrop. The conclusion
(dismissal survives, guard intact) holds; the stated mechanism did not.

**It DOES change initial focus — on every flush surface.** `useFocusTrap`
focuses `focusable[0]`, and the ✕ is the first focusable node in the panel's
DOM (`Dialog.tsx:96`, before the header and children). Today every flush
dialog opens with focus on the ✕; after suppression it opens on the child's
first focusable — in practice the child's own back arrow. This is arguably an
improvement (focus lands in the content the user opened, not on an exit), but
it is a real a11y-visible behaviour change on nine surfaces and it was NOT part
of the original decision. It is called out here so it is chosen rather than
discovered, and it carries a verification task.

The governing spec scenario (`dialog-system`, *Initial focus on open*) is
phrased generically — "the first focusable element inside the dialog, or the
dialog container itself if no focusable child exists" — so it remains true
either way and needs no delta. But that fallback branch becomes **newly
reachable for third-party plugins**: `main.tsx` registers this same `Dialog` as
the public `ui:dialog`, and `showClose` exists precisely for a headerless flush
child — which may render zero focusable elements. Today the ✕ guarantees a
non-empty focusable set for such a child; after D2 it hits `container.focus()`
and Tab dead-ends. For in-repo consumers the fallback is NOT newly reachable
(every one renders a back arrow synchronously); for plugin consumers it is, and
the delta spec therefore states that a flush child with no focusable of its own
SHALL set `showClose`.

### D3 — Children adopt `flex-1 min-h-0`; the root cause is one shared assumption

**Decision.** Replace `h-full` with `flex-1 min-h-0` on the flush children's
roots.

**Why.** This is not five independent bugs. `MinimalChatView` documents its
popout mode as "fills parent (`h-full`)", and `SettingsPanel` /
`DirectorySettings` share the identical root class
`flex-1 flex flex-col min-w-0 h-full`. It is one reasonable assumption — "my
parent has a height" — that `flush` silently invalidates.

**`min-h-0` is the load-bearing token — measured, not assumed.** A synthetic
reproduction of the exact class chains gives:

| Variant | panel clipped | child scrolls |
|---|---|---|
| panel flex column + child `flex-1 min-h-0` | **0 px** | **yes** |
| panel flex column + child unchanged (`h-full`) | 3095 px | no |
| panel flex column + `h-full` merely DROPPED | 3095 px | no |
| panel flex column + `flex-1 min-h-0`, SHORT content | 0 px (40 px panel) | n/a — shrink-to-fit holds |

These roots already carry `flex-1` and `min-w-0`, but never `min-h-0`, so the
flex item's `min-height: auto` content floor prevents it shrinking. Deleting
`h-full` alone therefore fixes nothing. `h-full` must be **replaced by**
`min-h-0`.

**Which children actually need the edit — enumerated, not assumed.** An earlier
revision of this document claimed five broken children. Verified against the
source, it is three:

| Component | Current root | Action |
|---|---|---|
| `SettingsPanel.tsx:1064` | `flex-1 flex flex-col min-w-0 h-full` | `h-full` → `min-h-0` |
| `DirectorySettings.tsx:98` | `flex-1 flex flex-col min-w-0 h-full` | `h-full` → `min-h-0` |
| `ZrokInstallGuide.tsx:133` | `flex flex-col h-full` — **no `flex-1`** | → `flex-1 flex flex-col min-h-0` (ADD, not swap) |
| `MarkdownPreviewView.tsx:46` | `flex-1 flex flex-col min-h-0` | **none** — already conforms |
| `PreviewOverlayView.tsx:24` | `flex-1 flex flex-col min-h-0` | **none** — already conforms |

The last two clipped *only* because their parent was not a flex column; D1
alone fixes them. `OpenSpecPreview` is not a file at all — it is a function in
`App.tsx` that returns `MarkdownPreviewView`.

**Flush DESCENDANTS are in scope too, and one was missed.**
`InstructionsPage.tsx:405` roots at `flex flex-col md:flex-row h-full min-h-0`
and renders INSIDE a flush dialog via `SettingsPanel.tsx:1230` (instructions
tab) and `DirectorySettings.tsx:146`. It is not a direct flush child, so the
`flex-1 min-h-0` SHALL does not bind it — its `h-full` resolves correctly
*provided* every ancestor between it and the panel is bounded, which is exactly
what 4.1/4.2 establish. It needs no edit, but it DOES need measurement: it is
the deepest `h-full` in the affected chain and the settings measurement in the
evidence table was taken on the settings LIST page, not this editor.

**`DirectorySettings` has non-overlay mounts.** It renders in the flush overlay
(`App.tsx:2615`), in the live chain (`App.tsx:1882`), and on mobile via
`renderFolderSettings` (`App.tsx:2229`). Task 4.2 edits its root globally, so
all three are in blast radius — not just the two shells named above.

**Both shells share these roots.** `SettingsPanel` and `ZrokInstallGuide` mount
BOTH in the flush overlay and directly in `MobileShell`'s detail panel
(`App.tsx:2428-2431`). That panel is `absolute inset-0 … flex flex-col` — a
definite-height flex column — so `flex-1 min-h-0` is correct there too. But
the claim "mobile is unaffected" is an inference, not a measurement, and the
mobile render is therefore a required verification, not an assumption.

The same table kills the tempting simplification of having `Dialog` render its
own `flex-1 min-h-0` wrapper so children need no edit at all: measured, the
unchanged `h-full` child inside such a wrapper still clips 3095 px. Percentage
heights do not rescue a flex item whose `flex-basis` is `0%`. The child-side
edit is mandatory, not stylistic.

### D4 — Delete the workarounds this change orphans

**Decision.** Remove `OpenSpecArtifactDialog`'s `h-[85vh] flex flex-col`
wrapper, and the `closeInset` prop with its `pr-12` in `MarkdownPreviewView`.
**`App.tsx`'s `h-[92vh]` plugin-slot wrapper STAYS** — see D5.

**Why.** Project rule: remove only orphans your change creates. D1 makes
`h-[85vh]` dead — its own comment says it exists because "the flush Dialog
container is not flex", which D1 fixes — and D2 plus the `onBack` addition make
`closeInset` dead, since it reserves space for a ✕ that flush no longer renders.

**Corrected on review.** An earlier revision also deleted the `h-[92vh]`
plugin-slot wrapper as an orphan of the same kind. That was wrong, and it would
have broken the two surfaces this proposal uses as its control group. See D5.

### D5 — Definite-height pins stay: `h-[70vh]` AND `h-[92vh]`

**Decision.** Do not remove `AgentToolRenderer`'s or `FlowAgentCard`'s
`h-[70vh]`, nor `App.tsx`'s `h-[92vh]` plugin-slot wrapper. Verify all three
still behave after D1/D2.

**Why `h-[70vh]` stays.** It is not a workaround for an indefinite parent — it
is a deliberate choice that the subagent/flow-agent detail popout has a stable
height regardless of transcript length. Deleting it would make those dialogs
shrink-to-fit and jump in size as entries stream in. D1 is compatible: a
definite-height child inside a flex column is bounded either way.

**Why `h-[92vh]` stays — the non-obvious one.** It looks like the duplicated
flex context D1 replaces. It is not. Plugin claim bodies render as
`<div className="absolute inset-0 …">` inside the slot's `flex-1 min-h-0`
(`slot-consumers.tsx:801`). **Absolutely-positioned content contributes zero
intrinsic height**, so under D1's deliberately height-INDEFINITE panel the
flex item resolves to 0 and the whole claim disappears. The wrapper's own
comment records exactly this, observed live:

> *A DEFINITE height, not `h-full`. … the slot's `flex-1 min-h-0` gets 0, and a
> claim body positioned `absolute inset-0` (the KB page) disappears entirely.
> … Caught by kb-folder-slot.spec.ts.*

D3's measurement table does not transfer to this case: it measured **flow**
content, whose intrinsic height is non-zero. This is the same category as
`h-[70vh]` — a definite-height pin that the container cannot supply — and it is
the reason D1 refuses to give the panel a definite height generically: the
consumers that need one already know their own number, and the container does
not.

**This is the trap this whole change is about, one level up.** Three pins look
identical in a diff to the wrapper D4 deletes. The distinguishing question is
not "is there a magic vh constant" but "does this child have a non-zero
intrinsic height without it". `h-[85vh]` does; `h-[92vh]` and `h-[70vh]` do not.

### D6 — Verification runs in a real browser, generically, over every overlay route

**Decision.** One e2e gate that enumerates the overlay routes and asserts, per
route:

- `scrollHeight <= clientHeight + ε` **or** a descendant is a working scroller
  (`overflow-y: auto|scroll` with `scrollHeight > clientHeight`);
- no visible `button`/`a`/`input`/`select` inside the container has a bounding
  box intersecting the close control's box (vacuously true once ✕ is
  suppressed, and the guard that keeps it true if `showClose` is ever used).

**Why generic, not a list of the five.** A gate written against known-bad
routes cannot catch the *next* converted surface, which is exactly how this
shipped.

**Why browser-level.** jsdom has no layout engine and reports a zero box for
every element, so the three existing `components/overlay/__tests__/` suites are
structurally incapable of observing this. And `toBeVisible()` passes on an
element that is rendered but clipped — it fails only at zero height, which is
why the KB folder slot was the single case ever caught. Both assertions above
were prototyped during investigation and reproduce all seven measured rows,
including the two passing plugin controls, so the gate is known to discriminate
rather than merely pass.

## Risks / Trade-offs

- **R1 — Shared primitive; every dialog in blast radius.** → The change is confined
  to the `flush` branch and the ✕ render condition. The non-flush class string
  is untouched. Existing `dialog-system` scenarios for the non-flush branch
  stay green as the regression net, and a shrink-to-fit scenario is added for
  short flush content.

- **R2 — Short flush content could stop shrinking to fit.** This is the specific way
  D1 could go wrong, and it is the reason the definite-height alternative was
  rejected. → Explicit spec scenario ("Short flush content still shrinks to
  fit") plus manual verification of the two pre-existing flush consumers
  (`AgentToolRenderer`, `FlowAgentCard`) at short content.

- **R3 — ~~`FlowAgentCard` is neither known-broken nor known-safe.~~ RESOLVED.** It
  carries the same `h-[70vh] overflow-hidden flex flex-col` wrapper as
  `AgentToolRenderer`, with a comment naming the same cause ("gives
  MinimalChatView's `h-full` mode a concrete height + flex parent"). It is
  safe today. → Still re-verify after D1, but it is not an unknown.

- **R4 — Only ONE of four `flush` call sites is broken.** `OpenSpecArtifactDialog`,
  `AgentToolRenderer` and `FlowAgentCard` each independently discovered the
  precondition and each wrote a private constant to satisfy it;
  `RouteBackedOverlay` did not, and it is the one multiplexing six surfaces.
  → This is the argument FOR fixing the primitive, but it also means three
  working call sites are in the blast radius of the fix. Their wrappers must be
  re-verified, not assumed to be no-ops.

- **R5 — Removing the ✕ removes a dismissal gesture users may rely on.** → Mitigated
  by D2's audit: all six route children plus the two pre-existing flush
  consumers render their own back affordance, and Esc + backdrop remain. The
  `showClose` opt-in exists for any flush child found to have no header.

- **R6 — The e2e gate needs seeded harness state.** Overlay routes need a real
  folder, a real change, and a real file to render; several return an error
  state otherwise, which would make the gate vacuous rather than failing. →
  Assert the surface actually rendered its content before asserting geometry,
  so a mis-seeded harness fails loudly instead of passing empty.

- **R7 — Pixel counts are viewport-relative.** The measured clip sizes move with
  viewport. → The gate asserts the viewport-independent invariant
  (`workingScrollers > 0` when clipped), not pixel thresholds.

- **R8 — `OpenSpecArtifactDialog` is URL-less by design and deliberately not
  deleted** by the prior change. → It is a flush consumer too; it must be
  verified after D4 removes its wrapper, not assumed to follow the route path.

## Migration Plan

Client-only, no data or protocol change, no persisted state. Ships as a normal
client build: `npm run build` then `curl -X POST .../api/restart`.

Rollback is a straight revert of the diff — nothing is written, migrated, or
made incompatible, and no other component reads the changed classes.

Sequencing matters within the change: D1/D2 (primitive) must land together with
D3 (children), because the primitive change alone would leave `h-full` children
sized against a flex parent, and the child change alone would leave `flex-1`
roots in a non-flex parent. Verify with the D6 gate after both.

## Open Questions

- **~~Should `flush` be renamed?~~ RESOLVED: no.** Three findings closed it.
  (1) `git log -S` shows `SettingsPanel`'s `h-full` root predates the
  route-backed conversion by five weeks — five of the six broken surfaces are
  pre-existing full pages that were *moved*, not written against `flush`. Nobody
  read the name and misjudged it, so a better name would have prevented none of
  these. (2) Only four call sites pass `flush` at all, and three of them got it
  right — the failure is an unstated precondition, which D1 removes, not a
  misleading word. (3) `flush` is part of the PUBLIC plugin API
  (`UiDialogProps` in `packages/shared/src/dashboard-plugin/ui-primitives.ts`),
  so a rename is a breaking change for third-party plugins. A breaking API
  change that would have prevented nothing is not worth making.

- **Should the flex contract be enforceable rather than documented?** The child
  must size `flex-1 min-h-0`; nothing prevents the next author writing
  `h-full`. The D6 gate catches it at the route level, but only for routes. No
  cheap compile-time or lint-level enforcement is obvious.
