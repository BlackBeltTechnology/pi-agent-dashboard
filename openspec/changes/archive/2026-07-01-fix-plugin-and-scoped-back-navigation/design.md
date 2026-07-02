## Context

The global back action is `goBack` (`App.tsx`) → `goBackAction` (`packages/client/src/lib/history-back.ts`). It is correct: it consults a depth-tagged in-app nav stack (`nav-tracker.ts`) and, failing a proven-shallower predecessor, navigates to `computeBackTarget(currentRoute)`. Depth and parent both come from `packages/client/src/lib/back-target.ts` (`parseRouteDepthInput` + `getMobileDepth` + `computeBackTarget`), which today is a **hardcoded allowlist** of folder sub-routes (`terminals`, `editor`, `settings`, `openspec`, `pi-resources`, `view`).

Two route classes escape it:

1. **Plugin `shell-overlay-route` routes.** The Automations plugin (`packages/automation-plugin/package.json`) declares `path: "/folder/:encodedCwd/automations"` and `path: "/automation/run/:sid"`. `<ShellOverlayRouteSlot>` renders them, but `back-target.ts` has never heard of them → all depth flags stay false → `getMobileDepth` returns 0 → `goBack` early-returns (`if (currentDepth === 0) return;`). **The back button is a dead no-op.**

2. **In-surface selection held in React state.** `FilePicker.tsx` fires `onClick={() => onSelect(c)}` — no `navigate`, no query param. The URL stays `/folder/:cwd/settings/instructions` across every file switch, so the nav stack records nothing and back can only act on the page route → ejects to `/`.

Reference case that works: global Settings. It is a modal route (`isModalRoute` true for first segment `settings`/`tunnel-setup`), every page switch is a `navigate()` push, so back walks pages then returns to the launcher.

## Goals / Non-Goals

**Goals:**
- Automations board + run-monitor back buttons work (board → cards, run → board).
- Directory Settings Instructions back walks file→file→page→launcher.
- Any future plugin `shell-overlay-route` route gets correct back **without** editing core `back-target.ts`.
- `goBack`, `history-back.ts`, `nav-tracker.ts`, `mobile-depth.ts` public contracts unchanged.

**Non-Goals:**
- No change to the swipe-back gesture, modal-route handling, or the nav-stack algorithm.
- No new persistence; `localStorage` editor-pane state is untouched.
- In-board dialog-ish state (`creating`, `editTarget`, `openResult`) stays React state — not made back-walkable (out of scope; they are modals, not navigation).
- No server/API changes.

## Decisions

### D1 — Route classification becomes a `RouteDescriptor` table (not a switch)
`parseRouteDepthInput`'s hardcoded chain is replaced by a resolver over an ordered `RouteDescriptor[]`:

```ts
interface RouteDescriptor {
  pattern: string;                       // wouter-style, e.g. "/folder/:cwd/automations"
  depth: 0 | 1 | 2;
  computeParent?: (params: Record<string,string>, url: string) => string; // default by depth
}
```

Resolution is **most-specific-first, first-match-wins** (longest static-segment prefix), mirroring `<ShellOverlayRouteSlot>`'s first-match semantics. `routeDepth(url)` returns the matched descriptor's depth (0 if none). `computeBackTarget(url)` returns `descriptor.computeParent?.(...)` or the depth default (`depth 1 → "/"`, `depth 2 → "/"` unless a parent is declared).

*Why over extending the switch:* the switch cannot see plugin routes at all; a table can be fed from two sources (static + registry) and keeps core-route behavior a pure data migration pinned by existing tests.

### D2 — Static core descriptors preserve today's behavior exactly
Every existing branch migrates 1:1 into a static descriptor (`/session/:id` d1, `/session/:id/diff` d2→`/session/:id`, `/folder/:cwd/settings/:page?` d1, `/folder/:cwd/openspec/*` d2, etc.). `back-target.test.ts` + `mobile-depth.test.ts` are the regression fence — they MUST pass unchanged before any plugin wiring.

### D3 — Plugin claims declare `depth` + optional `parentPath`
`shell-overlay-route` claim (and `ShellOverlayRouteClaim` type) gain optional top-level `depth?: 1 | 2` and `parentPath?: string`. The plugin registry emits one `RouteDescriptor` per claim; the classifier merges `static ∪ plugin` (plugin descriptors appended, resolved by the same specificity order). `parentPath` may contain `:params` filled from the current match (e.g. run-monitor `parentPath: "/folder/:encodedCwd/automations"`), enabling run → board.

*Why manifest-declared over inferred:* depth is a UX intent (is this a peer detail or an overlay-on-detail?) the shell cannot reliably infer from a path shape. Declaration keeps it with the plugin author.

### D4 — Missing `depth` defaults to 2 (overlay → cards), with a validator warning
Legacy manifests without `depth` resolve to depth 2 → back navigates to `/`. This degrades to "works, lands on cards" instead of today's dead no-op. `manifest-validator.ts` emits a non-fatal warning so authors add `depth`.

### D5 — File-picker selection is URL-encoded as `?file=<relPath>`
`FilePicker.onSelect(c)` → `navigate(/folder/:cwd/settings/instructions?file=${encodeURIComponent(c.relPath)})`. `InstructionsPage` derives `selectedPath` from the `?file=` query (URL = source of truth), matching the editor pane's `?file=` and the OpenSpec-artifact-tab precedent (`url-routing`). No `back-target.ts` change needed — the settings route is already depth 1; the fix is purely that selection now generates history entries.

### D6 — Two-phase rollout, one change
Phase 1 (hotfix): add the two automation routes as **static** descriptors + D5. Ships back today. Phase 2 (durable): D1+D3+D4 registry-fed table; delete the Phase-1 static automation entries once the manifest declares `depth`. Both phases share this spec so they cannot drift.

## Risks / Trade-offs

- **Descriptor ordering ambiguity** (a plugin path shadows a core path) → resolver is deterministic (specificity then registration order); add a dev-time duplicate-pattern warning. Core static descriptors are registered first.
- **Phase-1 static automation entries left behind after Phase 2** → Phase-2 tasks explicitly delete them; a test asserts automations depth resolves via the registry, not the static table.
- **`parentPath` param interpolation bugs** (wrong cwd on run→board) → unit-test run-monitor parent resolution with a real encoded cwd.
- **`?file=` with a stale/deleted file on refresh** → `InstructionsPage` falls back to the default selection when `?file=` matches no candidate (same as today's empty state).
- **Behavior drift during the table migration** → gated by existing `back-target`/`mobile-depth`/`history-back`/`back-regression` suites passing before plugin wiring lands.

## Migration Plan

1. Land D1+D2 (table refactor, static descriptors) — no behavior change; existing tests green.
2. Land Phase-1 static automation descriptors + D5 picker `?file=` — automations + file-explorer back fixed. Ship.
3. Land D3+D4 (claim `depth`/`parentPath`, registry→descriptor emit, validator warn); add `depth` to the automation manifest; remove Phase-1 static automation entries.
4. Rollback: revert per-step; each step is independently green (goBack contract never changes).

## Open Questions

- Should `depth`/`parentPath` be validated as **required** for new `shell-overlay-route` claims in a later major (currently SHOULD-warn, default 2)? Deferred — additive-safe now.
- Do we want in-board `selected` automation to be back-walkable via `?sel=` too, or is the run-monitor route sufficient? Current scope: run-monitor route only.
