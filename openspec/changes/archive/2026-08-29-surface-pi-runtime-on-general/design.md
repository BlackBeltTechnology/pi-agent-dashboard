# Design — surface-pi-runtime-on-general

## Context

`select-pi-runtime-install` shipped a two-consumer pi runtime picker and placed it on **Settings → Developer**, immediately above `<ToolsSection />`. Its **D12** records both halves of that reasoning:

> "the picker is the curated front door and Tools is the raw escape hatch; front door first. **Adjacency is the load-bearing half of that rationale** — it makes the 'same underlying `tool-overrides.json`' relationship legible, and splitting the two across pages would leave two places to edit one file with nothing on screen saying so. Discoverability on General was the other half and is deliberately traded away."

D12 also carries a correction: it originally said "Settings → General" and was amended mid-implementation when `ToolsSection` moved to Developer under `reorganize-settings-pages-and-descriptions`. The picker followed Tools. So General was the *original* home, given up for adjacency — not an oversight.

The user-facing complaint that opened this change: *"it's more elevated settings, not only for developers."* That is a claim about **classification**, not about reachability — the runtime is configuration, not build plumbing, and its current neighbours say otherwise.

## D1. Split the surfaces: read on General, write on Developer

**Decision:** leave `PiRuntimeSection` exactly where it is. Add a **read-only** status row on General that names the resolved runtime and links to the picker.

```
   General                                  Developer
   ══════════════════════════════           ══════════════════════════════
   PiVersionAdvisory  (conditional)         Section "Developer"
     └─ [ Change… ] ─────────────┐          DiagnosticsSection
                                 │          PiRuntimeSection    ◀── the ONLY writer
   PiRuntimeStatusRow (ALWAYS)   ├────────▶ ToolsSection       ◀── raw escape hatch
     Sessions spawn   0.6.2      │          SpawnFailuresSection
     Server imports   0.6.2      │          CanvasTypesSettingsSection
     [ Change… ] ────────────────┘
     (read-only — writes nothing)
```

**Why this preserves D12 rather than reversing it.** D12's load-bearing claim is about *writers*: two places to edit one file with nothing on screen saying so. A read-only summary is not a second writer. `tool-overrides.json` still has exactly one UI writer (the picker) plus its documented escape hatch (Tools), and those two remain adjacent. The half D12 traded away — discoverability — is bought back without paying the price D12 was avoiding. (Citation note: `settings-panel/spec.md`'s keeperLog requirement is headed "Capture pi session output toggle in General tab" and its placement scenario is equally stale — but its operative clause, "alongside the diagnostic tooling", is what the code and the page inventory satisfy on Developer. Fixing that requirement is out of scope for this change.)

**Alternatives rejected:**

- **Move `PiRuntimeSection` to General, leave Tools on Developer.** Directly breaks D12's load-bearing half: two pages editing one file, no on-screen relationship.
- **Move both `PiRuntimeSection` and `ToolsSection` to General.** Keeps adjacency but reverses `reorganize-settings-pages-and-descriptions`, which moved Tools *out* of General. It would also strand `keeperLog.capturePiOutput`, which `settings-panel/spec.md:755` requires to sit "alongside the diagnostic tooling (`DiagnosticsSection` / `ToolsSection` / `SpawnFailuresSection`)". Two recorded decisions overturned to satisfy one; the read-only split satisfies it with zero.

## D2. Data source: `/api/health` → `piRuntime`, not `/api/pi/installs`

**Decision:** the status row reads the existing `PiDivergenceHealth` shape already delivered by `/api/health`. `/api/health` is already polled client-side every 60s by `usePiCompatibility` — but that hook today keeps only `body.compatibility` and discards `piRuntime` (`usePiCompatibility.ts` — the set-state takes `body?.compatibility` alone), and the hook is **instance-scoped**: every mount creates its own fetch loop.

**The widening therefore comes with a wiring rule.** The hook is widened to retain `piRuntime` beside `compatibility`, and `SettingsPanel` invokes it **exactly once**, passing `piRuntime` down to the row and `compatibility` down to the advisory — whose internal hook call is removed. One fetch, one cadence, one poller per panel. A faithful-but-literal implementation that lets the row call the hook itself would put two live 60s pollers on General; that outcome is forbidden, and the row's unit tests assert the row fetches nothing (it renders purely from props).

| | `GET /api/health` → `piRuntime` | `GET /api/pi/installs` |
|---|---|---|
| already polled by the client | yes (`usePiCompatibility`) | no — new fetch |
| cost | none marginal | enumerates every discoverable install (filesystem walk) |
| auth | **unauthenticated by design** | `networkGuard` |
| spawn / module versions | yes | yes |
| consumer divergence + message | yes | yes |
| `pinned` (automatic vs pinned) | **no** | yes (`PiConsumerState.pinned`) |

**Consequence, stated rather than hidden: the General row cannot say "automatic" vs "pinned".** It shows versions and divergence only. Accepted — a summary that reads `0.6.2 / 0.6.2` and warns loudly when the two disagree does the elevated-setting job; *how* the runtime got selected is a property of the editing surface, which is one click away and already renders it.

