# UI Plan — lazy-load-session-history

Surfaces → tokens → states, with every decision traced to a cited public rule.
Token authority: [`ui-contract.md`](../../../../ui-contract.md) →
`packages/client/src/index.css`.

## The governing insight

The thing being designed is **not a button**. It is the *disclosure that history
is missing*.

> If the user never learns events were elided, server-side windowing is
> indistinguishable from data loss. The transcript would simply be wrong, and
> silently so. Nielsen **H1 — visibility of system status** makes announcing the
> gap the primary job; loading it is only the secondary one.

Two consequences fall straight out of the protocol design and shape everything
below:

**1. This is NOT the Slack/WhatsApp "load older" pattern.** Those anchor at the
TOP of the transcript because their missing region is unbounded upward. Our gap
is bounded on **both** sides — head above, tail below (design D3/D5) — so the
affordance sits *between two loaded regions*, mid-scroll. It is an interstitial,
not a header.

**2. We can state an exact count, and they cannot.** `gapCount` is known at
subscribe time. Nielsen **H6 — recognition rather than recall** says show it:
"1,200 earlier messages" beats an unlabelled "Load more" that makes the user
guess how much of their session is hidden.

And the honesty constraint that governs the failure states:

> **`gapCount` is what the store HOLDS, not the seq distance.** For a session
> past `maxEventsPerSession` the store already trimmed part of the middle, so
> some of the gap is gone permanently. The UI must never offer to load what it
> cannot deliver — H9 (*help users recognize, diagnose, recover*) applied to a
> promise rather than an error.

## Why click-to-load, not scroll-triggered auto-fetch

Resolved at the `scenario-design` gate (G2), and independently backed:

