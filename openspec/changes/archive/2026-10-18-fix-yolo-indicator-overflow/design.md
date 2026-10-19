# Design — fix-yolo-indicator-overflow

Rewritten 2026-10-18 after the mockup review (`mockups/index.html` §R frame Y4,
§0 variant B) and doubt-review cycle 1. Earlier drafts (pill + header indicator,
yellow tokens) are superseded in full; this file is the only design.

## Context

Two inline indicators announce an active YOLO session
(`packages/client/src/components/access-grant/YoloIndicators.tsx`):

| Component | Mount | Host |
|---|---|---|
| `YoloPill` | `packages/client/src/components/session/SessionList.tsx:2831` | right group (`:2827`, `flex gap-1 items-center`) of `header-app-bar` (`:2819`) |
| `YoloSessionIndicator` (mobile) | `packages/client/src/components/session/SessionHeader.tsx:322` | `MobileHeader` `flex flex-col` column |
| `YoloSessionIndicator` (desktop) | `SessionHeader.tsx:492` | desktop row `flex items-center gap-4 text-sm` (`:427`) |

Both anchors (`YoloIndicators.tsx:92`, `:114`) are `inline-flex` with no
`whitespace-nowrap` / `flex-shrink-0` / max width, and the session indicator renders
a full sentence (`:117-123`), so in a non-wrapping flex row each shrinks to
`min-content` and its text wraps — the reported row growth (issue #898).

Further facts:

- `YoloSessionIndicator` carries `role="status"` (`YoloIndicators.tsx:111`) and
  re-renders every second (`useNow`, `packages/client/src/lib/time/use-now.ts:13`):
  a live region re-announcing the sentence once per second.
- `YoloPill` puts a `{remaining}`-interpolated sentence in `title` and
  `aria-label` (`YoloIndicators.tsx:74-91`): its accessible name churns per tick.
- `SessionHeader` receives `sessions.get(selectedId)` (`packages/client/src/App.tsx:2362`),
  live sessions only, and returns early when it is absent (`SessionHeader.tsx:374`);
  an archived session opened read-only never reaches either indicator mount.
- The prompt composer is `CommandInput`, mounted in `App.tsx:2663` (inside the
  `{!readOnly && (…)}` block, after `StatusBar` and `QueuePanel`),
  `packages/client/src/components/folder/DirectoryHomeView.tsx:277` (after
  `AgentSelect`), and `packages/team-app/src/agent/ChatPane.tsx:110`.
  Its root is `border-t … p-3 … flex flex-col shrink min-h-0 max-h-[40%]`
  (`packages/client/src/components/chat/CommandInput.tsx:983`); its card is
  `min-h-0 overflow-y-auto` and encodes focus / `invalid` in its border
  (`CommandInput.tsx:1107-1116`).
- Existing Access navigation is SPA: `useOpenAccess()` calls `preventDefault()`
  then wouter `navigate("/settings/access")` (`YoloIndicators.tsx:57-64`).
- `QuestionStack` (mounted in the bar's right group, `SessionList.tsx:2833`)
  portals its panel and mobile scrim to `document.body`
  (`packages/client/src/components/questions/QuestionStack.tsx:236-245`); React
  synthetic clicks from a portal bubble to React ancestors, i.e. to the bar.
- Row-1 children carry their own `title` (Home `SessionList.tsx:2821`,
  Discord `:2843`, Settings `:2852`; other controls not audited — they keep
  whatever tooltip they have).
- `useLiveYoloSession` ticks at 1 Hz through `useNow`
  (`YoloIndicators.tsx:44-49`); `SessionList.tsx` has no per-second hook today.
- The legacy `SessionSidebar.tsx` header has no YOLO signal today and is not
  changed.
- Shared helpers `useLiveYoloSession`, `yoloRemainingLabel`, `yoloTone` are also
  used by `YoloActivation.tsx:26` and `YoloAccessCard.tsx:18`.
- Caution states are orange, distinct from the yellow `--status-working`
  (`openspec/specs/message-severity-tokens/spec.md`, requirement *Warning is
  visually distinct from working*).

## Goals

- No YOLO element can wrap or grow a header row: row 1 gains no visible
  control and keeps its height; the session header no longer carries YOLO.
- The remaining time is shown where the operator gives prompts: one single-line
  strip directly above each dashboard prompt composer whose `cwd` is in scope.
  It never wraps; its sentence ellipses before the marker or the time.
- The coverage explanation is reachable without navigation on every surface by
  pointer hover and by assistive technology, and is visible on the strip.
- No live region anywhere; tooltips and every link name are static.
- Existing tokens only (`--severity-warning-*`, `--accent-orange-text`).
- Verified at 375 / 768 / 1500 px (viewport height ≥ 600 px) in `en` and `hu`,
  scoped and unscoped; the `zh-CN` strip text is checked in E2E to be no
  wider than `hu` (an authoring constraint on the new strings).

## Non-goals

- The `team-app` composer (`packages/team-app/src/agent/ChatPane.tsx:110`) and
  any change to `CommandInput.tsx`.
- Archived / read-only session surfaces: they have no composer, cannot receive
  prompts, and get no in-content YOLO signal (sidebar tint + Access page remain).
- Row 1's own overflow at narrow sidebar widths (server address + connection
  label overflow at a 300 px drawer with or without YOLO).
- A focus-visible tooltip primitive (`ui:popover` is click-anchored and "NOT a
  tooltip", `packages/client-utils/src/Popover.tsx:12`).
- YOLO semantics, scope matching, expiry, the Access page.

## Decisions

### D1 — Remove both inline indicators

Delete `YoloPill` and `YoloSessionIndicator`; remove their mounts
(`SessionList.tsx:2830-2831`, `SessionHeader.tsx:322` and `:492`, plus the
`SessionHeader.tsx:13` import). This removes the wrapping element at its
source, and with it the `role="status"` live region and the ticking pill name.

*Rejected:* making both shrink-proof (the first draft). On the board the
desktop header at 768 px with the default sidebar left the indicator ~16 px
wide (time clipped), and a header fallback for composer-less surfaces is
unreachable (`App.tsx:2362`, `SessionHeader.tsx:374`).

### D2 — Sidebar row 1: orange tint, no control

A hook `useYoloAppBar()` exported from `YoloIndicators.tsx` returns
`{ className, title, "data-yolo" }` while a YOLO session is live (else an
empty object). The bar gets **no click handler** (decided after doubt review:
a background click misfired inside the inline `ThemePicker` dropdown, on
drag-select and on plugin controls); the bar is a pure signal and the
Access page is reached through `YoloBarLink` or the composer strip. It MUST NOT tick: it reads
`useYoloStatus()` (no `useNow`) and, when `expiresAt` is set, schedules one
`setTimeout` for the expiry instant to drop the tint, so `SessionList` does not
re-render every second:

- `className`: `bg-[var(--severity-warning-bg)] shadow-[inset_0_-2px_0_var(--accent-orange-text)]`.
  Inset shadow, not a border, so the row's box is unchanged. The underline uses
  the `-text` ramp token although it is a decoration: the decoration token
  `--accent-orange` is 2.2:1 on the light tint (below the 3:1 non-text floor),
  `--accent-orange-text` is 4.76:1.
- `title`: the static coverage sentence (D5) — pointer-hover path. Children
  with their own `title` (Home, Discord, Settings, theme controls) show their
  own tooltip; the row tooltip appears on the row's background and on
  children without a `title`.
- `data-yolo`: `"scoped" | "unscoped"`.

`SessionList.tsx` merges these onto `header-app-bar` (adding `relative`).

`YoloBarLink` (exported, `null` when no live session) is rendered as the
bar's **first child**: `<a href="/settings/access" onClick={openAccess}
data-testid="yolo-bar-link">` whose text is the coverage sentence. It is
always out of flow — `absolute left-2 top-full z-popover max-w-[20rem]
rounded border px-2 py-1 text-xs bg-[var(--bg-secondary)]
opacity-0 pointer-events-none focus:opacity-100 focus:pointer-events-auto
focus-ring` — so it never takes a flex slot and focusing it reveals it below
the bar without reflowing row 1 (no `sr-only`/`not-sr-only` toggle, whose
`position: static` reset would put it back in flow). `opacity-0` keeps it in
the accessibility tree. It is the keyboard path (first Tab
stop in the bar) and the assistive-technology path. The bar shows no
countdown; nothing on it ticks.

Contrast (base themes, computed): `--text-tertiary` on `--severity-warning-bg`
4.6:1 dark / 4.8:1 light (today on `--bg-secondary`: 5.85 / 5.76);
`--text-secondary` 6.7 / 7.8; underline `--accent-orange-text` on the tint
4.76:1 light (≥ 3:1 non-text), `#f97316` on the dark tint well above 3:1.
Non-base palettes are probed in E2E (D7).

Scope is not distinguished visually on the bar (same tint); `title` and link
text differ (`coverage` vs `coverageUnscoped`).

**Recorded deviation (operator decision).** `openspec/specs/theme-gallery/spec.md`
*Accent-text hue is a secondary cue* asks a surface adopting an
`--accent-<hue>-text` token to carry its meaning in a word, icon or shape too.
The bar's underline uses `--accent-orange-text`, and the bar shows no word: for
a sighted user without hover its meaning is colour-plus-underline only. The
meaning is available in words through the `title` tooltip, the focus-revealed
link, and the composer strip. A visible "YOLO" word was offered and declined.

`useOpenAccess` is changed to leave modified and non-primary clicks alone
(`e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey` → no
`preventDefault`, so the browser opens a new tab); a plain primary click
navigates in-app as today.

### D3 — Composer strip `YoloComposerStrip`

A strip `<div data-testid="yolo-composer-strip" data-scope>` inside a wrapper
`<div className="shrink-0 px-3 pt-2">` (aligns with the composer root's `p-3`
inset; `shrink-0` so a height deficit cannot collapse it — the same reason
`App.tsx:2596-2599` keeps the context strip `shrink-0`), rendered directly
above the composer root, never inside the card (the card scrolls and its
border already encodes focus / `invalid`, `CommandInput.tsx:1107-1116`).

| Mount | Position | `cwd` |
|---|---|---|
| `App.tsx` session detail | inside `{!readOnly && (…)}`, after `QueuePanel`, immediately before `<CommandInput>` | `selectedSession.cwd` |
| `DirectoryHomeView.tsx` | after `AgentSelect`, immediately before `<CommandInput>` | the folder `cwd` |

The strip follows the composer by construction: wherever `<CommandInput>`
renders in those two files (including frozen split underlays) the strip
renders above it; where the composer is absent so is the strip.

Structure (decided after doubt review: the countdown is **outside** the link,
so the link's accessible name never changes):

- strip `div`: `flex items-center gap-1.5 w-full min-w-0 whitespace-nowrap
  overflow-hidden rounded-lg border px-2.5 py-1 text-xs ${yoloTone(unscoped)}`,
  no role, no `aria-live`;
- link `<a href="/settings/access" onClick={openAccess}
  className="flex items-center gap-1.5 flex-1 min-w-0 focus-ring">`: shield
  (`shrink-0`, `aria-hidden`) + sentence span `truncate min-w-0`. Accessible
  name = the static sentence; `title` = the sentence;
- time span (sibling of the link, plain text): `shrink-0 tabular-nums
  font-semibold`, showing `formatRemaining(ms)`, or for a never-expiring
  session `<span aria-hidden="true">∞</span><span className="sr-only">{yolo.noExpiry}</span>`.

The time is read in reading order when browsing and is never part of a
focused element's name, so nothing re-announces per tick. A tap anywhere on
the sentence or shield navigates; a tap on the time does not.

Floor: shield + time + padding + border (estimate ~70 px; measured in E2E). Above the floor the sentence
ellipses and shield + time stay legible; below it the anchor stays
single-line and inside its column (`overflow-hidden`) and may clip. The
composer column at a 375 px viewport (estimate ~350 px) is far above it.

Rendered only while a session is live and `isCwdInYoloScope(cwd, session)`
(`packages/client/src/lib/access-grants/yolo-status.ts`).

Vertical budget: ≈ 34 px (wrapper `pt-2` 8 + `py-1` 8 + one `text-xs` line
16 + border 2) taken from the messages area above. The strip sits outside the
composer root's `max-h-[40%]` bound (`CommandInput.tsx:983`); the composer
root itself still shrinks (`shrink min-h-0`) and its card scrolls. At the
verified heights (≥ 600 px) the messages area keeps room; below 600 px is the
mobile layout, where the same wrapper applies.

### D4 — Scope distinction

`yoloTone(unscoped)` is unchanged (`--severity-warning-*`; unscoped adds
`border-2 font-bold`). The strip is the only surface naming the time and
carries the distinction, plus the "every folder" wording of
`coverageUnscoped*`. No glyph is used for scope (`∞` keeps meaning "does not
expire").

### D5 — Copy and keys

| Key | Use |
|---|---|
| `yolo.coverage`, `yolo.coverageUnscoped`, `yolo.coverageForever`, `yolo.coverageUnscopedForever` (new, static, no `{remaining}`) | bar `title`, bar link text, strip sentence + `title` |
| `yolo.noExpiry` (new) | strip screen-reader text for `∞` |
| `yolo.pill`, `yolo.pillUnscoped`, `yolo.pillTitle`, `yolo.pillTitleUnscoped`, `yolo.sessionScoped`, `yolo.sessionUnscoped` | **deleted** with their components (`i18n-hu.ts:1800-1803`, `:1812-1813`; `i18n-zh-CN.ts:1279-1282`, `:1291-1292`) |
| `yolo.left`, `yolo.untilServerStops` | kept (`yoloRemainingLabel`, used by `YoloActivation.tsx` / `YoloAccessCard.tsx`) |

English has no catalogue (`packages/client/src/lib/i18n/i18n.tsx:38`); English
strings are the inline `i18nT` fallbacks. `npm run i18n:parity`
(`scripts/i18n-parity.mjs`) reports gaps only, so symmetric deletion is safe.

English strings (inline fallbacks; `hu` / `zh-CN` translate them, keeping
the `zh-CN` rendering no wider than `hu` on the strip):

| Key | English |
|---|---|
| `yolo.coverage` | YOLO is on: agent and dashboard file access in its folders is auto-allowed. Open Access to end it. |
| `yolo.coverageUnscoped` | YOLO is on everywhere: agent and dashboard file access is auto-allowed in every folder. Open Access to end it. |
| `yolo.coverageForever` | YOLO is on until the server stops: agent and dashboard file access in its folders is auto-allowed. Open Access to end it. |
| `yolo.coverageUnscopedForever` | YOLO is on everywhere until the server stops: agent and dashboard file access is auto-allowed in every folder. Open Access to end it. |
| `yolo.noExpiry` | no expiry |

### D6 — Selection of the sentence

`session.unscoped` × `remainingMs(session, now) === null` selects one of the
four coverage keys. The `*Forever` pair embeds the "until the server stops"
wording as literal text.

### D7 — Verification vehicles

jsdom (vitest) pins structure, classes, attributes, key selection, tick
stability and absence of live regions; it performs no layout. Layout
(single line, height unchanged, right edge, floor, `hu` ≥ `zh-CN`, contrast
across palettes) is verified in Playwright, `tests/e2e/yolo-indicator-layout.spec.ts`,
against the docker harness. E2E is opt-in in this repo (`npm run test:e2e`);
the layout proof therefore runs on the ship path, not on every `npm test`.

Row-1 contrast across the 18 theme × mode combos (operator decision at the
scenario-design gate): `--text-secondary` and `--text-tertiary` on the tint
each ≥ 4.5:1 or ≥ 85% of their contrast on `--bg-secondary`; the underline
≥ 3:1 on the tint. `--text-muted` icons are excluded (already below 3:1
untinted). Measured in a real browser (resolved `color-mix`), like the
`message-severity-tokens` relative gate.

Viewport selection follows `useMobile` (width < 768 or height < 600,
`packages/client-utils/src/useMobile.tsx:15`); height is held ≥ 600 px.

## Risks / Trade-offs

- **Bar meaning is colour-only without hover** (D2 recorded deviation from
  `theme-gallery` *Accent-text hue is a secondary cue*; operator decision).
- **No pointer path from the bar** (D2): the bar has no click handler; pointer
  users reach Access through the composer strip or Settings.
- **Sidebar no longer names the remaining time.** On routes with no composer
  (settings, home without a folder) the time is visible only on the Access page;
  the tint still signals YOLO.
- **Archived read-only surfaces show nothing in-content** (Non-goals). With the
  sidebar hidden (mobile) such a surface has no YOLO signal; it cannot receive
  prompts.
- **Out-of-scope composers show no strip** (scope gating, as before); with the
  sidebar hidden, a scoped YOLO is invisible from an out-of-scope session.
- **Row-1 text contrast drops** from ~5.8:1 to ≥ 4.6:1 under the tint
  (still AA).
- **Removing `role="status"`** (by deleting the component) drops the
  appearance announcement; operator activation already surfaces messages
  (`YoloActivation.tsx` `yolo.activated`, `yolo.dialogActivated`);
  env-activated sessions are learned on reaching the bar link, the strip or
  the Access page.
- **Layout is not gated on `npm test`** (D7) — repo policy for E2E.
- **Orange also marks worktree identity** (`--tint-orange-*` backs
  `--severity-warning-*`, `index.css:200`, `:215`); YOLO surfaces share the hue
  with worktree chips. Meaning is carried by the strip's words and the bar's
  tooltip/link.
- **Muted row-1 icons get fainter.** `ThemePicker` / `ThemeToggle` use
  `--text-muted` (`ThemePicker.tsx:33`, `ThemeToggle.tsx:25`): 2.6:1 / 2.2:1 on
  `--bg-secondary` today (already below 3:1), 2.0:1 / 1.9:1 on the tint.
  Pre-existing failure, worsened while YOLO is on; not fixed here.
- **Frozen split underlays** render the composer, hence a second strip; the
  underlay is `inert` / `aria-hidden`, and E2E queries scope to the live pane.
- **Requirement narrowed on purpose:** the baseline asked for the remaining
  time on the sidebar row on every route and an indicator on every in-scope
  session surface; this change shows the time only on composers and the Access
  page, and drops composer-less session surfaces (operator decisions on the
  mockup board).
