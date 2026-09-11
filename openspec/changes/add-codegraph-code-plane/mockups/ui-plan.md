# Code Graph surfaces — UI plan

Change: `add-codegraph-code-plane` (design D4, D8, D9; spec § Dashboard settings
and health UI). Package: the new `codegraph-plugin`. Full **kb-parity** set —
three surfaces, because `kb-plugin` (the package this one claims to mirror)
claims three slots and mirroring only the panel would drop the worktree row.

## Surfaces

| # | Surface | Claim | States to design |
|---|---|---|---|
| 1 | Per-folder Code Graph **dialog** | `shell-overlay-route` `/folder/:encodedCwd/codegraph` — the same slot kb's `KbSettingsClaim` uses | **folder axis only:** fresh · stale · not-indexed · building (+ a one-line host-binary status) |
| 2 | Sidebar folder row | `sidebar-folder-section` → `CodegraphFolderSection`, `placement="sidebar"` | both axes: fresh · stale · not-indexed · indexing · not-installed |
| 3 | Worktree card row | `worktree-card-section` → same component, `placement="card"` | same as surface 2 |
| 4 | **Global settings page** | `settings-section` → `/settings/plugins/codegraph` (inside `PluginSettingsPage`) | host-binary axis only: present · absent |

## Scope split — the correction this review forced

CodeGraph holds **two facts of different scope**, and the original design folded
them into one surface. They are orthogonal, not variants of each other:

| Fact | Scope | Why |
|---|---|---|
| binary present? which rung? which path? which version? | **host-global** | D9's 5 rungs read `CODEGRAPH_BIN` / `process.resourcesPath` / `PATH` / `npm -g` — **not one reads the cwd** |
| index fresh? pending? symbols? files? | **per-worktree** | `<cwd>/.codegraph/` |

The tell that the fold was wrong: the old 6-value enum needed a special case so
`fallback` rendered as `fresh` on the rows. A "state" that is never a distinct
row state is not a state of that axis.

The driver signature hides the seam, because one call returns one field of each:

```
presence(cwd) → { binaryOnPath: boolean;   // ← HOST-global
                  indexed: boolean }        // ← per-worktree
```

### Where each half lives

| Concern | Scope | Surface |
|---|---|---|
| resolution ladder, resolved path, version, install, re-probe | host-global | `settings-section` → `/settings/plugins/codegraph` (**4**) |
| index state, freshness, pending, symbols, files, languages, init / sync / reindex | per-worktree | folder dialog (**1**) |

The folder dialog keeps the binary **outcome**, not the **process**: one compact
line (LED + path, or "not found") with a `Manage in Settings →` deep link.
Repeating a 5-rung ladder in every folder's dialog prints one host fact N times.