> NN/g data-display guidance: **"Pagination with visible position for find
> tasks; infinite scroll only for exploratory feeds."**
> (https://www.nngroup.com/articles/infinite-scrolling-when/)

Retrieving a specific earlier exchange in your own session transcript is a
**find** task, not feed exploration. Explicit pagination is the cited-correct
pattern, and it also removes the auto-fetch loop risk entirely (design D9).

---

## A — Gap divider (test-plan F5, F6, F7, F9, F10, F14)

**Task:** understand that history is missing, learn how much, and retrieve it.

**Placement:** interstitial between the head segment's last row and the tail
segment's first row. Full-width rule with centered content — the conventional
"separator carrying a label" form (Jakob's Law), matching the existing
`turnSeparator` divider it sits alongside.

| State | Treatment | Rule |
|---|---|---|
| A1 idle | rule + "N earlier messages" + secondary "Load earlier" pill | H1, H6 |
| A2 loading | same rule, pill swaps to spinner + "Loading…", `aria-busy` | H1, Doherty |
| A3 partial | count decrements in place; pill returns to idle | H1, Goal-Gradient |
| A4 refused | plain-language line + "Try again"; count preserved | H9 |
| A5 unavailable | non-actionable tombstone, pill removed | H9 honesty |
| A6 filled | divider removed entirely — nothing left to disclose | H8 |

### State copy

| State | Copy |
|---|---|
| A1 | `1,200 earlier messages` · `Load earlier` |
| A1 singular | `1 earlier message` · `Load earlier` (F14 verifies) |
| A2 | `Loading earlier messages…` |
| A4 | `Could not load earlier messages.` · `Try again` |
| A5 | `Earlier messages are no longer available.` |

**A4 never shows a protocol code.** `out_of_range` / `stale_generation` /
`in_flight` / `not_subscribed` all collapse to one plain sentence plus a retry —
H9 ("plain-language errors stating cause + fix, no codes"). `in_flight` and
`stale_generation` are transient races the user cannot act on differently, so
distinguishing them would add choice without adding agency (Hick's Law).

**A5 is the honesty state** and exists only because of the trimmed-middle case.
It is deliberately NOT an error: nothing failed, the events are simply gone.
Rendering it as an error would misattribute a retention policy to a fault.

### Tokens

| Element | Token | Contrast vs `--bg-primary` |
|---|---|---|
| rule | `--border-secondary` | decorative, non-text |
| count text | `--text-secondary` | **9.07:1** ✓ AA |
| pill surface | `--bg-surface` | — |
| pill border | `--border-strong` | **4.98:1** ✓ >3:1 non-text |
| pill label | `--text-primary` | **15.9:1** ✓ AA |
| tombstone text (A5) | `--text-secondary` | **9.07:1** dark / **9.74:1** light ✓ AA |
| spinner | `--text-primary` | ✓ |

### Two token traps on this surface, both caught by computing the ratios

**1. `--text-muted` is banned here.** #585858 on dark `--bg-primary` is
**2.77:1**; #aaaaaa on light is **2.32:1**. Both fail AA for text. It reads as
the natural "quiet" token, which is exactly why it is the trap.

**2. `--text-tertiary` is NOT safe as text in the light theme.** #777777 on
light `--bg-primary` computes to **4.477:1** — just under the 4.5:1 AA floor.
`index.css` documents that value as an *overlay boundary* under SC 1.4.11, which
only requires **3:1 for non-text**; it is a border token that happens to be
legible, not a text token. The A5 tombstone therefore takes `--text-secondary`.
(Dark-theme `--text-tertiary` is #808080 → 4.98:1 and would have passed, which is
precisely how this defect hides: it is theme-asymmetric.)

### Weight is deliberately secondary

The composer's send button is the view's one focal action. Rubric item 6 (Von
Restorff + H8) allows **exactly one** visually-dominant primary action per view,
so the divider pill reuses the established floating-pill treatment from
`replay-in-flight-pill` (`rounded-full bg-[var(--bg-surface)] border
border-[var(--border-strong)]`) rather than an accent-filled CTA. Consistency
with a shipped component also satisfies rubric item 9 (H4).

### Accessibility

- Pill target **32px on desktop**, **44px below 480px**. Desktop keeps the
  secondary weight (Von Restorff); on mobile the pill is the component's only
  touch target, so Fitts's Law takes precedence over visual restraint and it
  gets the full 44px. Both clear the AA 24×24 floor (rubric 2).
- Below 480px the flanking rules would shrink to sub-24px stubs that read as
  artifacts rather than a divider. They are dropped and the separator moves to
  the container edge, preserving the Gestalt continuity cue at mobile width.
- `role="status"` on the count so the gap is announced, not just drawn (H1).
- `aria-busy` during A2; spinner honors `prefers-reduced-motion` (rubric 5).
- A4/A5 carry an icon **plus** text — state never by color alone (rubric 4).
- Visible focus ring on the pill (rubric 3).

---

## B — Settings control (test-plan F12, F13)

**No new design.** It is a fourth `NumberField` inside the existing
`Section title="Memory Limits"`, inheriting label/hint/value/onChange, the
section's shared "Requires server restart" line, and the Save Bar. Rubric 9 (H4)
is satisfied by *not* inventing a variant.

Only the copy is new:

| Slot | Copy |
|---|---|
| label | `Max Replay Events` |
| hint | `Cap events sent to the browser when reopening a session. Keeps the start and the most recent messages; earlier ones load on demand. 0 = unlimited.` |

The hint names the **outcome** ("keeps the start and the most recent"), not the
mechanism ("head/tail window"), per H2 — match the real world, plain language.
It mirrors the sibling `maxEventsPerSession` hint, which likewise explains
*what survives* rather than the ring-buffer internals.

---

## Mockup

`gap-divider.html` — all six states plus the singular boundary (F14) and the
Settings section, theme-addressable via `?theme=light`. Scored at 375/768/1440
in both themes; every rubric line passes.

## Out of scope

Scroll-anchor preservation (F7) is behavior, not visual design — it has no
rendered treatment beyond "nothing moves". Specified in design D6/task 7.3.
