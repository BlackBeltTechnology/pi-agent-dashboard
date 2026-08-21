# Design — add-route-backed-overlay-dialogs

## Context

~35 addressable destinations, most rendered as full pages that replace the
session or folder underneath. The pain is not click count; it is **context
eviction** — you lose the thing you were working on to look at something about
it.

Three containers already exist in-tree and are used inconsistently:

```
        ROUTE                 SPLIT PANE                DIALOG
   ┌──────────────┐      ┌──────────────┐       ┌──────────────┐
   │ deep-linkable│      │ side-by-side │       │ modal, short │
   │ back/forward │      │ keeps context│       │ dismiss=done │
   │ own scroll   │      │ resizable    │       │ no deep link │
   └──────────────┘      └──────────────┘       └──────────────┘
```

The third column's "no deep link" is an assumption, not a constraint —
`OpenSpecArtifactDialog` already violates it productively.

## Goals / Non-Goals

**Goals**
- Stop context eviction on read-and-return surfaces.
- Preserve every URL, deep link, back button, spec assertion, and e2e `goto`.
- Make the plugin overlay container a *slot-level* decision, not a per-plugin one.
- Collapse duplicate destinations rather than duplicating their containers.

**Non-Goals**
- Changing the split-pane story. `/session/:id/diff` and `/session/:id/editor`
  belong in `SplitWorkspace`; that is a separate change.
- Redesigning any panel's internals. Containers move; contents do not.
- Touching `/pair` or any server-side pairing protocol.
- A command palette / jump-to. Different solution to a different complaint.

## Decisions

### D1 — Route-backed overlay: URL canonical, no visible underlay

**Corrected in doubt-review cycle 1.** The original D1 asserted a `Dialog`
*"over context"* with the launching route still mounted. Two independent
adversarial reviews disproved it, and the code confirms them:

```
App.tsx:2333  {!folderEditorCwd && !settingsMatch && !tunnelSetupMatch && ( … )}
App.tsx:461   selectedId derives from the /session/:id route match
```

A URL-backed dialog points the URL at the dialog. The launching route therefore
stops matching, `selectedId` is `undefined`, and the cascade is gated off — so
there is nothing left to render underneath. "Dialog over your still-mounted
work" is not implementable without a second, URL-independent rendering source.

The cited precedent was also misread. `OpenSpecArtifactDialog` is **local
state**, not a route:

```
App.tsx:529   const [artifactDialog, setArtifactDialog] = useState<… | null>(null)
OpenSpecArtifactDialog.tsx:16  "local-state Dialog … (URL unchanged)"
```

"URL unchanged" means the URL never moves at all. It works *because* it is not
route-backed — the opposite of what was claimed.

**Decision: keep the URL, drop the underlay.** Desktop renders the surface in a
`Dialog` over a plain backdrop; mobile is unchanged (`MobileShell` depth slide);
dismissal returns to the launching route.

**What this costs.** The headline "never lose your place" narrows to "dismissal
reliably returns you". The user's work is not visible behind the dialog. Much of
that guarantee is already delivered by the depth/`parentPath` fixes in groups
1–2, so the container refactor's remaining value is consistent dismissal
affordances (`Esc` / backdrop / ✕ on every converted surface) plus a scoped
container instead of a full-bleed page. A real but modest win — stated plainly
so the scope can be re-cut if it stops paying.