**Mechanism — no new slot was needed.** `codegraph-plugin` is a dashboard plugin,
so it already gets `/settings/plugins/codegraph`, and `settings-section` claims
render there through `SettingsSectionByPluginSlot` inside `PluginSettingsPage`. The
bare `SettingsSectionSlot` is a deliberate **no-op** ("two live render paths was
the bug this change removes"), so a claim's `tab` field is **inert** — do **not**
copy the legacy `tab: "general"` that `blackhole-plugin` / `automation-plugin`
still carry.

**Precedent:** `NodeRuntimeSection` / `PiRuntimeSection` are the same shape —
"one curated selection surface per family" — and they live in global settings.

### Consequences

- **The panel's enum drops 6 → 4.** `binary-absent` and `fallback-rung` were never
folder states.
- **With no binary the index section is *replaced* by a blocker**, because the
index is unreadable without the reader. Its one real action is global.
- **This supersedes D9's "the panel's install-hint drives the rung-4 install".**
Install moves to surface 4; the folder dialog keeps its own actions, disabled,
plus the deep link.
- **Row decision (design review):** `binary absent` **is** still shown on every
folder row. The pill answers "is code graph usable *for this folder*", and the
honest answer is no. The label names the **host** cause (`not installed`, title
"…on this host") so it does not read as the folder's fault.

> Slot correction: an earlier draft of this plan named `settings-section`. That
> is the wrong slot — `settings-section` renders a section under the plugin's own
> row on the **General** settings tab (`SLOT_DEFINITIONS`, non-folder-scoped).
> A per-folder panel needs `shell-overlay-route`, which is what kb uses
> (`KbSettingsClaim`, path `/folder/:encodedCwd/kb`).

### Why the worktree row is not optional

A worktree groups under its `gitWorkTree.mainPath`, so it **never gets its own
sidebar folder card** — `worktree-card-section` is the *only* surface scoped to
the worktree's own `cwd`. Per-worktree index freshness is the panel's headline
data, so the reasoning that justified `kb-row-on-worktree-session-card` applies
to CodeGraph verbatim.

### Surface 2 and 3 are ONE component, two placements

`FolderKbSection` takes `placement?: SlotPlacement` and varies three things.
`CodegraphFolderSection` mirrors that exactly:

| | `placement="sidebar"` | `placement="card"` |
|---|---|---|
| `SlotPill surface` | `raised` (`--bg-secondary` + shadow) | `flat` (border only) |
| maintenance action | folder actions menu (`useFolderMenuItem`, scope = `cwd`) | sibling 24px icon-button, scope `null` |
| root class | none | `flex items-center gap-1.5` + pill `flex-1 min-w-0` |

The card sibling button exists because the worktree card has **no folder actions
menu** — registering there would strand the item in a scope with nothing to
render it. It sits *outside* the pill's `role="button"` root (nesting real
buttons in a `role="button"` is an ARIA anti-pattern), and its `title` lives on
a wrapping `span` because a `disabled` button swallows the mouse events a
tooltip needs.

## Accent budget

The pill glyph + accent is a **shared, finite namespace** — a fifth pill must not
collide with the four already in the grid:

| Pill | Accent | Glyph |
|---|---|---|
| Automations | `blue` | `mdiCogOutline` |
| Goals | `indigo` | `mdiTarget` |
| Knowledge base | `cyan` | `mdiDatabaseOutline` |
| OpenSpec | `purple` | `mdiClipboardTextOutline` |
| **Code graph** | **`teal`** | **`mdiGraphOutline`** |
| (reserved) | `red` | kb's error state |

