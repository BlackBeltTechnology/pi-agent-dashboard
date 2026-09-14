# UI Plan — stop-discarding-known-session-state

Surfaces → tokens → states. Every value references a **theme-system CSS
variable**; no raw hex, no new token required.

## Design thesis

The change deletes lies. The UI half must not replace a lie with **noise** — the
sidebar renders dozens of cards at once, so adding permanent chrome to every card
to serve the rare failure case would trade one usability defect for another
(Nielsen #8 aesthetic-and-minimalist; cognitive load — "every on-screen element
must serve the current goal").

**Governing rule for all three surfaces: silence when healthy, specific when
not.** A healthy card gains *zero* new pixels.

## Grounding (existing, do not re-invent)

| Fact | Source |
|---|---|
| Card shell: `rounded-xl`, `pl-1.5 pr-2 py-2`, inset-rim + drop shadow | `SessionCard.tsx:803` |
| Micro-pill: `px-1.5 py-0 text-[10px] rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]` | `SessionCard.tsx:145` (the `moved` badge) |
| Uppercase chip: `px-1.5 py-px rounded-full text-[9px] uppercase tracking-wider` | `SessionCard.tsx:262` |
| Status **shape** channel already exists (`●` `◐` `○` `✕` `ⓘ`) so state never relies on hue alone | `session-status-visuals.ts` `deriveStatusShape` — WCAG 2.2 §1.4.1 |
| Severity token triples (`--severity-{error,warning,info}-{bg,fg,border}`) tuned to a 3:1 floor across 9 themes | `index.css:141-160` |
| Pending-prompt card already has a `failed` arm rendering "not sent" | `ChatView.tsx:2030-2037` |
| **Subtitle returns `null` for ended sessions** | `SessionCard.tsx:84` |

`SessionCard.tsx:84` is the UI expression of the whole change: when a session
ends, the card deliberately has nothing to say. That line is where the death
reason lands.

## Surface 1 — Session card: ended reason

**Slot:** the subtitle line freed by `SessionCard.tsx:84`, as a micro-pill
matching the `moved` badge (Gestalt *similarity* — `moved` is the same class of
fact: "why this card is no longer live").

| State | Shape | Token | Copy |
|---|---|---|---|
| Ended — manual | none | `--text-muted` on `--bg-tertiary` | `closed` |
| Ended — process gone | `✕` | `--severity-error-fg` / `-bg` / `-border` | `process gone` |
| Ended — spawn failed | `✕` | `--severity-error-fg` / `-bg` / `-border` | `restart failed` |
| Ended — unknown | `?` | `--text-tertiary` on `--bg-tertiary` | `ended — reason unknown` |

**Decisions:**
- Manual close stays **visually silent** (muted, no icon). A user who closed a
  session does not need to be told why it closed — that is extraneous load.
- `unknown` is **rendered, not hidden**. Nielsen #1: "we don't know" is a real
  system state and is honest; hiding it re-implies a clean exit.
- **Error** (not warning) for `process gone` — user decision, 2026-09-14. My
  first draft reserved error for dashboard-caused failures; overruled on the
  grounds that severity should track **the user's loss, not the blame**. An
  unasked-for death destroyed work either way, so both involuntary endings read
  as errors and the layer that killed it is a detail in the copy.
- Never a raw signal name. Copy is plain language, no codes (NN/g
  error-message-guidelines).

## Surface 2 — Session card: host-pressure indicator

**Slot:** same subtitle row, right-aligned, live sessions only.

| State | Rule | Shape | Token |
|---|---|---|---|
| Healthy | — | **nothing rendered** | — |
| Degraded | silence > ~2 missed beats (≈35 s) | `◐` | `--severity-warning-fg` |
| Unresponsive | silence ≥ watchdog threshold (60 s) | `◐` + elapsed | `--severity-error-fg` |

**Decisions:**
- **Healthy renders nothing.** Progressive disclosure; keeps the Von Restorff
  isolation effect intact so a degraded card actually stands out among 40.
- Thresholds reuse the **heartbeat (15 s) and watchdog (60 s)** the transport
  already commits to, so the UI never disagrees with the server's own liveness
  verdict (Nielsen #4). This is test-plan gate 5.1.
- Shows **elapsed silence**, not a synthetic "health score" — a number the user
  can verify against their own experience of the freeze.
- `eventLoopMaxMs` corroboration is **past tense** in the tooltip ("stalled 12 s
  earlier"), never presented as current — a frozen loop cannot report itself.

## Surface 3 — Chat: honest undelivered prompt

**Slot:** the existing `failed` arm of the pending-prompt card.

| Element | Now | After |
|---|---|---|
| Label | `not sent` | `not sent` *(kept)* |
| Cause | — | `dashboard offline` / `session unreachable` / `can't resume — no session file` |
| Action | — | **Retry** button |
| Color | literal `text-red-400` | `--severity-error-fg` |
| Timing | after 30 s | **immediate** when the verdict says never-transmitted |

**Decisions:**
- **Attribution is the whole point.** Today's copy — "No response from session —
  the prompt may not have been received" — blames the session for something the
  browser did. NN/g: state what went wrong **and how to fix it**, and never blame
  the wrong actor.
- **Retry** satisfies Nielsen #3 (a marked exit) and makes the preserved input
  actionable rather than merely visible.
- Error conveyed by **icon + text + border**, not color alone (WCAG 1.4.1).
- The old wording is **retained** for the genuinely-unknown case (test F8) — it
  is accurate there.
- Migrating the literal `red-400`/`blue-500` palette to severity tokens is
  **noted, not done**: out of scope under the surgical-changes rule. Flagged
  here so the drift is recorded rather than discovered later.

## Surface 4 — Command feedback for server refusals

Server refusals (X2/X3/X4) surface through the **existing** `emitCommandFeedback`
toast. No new component. Copy names the cause and the next step:

- `Can't resume — this session has no saved transcript.` (16 real sessions)
- `Prompt not delivered — the session isn't connected.`
- `Restart failed — <reason>.`

## Out of scope

Metrics history/sparkline (cut from the change), and any re-theme of the
pending-prompt card's legacy literal colors.

---

## Scored rubric — `mockups/index.html`

`score_mockup` could not run (Playwright chromium absent: `npx playwright
install chromium`). The accessibility floor was therefore computed **in code**
from the real token values rather than skipped, and breakpoints were measured
via `agent-browser`.

| Criterion | Verdict | Evidence |
|---|---|---|
| Contrast (WCAG AA), dark **and** light | **PASS** (after 2 fixes) | severity pills 6.13–8.95:1; titles 13.2 / 15.3:1 |
| Responsive 375 / 768 / 1280 | **PASS** | `scrollWidth === clientWidth` at all three; 0 overflowing elements |
| Touch targets | **PASS** | theme toggle 44px; Retry 36px desktop → 44px under `pointer:coarse` (WCAG 2.2 SC 2.5.8 floor is 24px) |
| Hierarchy | **PASS** | healthy cards render no pill, so the one sick card is the sole focal point in its group |
| Spacing | **PASS** | reuses card padding + pill metrics lifted from `SessionCard.tsx` |
| Token fidelity | **PASS** | no raw hex outside the copied `:root` token block; all state colour via `--severity-*` / `--status-*` |
| Non-colour channel | **PASS** | every state carries a glyph (`✕ ◐ ? ⚠ ✓`) — WCAG 1.4.1 |
| Anti-slop | **PASS** | system font stack, no gradient/hero/purple; sample data is this repo's real session names |
| Console | **PASS** | 0 errors |

### Defects found and fixed

1. **`--text-muted` fails AA** — 2.34:1 dark / 2.04:1 light on `--bg-tertiary`.
   My "quiet closed pill" used it. Quietness now comes from dropping the fill
   and border, not from lowering contrast → `--text-secondary` (7.7 / 8.6:1).
2. **`--text-tertiary` is sub-AA for 10px text** — 4.22 / 3.93:1. The `unknown`
   pill moved to `--text-secondary`.
3. **Tooltip block mis-nested** (`<span>` wrapping block children) — broke layout
   in the first render. Now a `<div>`.
4. **Meta text could push the pressure pill out** of a narrow card. `.meta` is
   now the shrink victim (`flex:1 1 auto; min-width:0`).

### Pre-existing debt — FOLDED IN by user decision (2026-09-14)

I first reported this as "two base palettes, out of scope". Auditing all 18
palettes changed the size of it: **16 of 18 FAIL AA** for `--text-tertiary` on
`--bg-tertiary`, worst 2.48:1, and against `--bg-surface` the worst is 1.67:1.
The user accepted the larger diff and theme-regression risk.

#### Computed remediation (hue + saturation preserved, lightness only)

| palette | now | → proposed | on card | on surface |
|---|---|---|---|---|
| baseDark | `#808080` | `#919191` | 5.26 | 4.53 |
| baseLight | `#777777` | `#636363` | 5.30 | 4.58 |
| draculaDark | `#6272a4` | `#aeb6d0` | 5.85 | 4.54 |
| draculaLight | `#6272a4` | `#4e5c87` | 5.31 | 4.56 |
| nordDark | `#81899b` | `#b7bcc6` | 5.26 | 4.51 |
| nordLight | `#636e83` | `#4f5869` | 5.30 | 4.53 |
| githubDark | `#8b949e` | `#969ea7` | 5.63 | 4.51 |
| githubLight | `#656d76` | `#575e66` | 5.62 | 4.54 |
| catppuccinDark | `#7f849c` | `#b3b6c4` | 6.21 | 4.51 |
| **catppuccinLight** | `#7c7f93` | `#4b4d5b` | 5.39 | 4.58 |
| tokyoNightDark | `#787c99` | `#999cb2` | 5.40 | 4.55 |
| tokyoNightLight | `#6172b0` | `#3c4877` | 5.28 | 4.52 |
| rosePineDark | `#908caa` | `#a29fb8` | 5.93 | 4.54 |
| **rosePineLight** | `#9893a5` | `#625d70` | 5.27 | 4.56 |
| **solarizedDark** | `#839496` | `#e9eced` | 9.15 | 4.54 |
| **solarizedLight** | `#657b83` | `#2d373b` | 8.91 | 4.54 |
| gruvboxDark | `#a89984` | `#c2b8a9` | 5.93 | 4.51 |
| gruvboxLight | `#7c6f64` | `#5a5149` | 5.67 | 4.54 |

#### The trap in the table — 4 palettes invert their own hierarchy

In **catppuccinLight, rosePineLight, solarizedDark, solarizedLight** the
remediated tertiary becomes **more legible than that theme's
`--text-secondary`** — because secondary is *itself* sub-AA there (4.05, 3.67,
4.06, 3.95). Fixing tertiary alone would make the token designed to recede the
most readable text on the card: both numbers improve and the design gets worse.
Those four need a **paired secondary lift**, which is why the spec carries an
explicit hierarchy scenario.

**Solarized is the hard case.** Its `--bg-surface` is far from its text ramp, so
the surface constraint drives tertiary to `#e9eced` (dark) — near-white, 9.15:1
on card. That is AA-compliant and no longer recognisably Solarized. Expect to
move `--bg-surface` instead for that theme, or accept the identity loss. Flagged
for a decision during implementation rather than silently resolved here.

#### Still not fixed

- The pending-prompt card uses literal `red-400` / `blue-500` Tailwind palette
  values while the repo has severity tokens (`ChatView.tsx:2016-2037`).
