# Design — gate-notify-rows-by-level

## D1. `success` is its own rung, not a demotion to `info`

**Decision.** The severity ladder is `info < success < warning < error`, and the
pref exposes four stops:

| `notifyMinLevel` | renders | reads as |
|---|---|---|
| `all` (default) | info · success · warning · error | today's behavior |
| `success` | success · warning · error | outcomes and problems, no chatter |
| `warnings` | warning · error | problems only |
| `errors` | error | failures only — the floor |

**Rejected: `success` rides the bottom rung with `info`.** This was the first
proposal (3 stops) on the reading that both mean "everything is fine, FYI". It
was rejected by the requester. A `success` notify reports that a *thing
completed* — a real outcome the user may want even when routine info chatter is
muted. Folding it into `info` makes the useful middle position unreachable.

**Rejected: a second orthogonal pref (`notifyMinLevel` + `showSuccessNotifies`).**
Honest modeling — `success` genuinely is a tone, not a severity — but it costs a
second field, a second Settings control, a second popover row, and a 2×N state
space where several combinations are meaningless (`errors` + success-on`?`).
A single linear axis matches every other display pref and is one control.

**Consequence.** `success` sitting above `info` is a deliberate ordering choice,
not an inherent property of the level. Record it in the type's doc comment so a
later reader does not "fix" the ladder into alphabetical or emission order.

## D2. The gate keys on the notify discriminator, never on the role

A notify row and a **blocking ask** share `role: "interactiveUi"`. Hiding an
unanswered `select` / `confirm` / `input` / `ask_user` deadlocks the session with
no visible cause — the single worst failure this change can produce, and it is
silent.

`addNotify` stamps two independent markers:

```
{ role: "interactiveUi", content: "notify",
  args: { requestId, method: "notify", params: { message, level? }, status: "pending" } }
```

**Decision.** The predicate lives in ONE exported helper in `shared`, consumed by
both gate sites (D3). It returns "visible" for anything it does not positively
identify as a notify — **fail-open**. A row it cannot classify is rendered, never
hidden. An ask misclassified as a notify is a deadlock; a notify misclassified
as an ask is a cosmetic miss.

Do NOT gate on `role === "interactiveUi"`. Do NOT gate on the presence of
`params.level` — a notify may omit it (`addNotify` spreads `level` conditionally)
and a future prompt kind could carry one.

**The floor value fails open too.** Fail-open applies on both inputs, not just
the row. `notifyMinLevel` is persisted unvalidated on both write paths
(`preferences-store.ts` `setDisplayPrefs` merges the partial as-is;
`session-meta-handler.ts` stores the session override as-is), and
`display-prefs.ts` documents the preferences file as a hand-editable surface. An
unrecognized floor value must therefore normalize to `"all"`. Left unhandled it
is not a cosmetic miss: `rank(level) >= rank("oops")` is `NaN >= …` → `false`
for **every** row, so an `error` notify disappears — the one outcome the axis
promises can never happen.

**Predicate signature, across the package boundary.** `shared` cannot import the
client `ChatMessage` type, and the two gate sites do not hold the same object
(`isRowVisible` has `msg.args.method`; the render branch has a built `request`
with `request.method`). So the exported predicate takes a **structural** row
shape — the minimum fields the discriminator reads — plus the floor, and each
site adapts its local object to it. Do not let one site pass `args.method` and
the other pass `request.method` through differently-shaped ad-hoc checks; that
is precisely how the two drift.