**Alternative rejected — add `pinned: boolean` (×2) to `PiDivergenceHealth`.** `system-routes.ts:70-76` is explicit:

> "SECURITY: `/api/health` has NO `preHandler` guard — it is reachable unauthenticated. This shape therefore carries VERSIONS ONLY and never a filesystem path."

A boolean is not a path, so the rule is not broken in letter. But it newly discloses to any unauthenticated caller that the operator has overridden their runtime — a widening bought for a parenthetical label. Not worth it.

## D3. Alternative rejected — fetch `/api/pi/installs` from General

Full fidelity (including `pinned`), but it pays a filesystem enumeration on **every open of General** — the default settings landing page, and the one most users open for reasons unrelated to pi. The picker already pays that cost, on a page you only reach deliberately. Putting it on the front door inverts the cost/benefit.

## D4. Navigation: `requestRailNavigate` gains an optional scroll target

`requestRailNavigate` (`SettingsPanel.tsx:906`) is the rail helper the Save Bar page chips use. Its gating is narrow and deliberate: it prompts **only** when leaving a *plugin* page that has unsaved edits of its own (`pluginPageDirtyRef`); built-in draft state lives in the panel's `useState` and survives page switches by design (D5a of `reorganize-settings-pages-and-descriptions`). It routes to `/settings/<page>` and nothing finer. (Panel-level `isDirty` gating belongs to the separate `requestNavigate`, used for leaving Settings entirely — the two are not interchangeable.)

The `Change…` affordance needs navigate-then-scroll. The anchor already exists (`data-testid="pi-runtime-section"`, relied on by `tests/e2e/pi-runtime-picker.spec.ts`).

**Decision:** extend `requestRailNavigate` with an **optional** second argument naming a section to scroll into view after the page renders. Optional keeps every existing call site (including the Save Bar chips) byte-identical in behaviour — a regression there is silent and page-wide, which is why `review-code` is named in the proposal.

**Deferred-navigation round trip.** When the rail gate engages, `requestRailNavigate` does not navigate immediately: it stores the destination in `pendingNav` and navigates later, from the confirm dialog. The scroll target is carried through that round trip in its own **pending scroll-target ref** set alongside `setPendingNav` and consumed when the deferred navigation finally executes. A separate ref (rather than widening `pendingNav`'s `string` type) is deliberate: it leaves the `BACK_SENTINEL` string comparisons in the confirm handlers untouched. From General the gate cannot engage — `activePluginPageDirty` is only true while a plugin page is the active tab, and the row and advisory render on General — so this path is defensive; the ref mechanism keeps it cheap. The invariant the spec pins is *"same helper, same gating semantics as the chips"*, not "prompts when the panel is dirty"; a literal panel-dirty gate would be a behaviour change the change does not authorize.

**Not chosen:** a URL hash (`/settings/developer#pi-runtime`). It would become addressable surface — a shareable link this change has not specified, validated, or specced a fallback for when the section is absent. The scroll intent is transient; it should not enter the route contract.

## D5. The advisory keeps its job, and gains a fix link

`PiVersionAdvisory` stays conditional — it is an *alert*, and an alert that fires unconditionally is not one. It gains the same `Change…` affordance so the banner points at the remedy rather than only naming the fault. The always-visible job belongs to the new row. Mechanically, the advisory currently renders with zero props and calls `usePiCompatibility` internally; it instead consumes `compatibility` via a prop (the poll moved to the panel, D2) and gains an **optional** `onChangeRuntime` callback prop passed by the `SettingsPanel` call site. With `onChangeRuntime` absent the advisory renders exactly as today — the affordance is additive, and the component stays usable from call sites that cannot supply navigation.

## Risks

- **A second surface naming the runtime can drift from the picker.** → The row is strictly read-only and renders the server's own resolution; it never infers client-side. If the two ever disagree, the server is the bug.
- **Implementation drifts back toward the rejected forks.** The pinned label is a natural thing to "just add" while wiring the row. → D2 is the gate; `security-hardening` is named in the proposal for exactly this.
- **General accumulates another always-on element.** → Accepted; two lines, and the version advisory already claims that region conditionally.
- **Older server without `piRuntime` on `/api/health`.** → Row renders nothing, matching `PiVersionAdvisory`'s existing null-`compatibility` path. No error surfaces. Note the same null also occurs on a *current* server when `piRuntimeSnapshot()` throws (discovery failure) — the render-nothing path covers both; the row vanishing is itself a signal discovery is broken.
- **The row can briefly disagree with a picker change the user just made.** → Accepted trade-off: worst-case staleness is the 60s client poll plus the 30s server-side `piDivergenceCache` (~90s). The row is a status summary, not live state; the *editing* surface is never stale because `PiRuntimeSection` fetches `/api/pi/installs` fresh on mount. No invalidation machinery is added for this change.

**Rollback:** purely additive client code. Deleting `PiRuntimeStatusRow` and its one call site restores the previous behaviour exactly; nothing persists and no server contract changed.