**What this buys back.** `shell-overlay-route:145` ("SHALL NOT render any of the
lower-priority branches … session detail") and `url-routing:259+` forbid
rendering a lower-priority branch while an overlay matches. A still-mounted
underlay would have contradicted both. A plain backdrop keeps them true as
written.

Rejected alternatives:
- **Render the nav-tracker predecessor underneath** — true overlay, but requires
  App.tsx to render two routes at once from two sources, needs a cold-load
  fallback when no predecessor exists (`page.goto("/settings/security")`), and
  contradicts the two requirements above.
- **Nest the URLs** (`/session/abc/settings/general`) — underlay comes free, but
  URLs move: ~13 e2e `goto`s and 2 specs break. Defeats the reason for keeping
  URLs canonical.
- **URL-less dialogs** — cheapest code, but the URL is consumed by
  `landing-page-onboarding`, `mobile-resilience`, ~10 e2e specs, `back-target.ts`,
  and plugin claims.

### D1a — Dismissal is not the same operation as `history.back()`

`SettingsPanel` PUSHES on internal navigation (`SettingsPanel.tsx:856`, `1133`,
`1666`); only init/legacy redirects use `replace`. After `/settings/general` →
rail → `/settings/plugins/x`, one history step lands on `/settings/general` —
with the dialog still open.

A dismissal gesture (`Esc`, backdrop, ✕) MUST therefore mean *"leave this
surface"*, not *"go back one history entry"*. The renderer SHALL unwind the
surface's own pushed entries, or navigate directly to the tracked launching
route. Specifying dismissal as "invoke the depth-aware back action" is wrong for
any surface with internal navigation.

### D1b — The dirty-state guard currently evicts to `/`

```
SettingsPanel.tsx:898-899
  window.history.pushState(null, "", window.location.href);
  setPendingNav("/");            ← hardcoded
```

While dirty, the popstate guard re-pushes and sets a hardcoded `/` target;
`confirmDiscardLeave` then navigates there. Adding backdrop/`Esc` dismissal
routes through that same guard, so confirming a discard would eject the user to
the card list — re-creating the exact defect this change exists to fix. The
confirm target MUST become the launching route.

The guard must also cover `DirectorySettings/InstructionsPage`, which owns its
own dirty state and does not thread through `SettingsPanel`.

### D2 — Plugin overlays convert at the slot, not per plugin

Automation / Goals / KB / the subagent popout are `shell-overlay-route` claims.
One edit to `ShellOverlayRouteSlot` converts all of them plus every future
claim. Rejected alternative: editing each plugin — 4 packages touched, drift
guaranteed on the next plugin.

(An earlier draft also listed a flows agent popout here. `flows-plugin` declares
no `shell-overlay-route` claim; that path exists only in stale packaged output
under `packages/electron/out/`.)

### D3 — `presentation?: "page" | "dialog"`, default `"dialog"`

Dialog-ising the slot constrains every third-party overlay's layout. A
claim-level opt-out keeps the good default while leaving an escape hatch for
width-hungry surfaces. Default `"dialog"` rather than `"page"` so the ergonomic
win applies without every author opting in.

`blackhole-plugin` is the canary — it has an e2e spec (`blackhole-settings.spec.ts`)
that exercises a plugin surface end to end.

**An unknown `presentation` value is FATAL**, unlike `depth` (which warns and
defaults). A typo like `"modal"` would otherwise silently fall back to the
dialog default — handing the author precisely the behaviour they wrote the field
to opt out of. The `depth` precedent is the argument *for* this: a non-fatal
warning let four claims ship broken (see D4a).

### D3a — `presentation: "page"` opts out of mobile too

Resolves the prior open question. `"page"` means full viewport on **both**
desktop and mobile, outside the `MobileShell` depth panel.

Rationale: a surface that declares it needs the whole viewport needs it on a
phone most of all. Rendering a `"page"` claim inside a depth-1 detail panel
would reimpose exactly the width constraint the opt-out exists to escape, and
would leave authors with no way to express "this is genuinely a page".

`depth`/`parentPath` remain **required** for `"page"` claims — with no dialog to
dismiss, the descriptor table is the only thing driving their back action.

### D4 — Depth declarations stay load-bearing on BOTH paths

An earlier draft argued a dialog "closes onto whatever rendered it", making
`depth`/`parentPath` structurally moot on desktop. **That followed from the
underlay premise D1 has now discarded.** With nothing mounted behind the dialog,
there is no "whatever rendered it" to close onto — the dismissal target must come
from the tracked launching route, and on a cold load (`page.goto`) there is no
tracked predecessor at all. In that case the descriptor table is the only source
of a parent.

So `depth` and `parentPath` remain load-bearing on desktop *and* mobile. The
missing declarations on the Goal, KB, and subagent claims were real defects on
every path, and the fixes in group 2 are not merely a mobile concession — they
are what makes a cold-loaded dismissal resolve at all.

### D4a — the defect is wider than the proposal first claimed

A full scan of `packages/*/package.json` found **6** `shell-overlay-route`
claims, not 8, and **4** missing `depth` — not 3:

```
  goal        /folder/:encodedCwd/goals                ✗ missing depth
  goal        /folder/:encodedCwd/goals/:goalId        ✗ missing depth
  kb          /folder/:encodedCwd/kb                   ✗ missing depth
  subagents   /session/:sessionId/subagent/:agentId    ✗ missing depth
  automation  /folder/:encodedCwd/automations          ✓ declared (but see D4c)
  automation  /automation/run/:sid                     ⚠ see D4b (re-parented)
```

**Superseded by D4c.** The first fix declared the goals + kb boards `depth: 1`
"for parity with the automations board". That was a regression — see D4c.

### D4b — RESOLVED: `automation` run monitor re-parented

`/automation/run/:sid` declares `parentPath: /folder/:encodedCwd/automations`.
That pattern requires `:encodedCwd`, which the run path never captures — so
`interpolateParentPath` returns `null` on every match and the back target
**always** degrades to `/`. The declaration is decorative.

The existing code documents this degradation as intended behaviour, so it was
not a regression — but a `parentPath` that can never resolve is misleading
config.

**Chosen: re-parent the URL.**

```
  OLD  /automation/run/:sid                      captures :sid
  NEW  /folder/:encodedCwd/automations/run/:sid  captures :encodedCwd + :sid
```

The cwd the parent needs is now carried by the child, so a cold-load back
reconstructs the exact board URL instead of degrading to the card list.

The usual objection to changing a URL — breaking existing links — does not
apply: a repo-wide scan found **no producer**. Nothing in the client, the
plugin, the server, or the e2e suite navigates to the run monitor. The board
opens run results in its own local modal (`run-result-panel`), never via the
route. The route is reachable only by typing the URL, which is also why the
dead `parentPath` went unnoticed.

Follow-up worth tracking separately: the run monitor is an **orphaned route**.
Re-parenting makes its back action correct, but nothing navigates to it, so the
surface is unreachable in normal use. Wiring a producer (board run row → run
monitor) is a UX change, not a container change, and is out of scope here.

### D5 — Tunnel setup does NOT stack — it replaces

**Corrected as a consequence of D1.** An earlier draft described a stack:

```
  settings dialog
      └── tunnel-setup dialog        ← "3 deep worst case"
```

That cannot happen. `/tunnel-setup` is its own URL, so at that URL `settingsMatch`
is false and the settings dialog is **not mounted at all**. There is no layer to
stack on. The two surfaces alternate; they never coexist:

```
  /settings/gateway   →  [settings dialog]
  /tunnel-setup       →  [tunnel dialog]      ← settings unmounted
  dismiss             →  back to /settings/gateway, settings remounts
```

The `/tunnel-setup` URL is preserved, so `zrok-v2-tunnel.spec.ts`
(`goto("/tunnel-setup")`) is unaffected. Rejected alternative: folding tunnel
setup in as a settings page — the URL dies and that e2e breaks.

**This removes the change's sharpest accepted risk.** Dropping the underlay
dropped the stacking problem with it — see R2.

### D6 — The OpenSpec board stays a page; the artifact becomes a dialog

A kanban board wants horizontal width; a dialog fights it. The artifact reader
is already dialog-shaped and *already has a dialog implementation* — the
full-page path for the same route is a duplicate and is deleted.

### D7 — Resource surfaces dedupe as part of this change

The global and folder grids are one component differing in `scopes`,
`showScopeFilter`, `onViewFile`, and `globalPill`.

An earlier draft justified this as avoiding "two dialogs over one grid". That is
**false** — the two routes are never mounted simultaneously, so no such conflict
exists. The honest case is duplication cost alone: ten destinations maintaining
one grid's wiring at two call sites, both of which this change already edits.

Because the justification is weaker than claimed, this is the first item to cut
if the change needs narrowing. Nothing else in the plan depends on it.

### D8 — `/pair` is out of scope by construction

`main.tsx:167` branches on `window.location.pathname === "/pair"` *before*
`<App/>` mounts. `PairLanding` never enters the router, so no router or
container change can reach it. Recorded explicitly so a reviewer does not have
to re-derive it.

## Risks / Trade-offs

**R1 — Dirty-state loss (highest severity).** `SettingsPanel` tracks `isDirty`.
A dialog introduces two dismiss gestures a full page never had — backdrop click
and Esc. Without a guard, the Instructions editor silently eats an unsaved edit.
This is a functional regression, not polish. *Mitigation:* dirty-state guard on
dismiss, with a scenario covering backdrop and Esc independently.

**R2 — Stacking depth. RETIRED.** The earlier draft accepted up to three
layers. Under D1 (no underlay) route-backed surfaces cannot stack: each owns a
URL, and only the matching one is mounted. The `useEscapeDismiss` escape-stack
remains relevant only for a genuinely nested, *local-state* dialog opened from
within a surface (e.g. a confirm prompt) — which is unchanged by this work.

**R3 — Plugin layout regressions.** D3's opt-out is only useful if authors know
it exists. *Mitigation:* the `blackhole-settings` e2e as canary; slot-contract
documentation in the same change.

**R4 — Mount/unmount lifecycle.** Route-mounted surfaces unmount on navigation.
Dialog-mounted ones may not. A live `AutomationRunMonitor` or a heavy
`ResourceGridPanel` left subscribed behind a dismissed dialog is a leak.
*Mitigation:* assert unmount-on-dismiss; this is why
`performance-optimization` is in the discipline list.

**R5 — Merge collision with `collapse-pairing-into-gateway`.** Both edit
`SettingsPanel.tsx`. *Mitigation:* sequence that change first; see the proposal's
dependency section for the fallback rule if it does not land first.

**R6 — the run monitor (`/folder/:encodedCwd/automations/run/:sid`) is a live,
session-scoped monitor.** Uniformity was chosen over carving it out, so an
accidental dismissal interrupts watching a running job. Accepted deliberately;
revisit if it bites. The run is not cancelled by dismissal — only the view is.

**R7 — the `depth` model cannot express a three-level hierarchy.** `depth` is
`1 | 2` only, so `folder → board → run` cannot be strictly increasing: the board
and the run monitor are both depth 2. The history fast-path requires a strictly
shallower predecessor, so back from the run resolves through `parentPath`
(explicit navigation) rather than `history.back()`. The destination is correct;
scroll position and the forward entry are not preserved. Pinned by a test in
`back-regression.test.ts`. Widening `depth` is out of scope.

## Migration Plan

Container swaps are independently shippable. Suggested order, each verifiable
alone:

1. Route-backed overlay renderer + the `presentation` field (no surface moves).
2. `ShellOverlayRouteSlot` conversion + Goal/KB depth fix (plugin half, one file
   plus two manifests).
3. Preview surfaces (`/view`, `/pi-view`, `/pi-resource`) — thinnest, since
   `PreviewOverlayView` is already a full-viewport overlay.
4. OpenSpec artifact — delete the duplicate full-page path.
5. Settings + folder settings + resource dedupe — largest, and the one gated on
   `collapse-pairing-into-gateway`.
6. Tunnel setup as its own route-backed overlay (replaces settings; no stacking).

## Open Questions

- Does the dirty-state guard belong to the overlay renderer (every dialog gets
  it) or to `SettingsPanel` (only the surface that needs it)? Renderer-level is
  DRY but imposes a contract on plugin claims that may have no dirty concept.
  Note D1b: whichever owns it must also cover `DirectorySettings/InstructionsPage`,
  which holds its own dirty state.
- Is the resource scope switch a filter control inside one panel, or two entry
  points into one panel with the scope preset? Affects whether the folder and
  global URLs stay distinct.
- What renders behind the dialog on a **cold load** (`page.goto("/settings/security")`)?
  A plain backdrop is the D1 answer, but the visual treatment (scrim over blank,
  scrim over the card list, or a full-bleed panel that only *looks* like a page)
  is unresolved and affects whether this change is visible to the user at all.

## Deferred findings (doubt-review cycle 1, accepted as trade-offs)

- **`presentation: "page"` + `parentPath` is internally inconsistent.** The spec
  says `"page"` claims MUST declare `depth` and `parentPath`, but `parentPath` is
  defined only for `depth: 2`. A `depth: 1` page claim cannot satisfy it, and the
  validator does not enforce the rule either way. Needs resolving before any
  third-party plugin declares `"page"`.
- **The `blackhole-plugin` "canary" tests nothing here.** It declares only a
  `settings-section` claim, so `blackhole-settings.spec.ts` never exercises
  `ShellOverlayRouteSlot`. The nearest real coverage is
  `tests/e2e/automation-fanout.spec.ts:94`, which does `goto(/folder/<cwd>/automations)`
  and drives the board — so one claim IS covered end to end, but only the
  automation board. R3's mitigation is weaker than stated.
- **z-layer ratchet.** `scripts/z-layer-lint.mjs` freezes raw z-index usage in
  `packages/client/src`. A new overlay layer in client source may trip the gate
  unless it uses an existing `--z-*` token.
- **External bookmarks to `/automation/run/:sid` break.** The "no producer" scan
  covered this repo only; the plugin is npm-published. Contract-wise this is the
  one URL the change does move, and it is an accepted exception rather than a
  preserved path.
- **`/tunnel-setup` has no in-app producer either** — same orphan status flagged
  for the run monitor; it is reached by URL or by the e2e spec.