`teal` is the only free accent in the union. The action glyph is `mdiSync`
(CodeGraph's own verb is `codegraph sync`), chosen to not read as kb's
`mdiDatabaseRefreshOutline` or the folder menu's plain `mdiRefresh`.

## Row state derivation

Ordered over **both** axes. A host-global `not-installed` outranks the folder's
own index state: the capability is absent for that folder whatever the index on
disk says.

| Axis | Values → row state |
|---|---|
| host binary | `present` · `absent` → **`not-installed`** |
| folder index | `fresh` · `stale` · `unindexed` → `not-indexed` · `building` → `indexing` |

Row order: `not-installed → indexing → not-indexed → stale → fresh`.

`binary absent` is not `not indexed`: different label, different affordance, and
different action (install host-wide vs build this folder's index). Collapsing
them would tell a user with a working binary to re-index a folder that merely has
no `.codegraph/` yet.

## Container: a dialog, not a page

**All 8 bundled `shell-overlay-route` claims omit `presentation`**, so the spec
default `"dialog"` applies to every one of them — including
`KbSettingsClaim`, the claim this surface mirrors:

| Claim | `presentation` |
|---|---|
| `/folder/:encodedCwd/kb` | *(omitted)* → dialog |
| `/folder/:encodedCwd/goals`, `/goals/:goalId` | *(omitted)* → dialog |
| `/folder/:encodedCwd/automations`, `/automations/run/:sid` | *(omitted)* → dialog |
| `/session/:sid/flow/:flowId/agent/:agentId`, `/session/:sid/architect`, `/session/:sessionId/subagent/:agentId` | *(omitted)* → dialog |

`presentation: "page"` is **declared by zero claims in the repository**. It is
reachable only in the spec, so it is not a precedent to design against.

So the real container is `Dialog size="full" flush` over a viewport-covering
underlay (`RouteBackedOverlay.tsx`):

| Part | Real value |
|---|---|
| scrim | `absolute inset-0 bg-black/60` |
| panel | `w-full mx-4 max-w-[95vw] max-h-[92vh] rounded-lg border border-[var(--border-primary)] shadow-xl bg-[var(--bg-primary)] overflow-hidden flex flex-col min-h-0` |
| claim wrapper | `flex flex-col h-[92vh] min-h-0` — a **definite** height, not `h-full` |
| desktop ✕ | **suppressed** (`flush` without `showClose`) |
| mobile | `MobileShell` depth slide at `depth: 2` — not a dialog at all |

### Four consequences the implementation must honour

1. **The claim must render its own exit.** `flush` without `showClose` suppresses
the built-in ✕, so the header back affordance (`.p-head` ←, `onBack`) is the
*only* visible exit. A flush child with no focusable element would leave keyboard
users with no target and no way out — the `Dialog` docblock states this as a
contract, not a suggestion.
2. **The claim root needs a definite height.** `h-full` resolves against nothing
here: `App.tsx` pins `h-[92vh]` precisely because a percentage height collapses
the chain and an `absolute inset-0` body disappears. Caught by
`kb-folder-slot.spec.ts`.
3. **The claim owns its scroller.** The panel is `overflow-hidden`; the internal
scroll is the claim's (`KbSettingsPanel`'s `Shell` is
`flex flex-col h-full overflow-y-auto` with a `sticky top-0` header).
4. **The reachability contract applies.** A new overlay route is covered by the
same `overlay-layout.spec.ts` assertions as every other: content either fits or a
descendant is a working scroller, and no interactive element may intersect the
effective close control's box.

The panel body is the same shape as `KbSettingsPanel`: sticky header → status
strip → sections → footer. It is **not** a new layout — it is the same shell with
code-plane content, in the same container.

## Tokens

All color comes from the theme-system CSS custom properties
(`packages/client/src/index.css`, `data-theme` on `<html>`). No raw hex in the
component; the mockup re-declares the studio + light values only to stand alone.

Cross-plane semantics reuse the *surface* tokens, **not** kb's literal Tailwind
accents. kb hardcodes `indigo-300` / `teal-300` / `green-400` / `amber-400`
classes; those are dark-only-legible. This panel binds a theme-scoped accent
ramp instead so light mode clears the WCAG floor:

| Role | Dark | Light | Use |
|---|---|---|---|
| `--cg-accent` text/border/fill | `#a5b4fc` / `rgba(99,102,241,.6)` / `rgba(99,102,241,.1)` | `#3730a3` / `rgba(79,70,229,.5)` / `rgba(79,70,229,.08)` | primary actions, info rung |
| `--cg-ok` | `#4ade80` | `#15803d` | binary present, index fresh |
| `--cg-warn` | `#fbbf24` | `#a16207` | stale index, binary absent |
| `--cg-off` | `--text-muted` | `--text-muted` | rung 5, absent index |

Geometry/layout tokens are the existing ones: `--bg-primary` page, `--bg-secondary`
footer + notice band, `--bg-tertiary` code/input, `--border-subtle` section
dividers, `--border-primary` header rule.

### Pill accent ramp (surfaces 2–3)

The shipped `SlotPill` hardcodes Tailwind `*-400` literals (`text-cyan-400`,
`bg-cyan-500/10`), which are dark-only-legible — the same defect flagged for
`KbSettingsPanel`. The rows bind a theme-aware ramp instead:

| Accent | Dark | Light |
|---|---|---|
| blue | `#60a5fa` | `#1d4ed8` |
| indigo | `#a5b4fc` | `#4338ca` |
| cyan | `#22d3ee` | `#0e7490` |
| **teal** | `#2dd4bf` | `#0f766e` |
| purple | `#c084fc` | `#7e22ce` |
| red | `#f87171` | `#b91c1c` |

Glyph chip fill is `color-mix(in srgb, <accent> 12%, transparent)`. The pill's
`--border-subtle` boundary stays below 3:1, matching the shipped component — the
1.4.11 boundary requirement is carried by the glyph (`mdiGraphOutline` at
4.4–8.9:1), which is what actually identifies the control.

## Layout → content map

**Surfaces 1–3 (folder-scoped):**

| Region | Content | Source |
|---|---|---|
| Header | back affordance + `{repo} · Code Graph` | mirror kb `Shell` |
| Status strip | binary pill, freshness pill, `N symbols · M files`, version on the right | `codegraph status --json` |
| Binary outcome line | LED + resolved path (or "not found") + `Manage in Settings →` | **ladder moved to surface 4** |
| Index section | freshness detail (last built / pending files / symbols / files / languages) + actions | design D2, D8 |
| — when binary absent — | index section **replaced** by a blocker + `Install CodeGraph in Settings` | this review |
| Guidance row | the two tools and which question each answers — no routing classifier | design D4 |
| Footer | primary action per state + a settled status word | mirror kb footer |

**Surface 4 (host-global) — `/settings/plugins/codegraph`:**

| Region | Content |
|---|---|
| Settings chrome | back affordance + `Settings` + the grouped left nav (`Plugins` expanded, `codegraph` active with a health dot) |
| Plugin chrome | `PluginSettingsPage` card: title, plugin id, enable toggle, status/version/server/client |
| Binary resolution | the 5-rung ladder, active rung marked, resolved path, version |
| Scope note | "one binary per host — every folder resolves to this same path" |
| Actions | Install / Reinstall · Re-probe |

## State matrix — two axes

**Host-binary axis** (surface 4; also drives the rows' `not-installed`):

| Binary | Ladder | Primary action | Surface 4 shows |
|---|---|---|---|
| **present** | rungs 1–4, active rung marked | **Re-probe** | resolved path + version |
| **absent** | rung 5 | **Install CodeGraph** | install hint + built-in-tools sentence |

**Folder-index axis** (surfaces 1–3; only rendered while the binary is present):

| State | Index | Primary action | Strip |
|---|---|---|---|
| **fresh** | fresh, 0 pending | Force reindex | `fresh` |
| **stale** | pending > 0 | **Sync now** | `stale` |
| **not-indexed** | no `.codegraph/` | **Initialize** | `not indexed` |
| **building** | init job running | disabled + progress | `building` |

With the binary **absent** every folder state collapses to one presentation (the
blocker + deep link), so the panel has 4 × 2 = 8 presentations — not 6 mutually
exclusive states.

## Interaction rules encoded

- The install action is rendered only on **surface 4** (it is a host mutation),
  driving the rung-4 install then re-probing presence (design D9, relocated by
  this review). Never a dead end — the built-in-tools fallback sentence sits
  beside it, and the folder dialog links there instead of owning the action.
- `Initialize` is a **background job** with progress, never a blocking spinner
  (design D2 risk mitigation).
- `Sync now` (incremental) and `Reindex` (force) are separate verbs, labeled
  distinctly — same discipline as kb's `Save` vs `Save + Reindex`.
- Freshness is per-worktree and stated in words, not a spinner.
- Telemetry-off is stated in the install hint (design D7).

## Verification (measured)

**Panel, surfaces 1 —** 12 pairs × 2 themes, all PASS (`node /tmp/final-contrast.mjs`):

| Pair | dark | light | min |
|---|---|---|---|
| accent text on accent fill | 9.22 | 8.81 | 4.5 |
| accent text on page | 9.93 | 9.93 | 4.5 |
| ok pill text | 11.36 | 5.02 | 4.5 |
| warn pill text | 11.86 | 4.92 | 4.5 |
| body text | 9.13 | 9.74 | 4.5 |
| inactive rung text | 5.01 | 6.39 | 4.5 |
| settled word on footer | 4.66 | 6.12 | 4.5 |
| code on `--bg-tertiary` | 13.23 | 15.27 | 4.5 |
| tool name on `--bg-secondary` | 9.24 | 9.52 | 4.5 |
| accent border (non-text) | 4.43 | 6.29 | 3.0 |
| ok pill border (non-text) | 5.86 | 5.02 | 3.0 |
| warn pill border (non-text) | 6.14 | 4.92 | 3.0 |

**Rows, surfaces 2–3 —** 16 pairs × 2 themes, all PASS (`node /tmp/pill-contrast.mjs`).
Every accent clears 4.5:1 as **text** on both `--bg-primary` (flat pill) and
`--bg-secondary` (raised pill), and its 12% chip clears 3:1 as **non-text**:

| Accent | text flat / raised (dark) | text flat / raised (light) |
|---|---|---|
| blue | 7.79 / 7.25 | 6.70 / 6.42 |
| indigo | 9.93 / 9.24 | 7.90 / 7.57 |
| cyan | 10.96 / 10.19 | 5.36 / 5.13 |
| **teal** | **10.64 / 9.90** | **5.47 / 5.24** |
| purple | 7.49 / 6.97 | 6.98 / 6.69 |
| red | 7.16 / 6.66 | 6.47 / 6.20 |
| `⚠ stale` marker | 11.86 / 11.04 | 4.92 / 4.72 |
| `.sub` + sync glyph | 5.01 / 4.66 | 6.39 / 6.12 |

Failures found and fixed during the loop (panel): `--text-muted` on informational
text (inactive rungs, settled word, muted pills) was 2.78:1 dark / 3.45:1 light →
moved to `--text-tertiary`; the translucent accent border was 2.26:1 / 2.29:1
(non-text floor is 3:1) → solid `#6366f1` dark / `#4f46e5` light; pill borders
at 45% alpha → 70% dark, solid light.

- [x] 390 / 768 / 1440 × **4 surfaces × 4 folder states × 2 binary states = 96** combinations: `documentElement.scrollWidth === clientWidth`, no frame overflow.
- [x] **Scope split verified structurally:** the folder dialog contains no `.ladder` and no rung text with the binary present; with the binary absent the index section is gone and the blocker + deep link (`/settings/plugins/codegraph`) are present; surface 4 renders the ladder and the resolved path.
- [x] Surface 4 chrome: 5 nav groups / 18 items, `Code Graph` active under `Plugins` with a health dot, plugin chrome card, `.setcontent` scroller.
- [x] **Dialog container, not a page:** panel measures 95.0% × 92.0% of the stage at 768 and 1440 (the real `max-w-[95vw] max-h-[92vh]`), and the `mx-4` floor engages at 390 (90.8%, 316px) — no overflow at any width. Scrim present; underlay `aria-hidden`; claim scrolls internally.
- [x] Class-name collision caught in the loop: `.stage` already existed in this sheet (`padding:14px`), and same-specificity-later-wins silently stole the box — every ratio read 87.7%/90.6% until the new class was renamed `.dlgstage`.
- [x] Dark + light render; 0 page errors, 0 console output.
- [x] Every badge/row state label is a word, not a bare color.
- [x] Panel tab order: back → binary status line → index actions → guidance → footer; surface 4: back → nav → plugin chrome → ladder → actions.
- [x] Accent collision check: `teal` is the only free slot; `red` is reserved.
- [x] Card row keeps the button *outside* the pill's `role="button"` root.

**Known intentional truncation:** the active rung's binary path ellipsizes on
narrow viewports (`text-overflow:ellipsis`, shrinks only when space runs out —
full at 1440). The complete path is rendered in the `resolved:` line directly
below the ladder, so no information is reachable-only-by-hover.
