# UI plan — serve-live-previews-on-capability-origin

Live mock: `mockups/2026-11-23-live-preview-base-path/mock.tsx` (mock site `#2026-11-23-live-preview-base-path`).
Mode: `preserve` (anti-slop-redesign) — header, address bar, Open ↗, frame body, every existing
`data-testid` unchanged. Design Read profile: `product-ui`. Image direction: off.

## Surfaces → states → tokens

| # | Surface (file) | State | Component | Tokens |
|---|---|---|---|---|
| 1 | Viewer notice slot (`live/LiveFrameParts.tsx`, replaces `RootAbsoluteHint` in tier 5) | tier-5 base needed | `SettingsNotice tone="info"` + base `<code>` + labelled `Copy` button (viewer `BTN`, `copyText`) + `Reload` | `--severity-info-{bg,border,fg}`; base chip `--bg-tertiary`/`--border-secondary`/`--text-primary` |
| 2 | same | copied | button label flips to ✓ "Copied" (`aria-live="polite"`), reverts after 1.5 s | button tokens |
| 3 | same | base changed (holder left, D-U7) | `SettingsNotice tone="warning" role="alert"` + new base + copy + `Reload`; old base struck through | `--severity-warning-*` |
| 4 | Viewer (`LiveServerViewer.tsx`, task 10.6) | duplicate-cookie reset | `SettingsNotice tone="warning" role="alert"` + `Reopen preview`; frame `about:blank` | `--severity-warning-*` |
| 5 | Mock site chrome (`packages/mockup-loop/site/Site.tsx`) | opaque frame (tier 5) | `role="status"` box on `.mk-missing` geometry, solid `--mk-line` border | `--mk-fg`, `--mk-muted`, `--mk-line` (package tokens only, host-agnostic) |
| — | Legacy `/live/` path, static targets | root-absolute page | shipped `RootAbsoluteHint`, unchanged | unchanged |

## Decisions (each cites a public rule)

- **D-UI1 Give the value, not advice.** Today's hint says "run a dev server bound to localhost",
  which is the thing the user already did; it offers no next step. Proposed: the exact base, a
  copy action, and the framework flags. Rule: NN/g error-message guidelines — say what went wrong
  AND how to fix it (ux-best-practices §3 "Error handling"); Nielsen H9 (help recover).
- **D-UI2 One primary next action: `Reload`.** After restarting the server the only step left is
  reload; copy is a secondary icon button. Rule: rubric #6 (one dominant action, Von Restorff + H8).
- **D-UI3 Base wraps, never truncates; selectable.** The pid is a secret the user must reproduce
  exactly; `break-all` + `select-all` so a clipboard failure still leaves a manual path
  (`copyText` returns false on failure; the label stays "Copy"). Rule: Nielsen H5 (error
  prevention), H6 (recognition over recall).
- **D-UI4 Labelled, announced copy at AA target size.** Not the shipped icon-only `CopyButton`:
  it measures 26×18 px (below the 24 px WCAG 2.2 SC 2.5.8 minimum) and only swaps its icon. A
  labelled `Copy` button at the viewer `BTN` size (min-h 28 px) whose label flips to "Copied" in
  an `aria-live="polite"` span. Rule: SC 2.5.8 Target size, SC 4.1.3 Status messages; rubric #7
  (status < 1 s); Nielsen H6 (visible label over icon-only).
- **D-UI5 Explain resets and path changes, don't auto-recover.** Both notices state the cause in
  plain words and leave the action to the user (`Reload` / `Reopen preview`), matching the spec rule
  that the client SHALL NOT reopen automatically. `role="alert"` because the frame was taken away
  from the user. Rule: Nielsen H1 (visibility of system status), H3 (user control); NN/g error
  messages (no raw codes: "duplicate_dashboard_cookie" never shown).
- **D-UI6 Degrade visibly.** The mock site in an opaque frame renders its content and lists exactly
  what is off instead of dying blank. Rule: Nielsen H1; ux-best-practices §3 "Empty states" (never
  a blank screen without explanation).
- **D-UI7 One notice implementation.** New notices use `SettingsNotice` (ui-contract "notice": the
  one implementation for callouts and banners). The viewer's existing private `InfoNote`
  (`LiveFrameParts.tsx:18-27`) is visually equivalent (same severity triple, `text-xs`, icon-left);
  migrating it is out of scope (preserve mode) — noted, not changed. Rule: rubric #9 (one
  consistent pattern, H4).

## Copy (i18n keys to add)

| key | en |
|---|---|
| `live.base.title` | Restart your server with this base |
| `live.base.body` | This dashboard address cannot give the preview its own origin, so it runs under a path. |
| `live.base.copy` | Copy base path |
| `live.base.copied` | Copied |
| `live.base.frameworks` | Vite: `vite --base <base>` · Next.js: `basePath` |
| `live.base.changed.title` | The preview path changed |
| `live.base.changed.body` | Another viewer of this server signed out, so the old path stopped working. Restart your server with the new base. |
| `live.cookieReset.title` | A preview reset dashboard cookies; reopen it to continue |
| `live.cookieReset.body` | The previewed page set a cookie with a dashboard name. The dashboard cleared it and closed the preview. |
| `live.cookieReset.reopen` | Reopen preview |
| `live.reload` | Reload (reuse `live.updated.reload`) |
| mock site (package, plain text) | Storage unavailable in this preview. … Open the mock site directly for the full experience. |

## Accessibility checks (hard gate)

- Notice text/fg on severity bg: contract severity triples (AA in every palette, ui-contract
  "Semantic families"). Base chip `--text-primary` on `--bg-tertiary`: body-text pair (AA).
- Targets: `Copy`, `Reload`, `Reopen preview` reuse the viewer `BTN` (min-h 28 px ≥ 24 px AA).
- Measured (Playwright, composited colours, base light + dark): 26/26 checks pass (text ≥ 4.5:1,
  targets ≥ 24 px). A non-base palette (themes.ts) is not selectable on the mock site; check it in
  the isolated env at task 10.5.
- Status by more than colour: tone icon + title text; old base struck through AND labelled "Old path".
- Focus: no focus move on notice appearance (`role="status"`); `role="alert"` for the two
  frame-removing states only.
