# UX Review — non-disruptive-file-open

Every decision below is grounded in an externally documented, public design rule.
The mockup at `index.html` is the interaction source of truth.

## What the mockup demonstrates

1. **Mode stickiness** — the openers reveal `split` only from `closed`; `full`
   stays `full`, `split` stays `split`.
2. **Focus intent** — a 👤 user click activates the opened tab; a 🤖 agent auto-open
   (canvas / tool-result), when the editor is already shown, adds the tab **without**
   moving the active tab, marks it **unread**, and plays a **one-time pulse**.
3. The header `Chat│Split│Editor` switch is the user's *own* control — stickiness
   applies to openers, not to the user's explicit switch clicks.

## Heuristic evaluation

### 1. User control & freedom — NN/g Heuristic #3
> "Users often perform actions by mistake. They need a clearly marked 'emergency
> exit'." — <https://www.nngroup.com/articles/ten-usability-heuristics/>

**Problem it fixes:** today the system decides the layout *for* the user — opening a
file force-resets `full`→`split`. That is the system seizing control the user
deliberately took (they maximised the editor on purpose).
**In the mockup:** openers respect the user's chosen mode. The user's exit is always
one click on the header switch, never forced.

### 2. Recognition rather than recall + minimal disruption — NN/g Heuristic #6
> "Minimize the user's memory load by making elements … visible."

**Problem it fixes:** stealing the active tab forces the user to re-find and re-scroll
the file they *were* reading (recall).
**In the mockup:** the reading context is preserved; the new file is *recognised*
via the unread dot on its tab, no memory cost.

### 3. Doherty Threshold / Aesthetic-usability — Laws of UX
> Provide feedback within 400 ms to keep the user engaged. —
> <https://lawsofux.com/doherty-threshold/>

**Applied:** a background tab is not silent-and-invisible; a **one-time pulse**
(~1.1 s ease-out) + a persistent unread dot give immediate, non-modal feedback that
something arrived — the "some UX feedback but don't yank me" requirement.

### 4. Von Restorff (isolation) effect — Laws of UX
> "When multiple similar objects are present, the one that differs is most likely to
> be remembered." — <https://lawsofux.com/von-restorff-effect/>

**Applied:** the unread dot (warm `--unread` orange against the cool tab row) makes
the newly-arrived tab the isolated, noticeable element without stealing focus.

### 5. Jakob's Law — Laws of UX
> "Users spend most of their time on other products; they prefer yours to work the
> same way." — <https://lawsofux.com/jakobs-law/>

**Applied:** "new item arrives in the background with an unread dot, cleared on open"
is the established email/editor-tab pattern (VS Code preview tabs, Gmail unread).
Reusing it means zero new learning.

### 6. Nielsen — Consistency & standards (#4)

**Applied:** the *same* opener path serves every entry point; intent is the only
variable. A future call site that forgets to declare intent defaults to **foreground
(activate)** — the least-surprising fallback — so the system degrades safely.

## Accessibility notes (WCAG)

- **Not colour-alone (WCAG 1.4.1 Use of Color):** the unread state is carried by a
  dot *shape* on the tab, not only a colour shift — screen-reader labelling should
  add `aria-label="… (unread)"` on background tabs in the real build.
- **Focus not stolen (WCAG 3.2.x predictability):** an agent auto-open must not move
  keyboard focus or the active tab; the active editor keeps focus. The mockup encodes
  this (active tab unchanged on background add).
- **Pulse is one-shot, not looping (WCAG 2.2.2 Pause/Stop/Hide):** the highlight
  animates once and stops; no perpetual motion to distract.
- **Reduced motion:** the real build SHALL gate the pulse behind
  `@media (prefers-reduced-motion: reduce)` → dot only, no animation.

## Open follow-ups for implementation

- Add `prefers-reduced-motion` guard on the pulse (noted above).
- Decide the unread dot's exact token (`--unread` / an existing status token) during
  the tab-strip task so it matches the shipped theme system across all 4 themes.
- Screen-reader text for unread tabs (`aria-label` suffix).
