# Gate notify rows by level

## Why

`ctx.ui.notify(message, level)` is the one extension-authored row in the chat
transcript with **no display preference at all**. Every other axis the chat
renders — reasoning, tool calls per kind, tool-result bodies, turn metadata,
per-turn change summaries, raw debug events — is gated by `DisplayPrefs`. Notify
is not, so a chatty extension permanently pollutes the transcript and the user
has no lever.

1. **The gap is structural, not an oversight in the pref list.** A notify row is
   reduced to `role: "interactiveUi"` (`event-reducer.ts` `addNotify`), the same
   role as `select` / `confirm` / `ask_user`. `ChatView.isRowVisible` returns
   `true` for every `interactiveUi` row except widget-bar-placed prompts, and
   `docs/chat-display-preferences.md` states the rule outright: *"Inline
   ask-user / interactive-UI dialogs always render regardless of `toolCalls.*`
   toggles."* That rule is correct **for asks** — hiding an unanswered question
   deadlocks the session with no visible cause — and it swept notify along with
   them.

2. **The transports are already split; only the display gate lagged.** Change
   `split-notify-from-prompt-request` moved notify off the prompt envelope onto
   its own `NotifyMessage` channel precisely because *a notify is not an
   unanswered ask* (`event-reducer.ts`: `addNotify` appends only a message row,
   never an `interactiveRequests` entry). Nothing blocks on a notify. The safety
   argument for non-hidability does not transfer, and the row already carries an
   exact discriminator: `content === "notify"` **and** `args.method ===
   "notify"`.

3. **A boolean would be the wrong lever.** `normalizeNotifyLevel` admits four
   levels — `info`, `success`, `warning`, `error` — and `NotifyRenderer` colors
   all four. An on/off switch that can swallow an `error` notify trades one
   failure mode for a worse one: a silent extension failure. The useful control
   is a floor, not a switch.

4. **The level is currently not legible, and this change is what makes that
   blocking.** `NotifyRenderer` hardcodes Tailwind `text-{blue,green,yellow,red}-400`
   instead of the `--severity-*` tokens, and it was simply missed by
   `message-severity-tokens`' "No raw severity color literals in message
   components" requirement, which enumerates four components and not this one.
   Measured in the base theme against `--bg-tertiary`, the literals score
   2.23 / 1.53 / 1.34 / 2.43:1 in light mode (WCAG 2.2 §1.4.3 floor 4.5:1),
   versus 6.97 / 5.45 / 6.13 / 7.19:1 for the token triples. Level is also
   carried by hue **alone** — no icon, no text (§1.4.1).

   That is pre-existing, but today `level` is decoration. After this change it
   *decides visibility*: a user who cannot perceive a row's level cannot predict
   what a floor setting hides. Shipping the gate over an illegible level ships a
   filter whose input is invisible. See `mockups/ux-review.md` for the full
   measured pass.

## What Changes

- **`DisplayPrefs` gains `notifyMinLevel`**: `"all" | "success" | "warnings" |
  "errors"`. A notify row renders iff its level ranks at or above the floor,
  on the ladder `info < success < warning < error`.
- **`error` is unsuppressible.** `"errors"` is the floor of the axis; there is
  no `"off"` value. A failing extension can always say so.
- **`success` gets its own rung** rather than riding with `info`. A success
  notify reports a real outcome; info is chatter. `"success"` therefore means
  *"outcomes and problems, no chatter"* — see design D1, where the two rejected
  alternatives (demote to `info`, or split into a second orthogonal pref) are
  recorded.
- **Zero behavior change on upgrade.** All three presets default to `"all"`,
  and the server backfills legacy `preferences.json` files to `"all"`. Today's
  transcript is byte-identical until the user opts in.
- **Asks stay non-hidable.** The gate keys on the notify discriminator, never on
  `role === "interactiveUi"`. `select` / `confirm` / `input` / `ask_user` are
  untouched at every level, including `"errors"`.
- **The per-session View popover gains its first non-boolean control.**
  `ChatViewMenu` renders `Row` (a boolean toggle) exclusively today; a 4-stop
  enum row is new UI there. Shape decided by rubric in `mockups/ux-review.md`:
  a native `<select>` inline-right, preserving the popover's label-left /
  control-right rhythm and yielding the platform picker on mobile.
- **`NotifyRenderer` re-tones onto `InlineMessage`.** It stops hand-rolling a
  bordered box with Tailwind colour literals and renders through the shared
  severity primitive — `--severity-*` tokens, leading accent bar, mandatory
  icon — plus a level word, so level survives in three non-colour channels.
  `InlineMessage`'s `Severity` union gains `"success"`; the
  `--severity-success-*` tokens already exist in `index.css` and currently have
  **no consumer at all**, so this is their first.

Out of scope — deliberately:

- **Per-extension muting.** The obvious ask ("silence *that* extension") is not
  buildable today: `NotifyMessage` is `{sessionId, notifyId, message, level}`
  with **no emitter identity**, and `notify-proxy.ts` wraps `ctx.ui.notify`
  globally rather than per extension. It needs a protocol change plus a
  provenance capture point; deferred to its own change.
- **Relocating notifies to a toast surface.** Considered and rejected for now —
  see design D4.

## Discipline Skills

`doubt-driven-review` (the gate sits one predicate away from hiding a blocking
ask, which deadlocks a session silently), `scenario-design` (the level × floor
matrix plus legacy-row and virtualization cases), `review-code` (cross-package
shared + server + client change before commit).

## Impact

| Package | File | Change |
|---|---|---|
| `shared` | `src/display-prefs.ts` | `NotifyMinLevel` type, `notifyMinLevel` field, 3 presets, `mergeDisplayPrefs`, new `notifyLevelRank` / `isNotifyVisible` helper |
| `server` | `src/persistence/preferences-store.ts` | `backfillDisplayPrefs` clause, `setDisplayPrefs` base + merged |
| `client` | `src/components/chat/ChatView.tsx` | `isRowVisible` `interactiveUi` case **and** the render branch — both, or the virtualizer desyncs |
| `client` | `src/components/chat/ChatViewMenu.tsx` | first non-boolean row in the popover |
| `client` | `src/components/settings/SettingsPanel.tsx` | one control in the chat-display section (existing `SelectField`) |
| `client` | `src/components/interactive-renderers/NotifyRenderer.tsx` | re-tone onto `InlineMessage`; drop the 4 Tailwind literals |
| `client` | `src/components/primitives/InlineMessage.tsx` | `Severity` union gains `"success"` + its `TONE` entry |
| `docs` | `chat-display-preferences.md` | the "Non-hidable" section is now wrong for notify |

No protocol change. No server-side filtering — the gate is display-only, and the
row stays in state so raising the floor back re-reveals it without a reload.
