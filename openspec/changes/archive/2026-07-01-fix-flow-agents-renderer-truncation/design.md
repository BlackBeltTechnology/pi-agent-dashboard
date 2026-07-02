## Context

`FlowAgentsToolRenderer` (in `packages/flows-plugin/src/client`) renders the main-session `flow_agents` authoring card. It receives a `result` string prop from `ToolCallStep.tsx` and, for `op:"list"`, does:

```ts
try { if (result) parsed = JSON.parse(result); } catch { parsed = null; }
const catalog = Array.isArray(parsed) ? parsed : [];
// … names.length → "list · N agents"
```

`ToolCallStep` passes `result={displayResult}`, where `displayResult` is the LINE-TRUNCATED form of the raw result once it exceeds the display cap (200 lines) or when the server pre-truncates it on replay. Truncation prepends the marker `«N earlier lines hidden»\n` (see `event-reducer.ts` `TRUNCATION_MARKER_PREFIX = "«"`). `flow_agents op:"list"` returns `JSON.stringify(catalog, null, 2)` — ~18 lines per agent — so a real catalog trips the cap. `JSON.parse` of the marker string throws, `parsed` becomes `null`, and the card renders `0`. The model itself receives the full untruncated result (separate channel), which is why the tool "works" but the card lies.

`ToolCallStep` already threads a `toolDetails` prop into the plugin component (`<PluginComponent … toolDetails={toolDetails} />`). `toolDetails` is the tool's structured `details` object, which is NOT subject to the line-truncation applied to the text `result`.

## Goals / Non-Goals

**Goals:**
- The `flow_agents` list card never renders a false `0` when the result was truncated for display.
- When a non-truncated structured count is available (`toolDetails`), use it.
- Fix is client-only, contained in `packages/flows-plugin`, no protocol/server/pi-flows change required.

**Non-Goals:**
- Changing the `flow_agents` tool to emit `details.count/names` (that lives in the `pi-flows` repo; tracked separately). This change only makes the renderer *able* to consume such details if present.
- Exempting `flow_agents` results from truncation globally (a host-level change with broader blast radius).
- Any change to `FlowWriteToolRenderer`, the flow card grid, or the manifest claims.

## Decisions

**Decision 1 — Detect the truncation marker instead of silently parsing to `[]`.**
Guard the parse: if `result` matches `/^«\d+ earlier lines hidden»\n/`, treat it as "truncated, count unknown" rather than an empty catalog. Render a truncated-state label (e.g. "list · output truncated — expand") instead of "0 agents". Rationale: the marker is an unambiguous, existing sentinel (`event-reducer.ts`); matching it is cheaper and more honest than trusting a failed parse. Alternative considered: raise the truncation cap — rejected, host-wide side effects and still fragile for very large catalogs.

**Decision 2 — Prefer `toolDetails` for the count when present.**
Before parsing `result`, check `toolDetails` for a structured count/names (shape `{ count?: number, names?: string[] }` or a catalog array). If present, render from it. Rationale: `toolDetails` is not line-truncated, so it is the authoritative source; this also future-proofs the card for when `pi-flows` emits `details`. Alternative: parse-only — rejected, cannot recover the count once the text is truncated.

**Decision 3 — Fallback order.** `toolDetails` structured count → valid-JSON parse of `result` (unchanged happy path) → truncation-marker guard (truncated label) → last resort empty state only when the result genuinely is an empty array `[]`. This preserves existing behavior for small catalogs while eliminating the false zero.

**Decision 4 — Keep the change surgical.** Only `FlowAgentsToolRenderer.tsx` changes plus its test file. The marker regex is duplicated locally (small, stable) rather than importing `TRUNCATION_MARKER_PREFIX` across the package boundary, to avoid a new cross-package dependency for one sentinel.

## Risks / Trade-offs

- [Marker string drift] The host could change the truncation marker format → the guard would miss and revert to a failed parse. Mitigation: match the full `«\d+ earlier lines hidden»` header (not a bare `«`), and add a test asserting the exact current format so drift breaks the test loudly.
- [`toolDetails` shape unknown until pi-flows ships it] Reading a not-yet-emitted field is a no-op today. Mitigation: treat `toolDetails` as optional/duck-typed; the marker guard alone fixes the visible bug without it.
- [Truncated card shows no names] When truncated and no `toolDetails`, the card cannot list names. Accepted trade-off: an honest "truncated — expand" beats a false "0"; the full list is one expand away.

## Migration Plan

Client-only. In production mode: `npm run build` + `POST /api/restart`. In dev mode Vite hot-reloads. No data migration, no bridge reload. Rollback = revert the single component + test.

## Open Questions

- Should the truncated label also show a partial count parsed from the visible tail lines? Deferred — the tail is not guaranteed to be a parseable array fragment; "expand" is sufficient.
