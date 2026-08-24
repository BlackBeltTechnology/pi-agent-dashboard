# Test Plan — fix-flush-dialog-scroll-and-close-collision

Stage: design   Generated: 2026-08-23

Resolved at the gate (were unfillable slots):

- **ε = 4 px** for the reachability comparison. Measured floor: the two working
  plugin routes report 2 px; the smallest real defect was 56 px. 4 px clears the
  noise without approaching a real clip.
- **Viewport matrix**: `1440×900` (reference), `1280×800` (laptop), `1024×640`
  (short desktop — just above the 600 px mobile cutoff, the boundary where
  `max-h-[92vh]` least resembles the recorded evidence), `390×844` (mobile
  shell). All prior evidence exists at 1440×900 ONLY.
- **Initial-focus observable**: `document.activeElement` is inside the dialog
  panel and is NOT the panel container itself (the empty-trap fallback).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | dialog-system · Flush establishes a flex column | decision-table | L1 | automated | `<Dialog flush>` | render | panel class contains `flex`, `flex-col`, `min-h-0`, `overflow-hidden`; NOT `p-5`, NOT `overflow-y-auto` |
| E2 | dialog-system · Non-flush keeps padding + scroll | decision-table | L1 | automated | `<Dialog>` (no flush) | render | panel class byte-identical to today: contains `p-5`, `overflow-y-auto`; contains NO flex token |
| E3 | dialog-primitive · Dismissal | decision-table | L1 | automated | the 4 combinations of `flush` × `showClose` | render | ✕ present for `!flush` (both showClose values) and for `flush+showClose`; ABSENT for `flush` alone. All four asserted, not three |
| E4 | dialog-system · size cap unchanged | BVA | L1 | automated | each of `sm`/`md`/`lg`/`full`, flush and non-flush | render | height-cap class is `max-h-[80vh]` for sm/md/lg and `max-h-[92vh]` for full, IDENTICAL in both flush modes — D1 must not couple cap to flush |
| E5 | dialog-system · Tall flush content scrolls rather than clipping | BVA (just-above-max) | L3 | automated | flush surface whose content is cap + 500 px | overlay displayed at 1440×900 | panel `scrollHeight - clientHeight <= 4`; AND ≥1 descendant has `scrollHeight > clientHeight + 4` and is scrollable |
| E6 | dialog-system · Short flush content still shrinks to fit | BVA (just-below-min) | L3 | automated | flush surface whose content is ~40 px | overlay displayed | panel `getBoundingClientRect().height` < 0.92 × viewport height — i.e. it did NOT expand to the cap |
| E7 | dialog-system · flush at the cap boundary | BVA (at-max) | L3 | automated | flush content exactly equal to the cap (±2 px) | overlay displayed | panel clamps at cap; no scroller is required to appear (content fits); `scrollHeight - clientHeight <= 4` |
| E8 | shell-overlay-route · reachability covers every route | EP (route partition) | L3 | automated | the route table DERIVED from the router, not from the 6 mount sites (≥9 URLs incl. `PiResourceFileRoute`, `/folder/:cwd/view`, URL-preview) | each route opened | every route passes E5's bounded-or-scrollable assertion; a route present in the router but absent from the table FAILS the table-completeness check |
| E9 | dialog-primitive · Escape over a stacked overlay | state-transition (illegal edge) | L1 | automated | flush dialog open, second dismissible layer registered above it | `Escape` | dialog's `onClose` NOT called; the stacked layer consumes it. Guards the scenario the delta nearly deleted |
| E10 | dialog-primitive · Open state is controlled by the parent | state-transition | L1 | automated | flush dialog, `onClose` a no-op spy | any dismissal source fires | dialog remains mounted; it does not self-close |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | design D5 · plugin pin retained | state-convergence | L3 | automated | `/folder/<cwd>/automations` and `/folder/<cwd>/goals` — claim bodies are `absolute inset-0`, zero intrinsic height | overlay displayed after D1 lands | panel height ≥ 0.5 × viewport height AND claim content is non-empty. **Highest-severity regression in this change**: an auto-height panel collapses these to 0 |
| F2 | design D5 · KB folder slot | state-convergence | L3 | automated | the KB folder slot route (the surface `kb-folder-slot.spec.ts` already guards) | overlay displayed | existing `kb-folder-slot.spec.ts` stays green — it is the tripwire that originally caught the collapse |
| F3 | dialog-system · flush suppresses ✕ | state-transition | L3 | automated | each of the 9 flush surfaces | overlay displayed | zero elements matching the container's `-close` testid exist within the panel |
| F4 | dialog-system · dismissal remains VISIBLE | state-transition | L3 | automated | each of the 9 flush surfaces, incl. `OpenSpecArtifactDialog` after its `onBack` is added | overlay displayed | ≥1 visible, enabled interactive element inside the panel whose activation leaves the surface. Falsifies the cycle-1 defect (dialog with no visible close) |
| F5 | shell-overlay-route · no occlusion | geometry | L3 | automated | each route in E8's table | overlay displayed | no visible `button`/`a`/`input`/`select` bounding box intersects the EFFECTIVE close control's box (container ✕ where present, else the surface's own dismissal control) |
| F6 | design D3 · viewport independence | EP across the matrix | L3 | automated | `/settings/general` and `/folder/<cwd>/view?path=README.md` | opened at 1440×900, 1280×800, 1024×640 | E5's assertion holds at ALL three. 1024×640 is the boundary case: closest to the mobile cutoff, where the cap is smallest |
| F7 | design D3 · mobile shell shares the roots | state-transition | L3 | automated | `/settings/general` and `/tunnel-setup` at 390×844 (MobileShell path, NOT the overlay) | opened | header pinned, body scrolls internally, no page-level scroll, footer reachable. `SettingsPanel`/`ZrokInstallGuide` roots are edited globally, so an overlay-only fix that regresses mobile is not a fix |
| F8 | design D3 · deepest `h-full` in the chain | state-convergence | L3 | automated | the settings INSTRUCTIONS editor (`InstructionsPage.tsx:405`, `flex flex-col md:flex-row h-full min-h-0`) inside the flush dialog | opened via the instructions tab | E5's assertion holds. All recorded settings geometry came from the settings LIST page; this surface has never been measured |
| F9 | design D5 · `h-[70vh]` pin under growth | state-transition | L3 | automated | `AgentToolRenderer` popout with a transcript that grows after mount | entries stream in | panel height stays constant (±4 px) across growth — the pin's whole purpose; it must not become shrink-to-fit |
| F10 | design D4 · `DirectorySettings` non-overlay mounts | EP (mount-context partition) | L3 | automated | `DirectorySettings` in its three contexts: flush overlay, live chain, mobile | each rendered | header + content visible and internally scrollable in all three. Task 4.2 edits its root globally |
| F11 | dialog-system · focus on open | state-transition | L3 | automated | each of the 9 flush surfaces | overlay opens | `document.activeElement` is a descendant of the panel AND is not the panel element itself |
| F12 | design D1 · resize while open | state-transition (illegal edge) | L3 | automated | tall flush surface open at 1440×900 | viewport resized to 1024×640 without closing | panel re-clamps to the new cap; E5's assertion still holds; no content becomes unreachable |
| F13 | — | visual/subjective | — | manual-only | the six converted surfaces | human looks at spacing/alignment where the ✕ used to sit | [judgment: no visual hole or crowding where the removed ✕ was — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | design D4 · artifact dialog branches | EP (state partition) | L3 | automated | `OpenSpecArtifactDialog` in each of its 3 branches: loading (`isWaitingForReplay`), not-found (bad change name), loaded | dialog opened per branch | all three render a visible dismissal control and satisfy E5. The `onBack` addition touches all three; a fix applied to only the loaded branch is the likely error |
| X2 | shell-overlay-route · gate is not vacuous | fault-injection (mutation) | L3 | automated | the D1 flex tokens reverted in `Dialog.tsx` | gate re-run | E5/E8 FAIL on the 5 previously-broken routes. A gate green against the reverted primitive proves nothing |
| X3 | shell-overlay-route · content-rendered precedes geometry | fault-injection (empty state) | L3 | automated | a route seeded so its surface renders an error/empty state | gate run | gate FAILS on the content assertion, not silently PASSES on the geometry of an empty box |
| X4 | dialog-primitive · `showClose` for a zero-focusable child | fault-injection (degenerate child) | L1 | automated | `<Dialog flush>` whose child renders NO focusable element | render | with `showClose`: ✕ present and `activeElement` is the ✕. Without: `activeElement` falls back to the container — the documented plugin hazard the SHALL exists to prevent |
| X5 | design D2 · unsaved-edits guard survives | fault-injection (dirty state) | L3 | automated | `/settings/general` with a dirty draft | Escape, and separately backdrop click | discard prompt appears on both paths. Do NOT assert a back arrow on the Instructions page — it passes `onBack={isDesktop ? undefined : backToTree}` and renders none on desktop |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| — | — | — | — | — | none | This change adds no async path, no data volume and no new render loop; it alters static layout classes. No performance scenario is derivable from the deltas, and inventing a threshold would be the "adjective instead of a number" failure this plan already made once. | — |

---

## Coverage summary

- Requirements covered: 15/15 delta requirements + scenarios (dialog-system ×2,
  dialog-primitive ×2, shell-overlay-route ×1, plus design decisions D1–D5)
- Scenarios by class: edge 10 · frontend-quirk 13 · error-handling 5 · perf 0
- Scenarios by level: L1 7 · L2 0 · L3 20 · manual-only 1
- Scenarios by disposition: automated 27 · manual-only 1

**No L2 rows by design.** Every scenario here is either a pure class-contract
assertion (L1) or a rendered-UI geometry assertion (L3). `qa/` is CLI/process
smoke and the project's hard rule forbids rendered-UI assertions there.

## New infra needed

- **`tests/e2e/overlay-layout.spec.ts`** — new generic gate. Harness glue from
  `tests/e2e/route-backed-overlay.spec.ts` (viewport + route navigation);
  geometry-probe pattern from `tests/e2e/chat-transcript-virtualization.spec.ts`;
  mobile-viewport pattern from `tests/e2e/gateway-board-mobile.spec.ts`. Port is
  read from `.pi-test-harness.json#dashboardPort` via the fixtures' baseURL —
  never hardcode `:18000`.
- **A zero-focusable flush fixture** for X4 — `showClose` ships with no in-repo
  consumer (it exists for the public plugin API), so nothing today exercises it.
  Without a fixture that scenario is unwritable and the opt-in is untested.
- No new level or harness is required beyond these.