**Naming hazard.** The row's level vocabulary is singular
(`info|success|warning|error`) and the pref's is not (`all|success|warnings|
errors`). `success` is spelled identically in both and the rest are not. Rank
the two through separate, explicitly-typed maps; a single map keyed by a union
of both will typo-pass.

**Known bound (accepted).** `addInteractiveRequest` stamps `content: method`,
so a future *blocking* interactive method literally named `"notify"` would
match this discriminator and be hidden. No such method exists and the name is
taken; the cost of a stronger discriminator (a private marker field set only by
`addNotify`) is not paid now. Recorded so the next person to add a prompt kind
sees it. Relatedly, the discriminator check must run **before** the existing
`isWidgetBarPrompt` guard is restructured — notify never carries
`_promptBusComponent` today, so ordering is safe only by construction, not by
an explicit guard.

## D3. The two gate sites are one invariant, not two edits

Since `virtualize-chat-transcript-tanstack`, `ChatView` filters `groupedMessages`
through `isRowVisible` to build `displayRows`, and the virtualizer's `count` is
`displayRows.length`. The render branch then independently returns the element.

```mermaid
flowchart LR
    G["groupedMessages"] --> F["isRowVisible<br/><i>builds displayRows</i>"]
    F --> V["useVirtualizer({count: displayRows.length})"]
    V --> R["render branch<br/><i>returns the element</i>"]
    F -.->|"MUST agree"| R
