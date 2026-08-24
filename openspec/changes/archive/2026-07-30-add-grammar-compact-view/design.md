# Design — add-grammar-compact-view

## Context

`GrammarCheckResult` (`packages/shared/src/grammar-types.ts`) already carries everything a
richer presentation needs — `correctedText`, and `suggestions[]{ id, offset, length, original,
replacement, kind, message }` — and `useGrammarCheck` already exposes offset-safe
`accept(id)`, `applyAll()`, `dismiss(id)`, `dismissPanel()`. The current `GrammarPanel` renders
one presentation (a stacked list). This change adds a second, default presentation and a
setting; it writes no new endpoint and changes no wire type.

## Decisions

### D1 — One segment builder feeds four redline modes

A single pure function is the source of truth for the inline view:

```
buildRedlineSegments(draft: string, suggestions: ActiveSuggestion[]): Segment[]
Segment = { type: "unchanged"; text }
        | { type: "change"; suggestion: ActiveSuggestion }
```

- Locate each suggestion's span the SAME way `accept` applies it: prefer `offset` when
  `draft.slice(offset, offset+length) === original`, else `draft.indexOf(original)`. Drop
  suggestions that cannot be located (stale) — mirrors the list's staleness handling.
- Sort located spans by start; drop any that overlap an already-emitted span (keep the earlier).
- Walk the draft emitting `unchanged` runs between spans and a `change` per located span.

The four modes are just renderers over the same segments:

| Mode | unchanged | change renders | interaction |
|---|---|---|---|
| **redline** (default) | neutral | `original` dotted-underlined (kind colour) + green ghost `→ replacement` | click / Enter → apply that one |
| **compact** | neutral | `original` wavy squiggle (kind colour) | hover/focus → popover **Apply / Ignore** |
| **original** | neutral | `original` tinted red | read-only |
| **corrected** | neutral | `replacement` tinted green | read-only |

Rendering over the **live draft** (not a frozen snapshot) keeps the redline consistent as the
draft mutates: after `accept(id)` the suggestion is dismissed and its `replacement` is now part
of an `unchanged` run. Invariants worth a unit test: `Σ unchanged+original == draft`, and the
corrected preview `Σ unchanged+replacement == the all-applied text`.

**Why not diff `draft` vs `correctedText` directly?** A raw text diff loses suggestion identity
(`id`, `kind`, `message`) and can't drive per-change apply. Keeping suggestions as the unit and
*positioning* them preserves identity and reuses `accept(id)` untouched.

### D2 — Two persistence layers, deliberately different

- **`correctionView: "redline" | "list"`** — a real grammar setting. Persisted server-side in
  `plugins.grammar.correctionView`, validated by `configSchema` / `parseGrammarConfig`, surfaced
  to the client on `GrammarHealth` (so the composer picks the view from the one `GET
  /api/grammar/health` it already makes) and editable in `GrammarSettings` (`GET /api/config`
  read, `POST /api/config/plugins/grammar` write). Default **`redline`**.
- **`correctionMode` (redline/compact/original/corrected)** — a per-browser *view lens*, not a
  grammar setting. Persisted in `localStorage["grammar.correctionMode"]` (default `redline`;
  any unrecognised stored value falls back to `redline`). Rationale: it is a momentary lens the
  user flips often; a server round-trip per toggle is wrong, and it need not sync across devices.

### D3 — Default flip is intended

`correctionView` defaulting to `redline` means existing installs (no stored key) render the
redline view after upgrade. This is the requested behaviour (redline is the new default); the
list view is one toggle away in settings. Captured as an explicit scenario.

### D4 — List view redesign (L2)

The list presentation moves from stacked rows to aligned **before → after** columns + a
kind-coloured pill + the `message` on its own line, keeping per-row Accept / Dismiss +
Apply-all. Same data, faster vertical scan. This is a MODIFIED requirement, not a new one.

### D5 — Kind → colour is presentation-only

`spelling → --accent-red`, `grammar → --accent-blue`, `punctuation → --accent-orange`,
`style → --accent-purple` (existing theme tokens). Colour never gates apply behaviour, and is
never the *sole* channel — the underline style, position in the sentence, the `message`, and
the per-change aria label all encode the change independently (WCAG 1.4.1).

### D6 — Accessibility

- Every `change` span is focusable (`tabIndex=0`) with an aria-label of the form
  `"<kind>: <original> → <replacement>. <message>. Enter to apply."`; a visible focus ring uses
  `--focus-ring`.
- Redline mode: Enter/click applies. Compact mode's **Apply / Ignore** are real `<button>`s
  reachable by keyboard from the focused span. Per-change *reject* exists in compact (Ignore)
  and list (Dismiss); redline mode is apply-or-leave, with Apply-all / close as the bulk paths.
- Known inherited contrast caveat: green insertion text on the light theme is below AA for
  small text (already true of today's `GrammarPanel`). Mitigated by never being the sole
  channel; a token hardening is noted but out of scope for this change.

## Risks / tradeoffs

- **Redline over live draft** — if the user heavily edits after a check, more spans go
  unlocatable and silently drop from the redline (same class of behaviour as the list's stale
  rows). Acceptable; a re-check repopulates.
- **localStorage mode** — cleared storage resets to `redline`. Acceptable for a view lens.
- **Multi-word `original`** (e.g. `work good`) and punctuation-fused spans must locate as a
  single span; covered by builder unit tests.

## Migration

None. No config migration beyond the additive `correctionView` key (absent → default
`redline`); no wire/endpoint change; the existing legacy `config.grammar → plugins.grammar`
read-through already covers pre-existing installs.