```

The two sites are **not symmetric**, and the earlier draft of this section had
the failure modes backwards. Stated correctly:

- **Render-branch only** is the real defect. `isRowVisible` still admits the
  row, so `count` includes an index whose branch returns `null` — a measured
  blank of `estimateVirtualRowSize` height (`interactiveUi` → 160px) and
  measurement drift.
- **`isRowVisible` only** is functionally correct on its own: a row filtered
  out of `displayRows` is neither counted nor mounted (see the comment at
  `ChatView.tsx:469-473`). The second site is defensive, matching the
  established pattern — not a correctness requirement.

`rawEvent` is the existing precedent: gated on `showDebugTools` in
`isRowVisible` (~line 497) **and** in the render branch (~line 1183). Follow it
exactly, for consistency with the file's stated convention.

**Consequence for the tests — this is load-bearing.** A test asserting
`displayRows.length` against rendered row count **passes when only one site is
gated**, either one. It does not pin the invariant, and the earlier claim that
it does was wrong. Pinning the render-branch site needs a *direct* assertion
that a hidden notify contributes no measured height / no blank row, or an
assertion on the render branch's own return for a sub-floor row. Keep the count
invariant — it catches the render-branch-only regression — but do not treat it
as coverage of both halves.

## D4. Hide, not relocate

**Rejected for now: route sub-floor notifies to a transient toast / status bar.**
A notify is fire-and-forget, so it has no structural need to occupy permanent
transcript space, and the repo already has the relocation primitive
(`isWidgetBarPrompt` moves prompts out of chat into a widget-bar slot).

But relocation needs a new UI surface — a toast host, a queue, a dismissal
policy, mobile placement — for a problem that a 4-value enum solves. Cost is
not close. Revisit only if losing info-level notifies entirely turns out to
hurt; the pref added here is forward-compatible with a later `"toast"`
placement value.

## D5. Display-only, no server-side drop

The gate is client render-time. The row stays in `SessionState.messages`, so
raising the floor back re-reveals history immediately with no reload and no
refetch — matching how every other `DisplayPrefs` axis behaves. The server never
filters, and `NotifyMessage` is unchanged, which keeps this change protocol-free
and leaves the door open for D6.

## D6. Per-extension muting is blocked on provenance, not on this design

The natural user ask is "mute *this* extension". It is not buildable today:

- `NotifyMessage` = `{ type, sessionId, notifyId, message, level }` — no emitter.
- `notify-proxy.ts` wraps `ctx.ui.notify` once, globally; the wrapper has no
  handle on which extension's `ctx` is calling.

Attribution requires capturing identity at proxy-install time per extension,
which may not be reachable depending on how pi hands out `ctx`. That is a
separate change with a protocol delta. The `notifyMinLevel` axis composes with a
future per-extension mute (floor first, then per-source), so nothing here
forecloses it.

## D8. The renderer re-tone is folded in, not split out

**Decision.** `NotifyRenderer` migrates onto `InlineMessage` inside this change.

Splitting it into `fix-notify-renderer-severity-tokens` was considered. The
split is defensible on paper — it is a pre-existing bug on a different axis, and
the gate change is otherwise protocol-free and small. It was rejected because
the two are **one functional unit**: `notifyMinLevel` promotes `level` from
decoration to the filter's input. A filter whose input the user cannot perceive
is not a styling defect *near* the feature, it is a defect *in* the feature.
Landing the gate first would knowingly ship that state.

**What changes.** `InlineMessage` already supplies every needed part — accent
bar, mandatory icon, `--severity-*` tone maps, compact variant. Two edits:

1. `Severity` union `"error" | "warning" | "info"` gains `"success"`, with its
   `TONE` entry pointing at the existing `--severity-success-*` triple. Those
   tokens already have consumers — `Toast.tsx:47-48` and
   `extension-ui/ToastSlot.tsx:55` — so this is a new consumer, not the first.
   (An earlier draft claimed zero consumers; it was wrong. The fold argument
   below does not rest on that claim.)
2. `NotifyRenderer` maps `NotifyLevel → Severity` 1:1 and renders a level word
   alongside the icon, so level is carried by bar + icon + text + colour
   (WCAG 2.2 §1.4.1 — not colour alone).

**Contrast claim, stated precisely.** The measured figures
(5.45–7.19:1 light, 6.94–8.25:1 dark) are **base theme only**. The repo's own
gate for these tokens is deliberately *relative*, not absolute: per
`message-severity-tokens`, each tier clears a **3:1 legibility floor** across 9
themes × 2 modes with AA on the majority of cells, because 5 of 18 theme·mode
combos already ship sub-AA base body text and a derived tint can never beat the
tokens it derives from. This change therefore inherits that gate rather than
asserting a new absolute one — do NOT write an "AA 4.5:1 in every theme"
assertion into the tests; it is unsatisfiable by construction and the existing
spec says so.

**Scope discipline.** The UX pass logged three other pre-existing defects —
`ChatViewMenu` rows at ~26px with a 13×13px checkbox as the only hit area,
`ToggleField`'s 40×20px switch, and `FieldShell`'s 4.29:1 hint text. All are
out of scope. They are recorded in `mockups/ux-review.md` for separate changes.
The one obligation this change carries forward is that the NEW popover row must
not copy the 26px sibling pattern — it lands at `min-h-[44px]`, matching
`ThinkingLevelSelector`.

## D7. Defaults preserve today exactly

All three presets default `notifyMinLevel: "all"`, and `backfillDisplayPrefs`
fills `"all"` for legacy files. Rejected alternative: opinionated preset
defaults (`simple: "warnings"`), on the argument that `simple` already strips
reasoning, tool results and turn metadata. Rejected because it changes what
existing users see on upgrade for a preference they never expressed — the
change should be strictly additive until someone asks for the opinion.

## D9. Pre-existing empty-message blank is NOT fixed here

`NotifyRenderer` returns `null` when the message and the legacy `title` are both
absent or non-string, but `isRowVisible` still admits that row — so an empty
notify already reserves a measured `interactiveUi` gap today. Two spec
scenarios sit either side of this: "Empty message renders nothing"
(inline-message-log-primitives) and "Row count matches rendered rows"
(chat-view).

**Decision: leave it.** The gate this change adds keys on *level*, not on
payload emptiness, so it neither creates nor worsens the blank. Folding an
emptiness check into the shared predicate would put a rendering concern
(“does this row produce an element?”) into a preferences predicate, and would
make `shared` responsible for `NotifyRenderer`'s validation rules.

**Obligation carried forward:** the count-invariant test MUST NOT be authored
over a transcript containing an empty-message notify, or it will fail for a
reason unrelated to this change. Fixture notifies all carry a message. The
blank itself is recorded for a separate change.
