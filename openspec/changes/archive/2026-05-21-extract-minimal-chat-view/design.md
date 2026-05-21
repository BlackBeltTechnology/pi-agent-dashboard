## Context

Today two plugin packages each ship their own copy of the same subagent-style timeline renderer:

- `packages/subagents-plugin/src/client/SubagentDetailView.tsx` — used by `AgentToolRenderer` (inline expand) and `SubagentPopoutPage` (`/session/:sid/subagent/:aid`).
- `packages/flows-plugin/src/client/FlowAgentDetail.tsx` — used by `FlowAgentCard` (eye-button popover) and, once `add-flow-agent-popout` lands, by `FlowAgentPopoutPage` (`/session/:sid/flow/:flowId/agent/:agentId`).

The two files are structurally identical:

```
              SubagentDetailView         FlowAgentDetail
              ──────────────────         ───────────────
ToolCallEntry          ✓ identical        ✓ identical
TextEntry              ✓ identical        ✓ identical
ThinkingEntry          ✓ identical        ✓ identical
ErrorEntry             ✓ identical        ✓ identical
extractInputPreview    ✓ identical        ✓ identical
status icon + color    ✓ data-driven      ✓ data-driven
header layout          ✓ identical        ✓ identical
```

Only the **input data shape** differs:

| field | `SubagentState` | `FlowAgentState` |
|---|---|---|
| status | `"created" \| "running" \| "completed" \| "failed"` | `"pending" \| "running" \| "complete" \| "error" \| "blocked"` |
| timeline | `entries?: SubagentTimelineEntry[]` | `detailHistory: FlowDetailEntry[]` |
| title | `displayName ?? type` | `label ?? agentName` |
| duration | `durationMs?: number` | `duration?: number` |
| model | `modelName?: string` | `model?: string` |
| tokens | `{ input, output, total }` | `{ input, output }` |
| extra | `agentMdPath?` (path under title) | — |
| entry kinds | `tool \| text \| thinking \| error` (each carries `ts: number`) | `tool \| text \| thinking \| error` (no `ts`) |

UI primitives (`MarkdownContent`, `formatTokens`, `formatDuration`) are already accessed through the UI primitive registry in both files — no new dep wiring needed.

The shared package `@blackbelt-technology/pi-dashboard-client-utils` is the natural home: both plugins already depend on it and import via subpath exports (`./AgentCardShell`, `./agent-card-utils`, `./extension-ui/...`).

## Goals / Non-Goals

**Goals:**

- Single source of truth for the subagent/agent timeline renderer.
- Both plugin call sites (`SubagentDetailView`, `FlowAgentDetail`) remain callable with their current public API so existing call sites (`AgentToolRenderer`, `SubagentPopoutPage`, `FlowAgentCard`, future `FlowAgentPopoutPage`) do not move.
- New external consumers (a future plugin showing a subagent-style timeline) get the renderer via one subpath import — no copy-paste path.
- No user-visible behavior change. Identical rendering pre/post extraction.
- Status icon + color choices live in one place; adding a status (e.g. `stopped`) is a one-file change.

**Non-Goals:**

- Not changing any wire/protocol type. `SubagentTimelineEntry`, `FlowDetailEntry`, `SubagentState`, `FlowAgentState` stay where they live.
- Not redesigning the visual treatment of the timeline. Pixel-identical output.
- Not exposing `MinimalChatView` as a plugin slot. It is a regular React component, imported by plugin packages.
- Not collapsing the wrapper components (`SubagentDetailView`, `FlowAgentDetail`) into nothing — they survive as thin adapter shims. (See Decision 4.)
- Not handling popout chrome or routing. Those belong to `add-subagent-inspector` / `add-flow-agent-popout`. `MinimalChatView` renders the **inner** view only.
- Not touching `BackgroundSubagentsPanel` or any non-detail surface. `mode: "row"` is preserved for parity but is out of the active call graph today.

## Decisions

### Decision 1 — Home: `packages/client-utils/src/minimal-chat/`

**Choice:** Place the new component in `packages/client-utils/src/minimal-chat/` with a new subpath export `./minimal-chat`.

**Why:**

- Both plugin packages already depend on `@blackbelt-technology/pi-dashboard-client-utils`.
- The existing package layout uses subpath exports per component (`./AgentCardShell`, `./Popover`, etc.). One more subpath fits the established pattern.
- Alternatives:
  - `packages/dashboard-plugin-runtime/` — would force all consumers to depend on the runtime even when they only want a leaf component. Rejected.
  - A new `packages/minimal-chat-view/` workspace package — overkill for a single component; adds version-coordination overhead for no benefit. Rejected.

### Decision 2 — Status normalization via shared union

**Choice:** Define a `MinimalChatStatus` union that is the **superset** of meaningful states both call sites use, plus the shims map their plugin-specific enums into it:

```ts
type MinimalChatStatus =
  | "pending"    // not started
  | "running"    // actively executing
  | "complete"   // finished successfully
  | "error"      // finished with error
  | "blocked";   // waiting on an external dependency (flow only today)
```

Mapping tables:

| `SubagentState.status` | → `MinimalChatStatus` |
|---|---|
| `"created"` | `"pending"` |
| `"running"` | `"running"` |
| `"completed"` | `"complete"` |
| `"failed"` | `"error"` |

| `FlowAgentState.status` | → `MinimalChatStatus` |
|---|---|
| `"pending"` | `"pending"` |
| `"running"` | `"running"` |
| `"complete"` | `"complete"` |
| `"error"` | `"error"` |
| `"blocked"` | `"blocked"` |

**Why not just pass the source enum through and let `MinimalChatView` switch on string?**

The status drives the icon + color, and pinning the union forces both producers to converge on the same vocabulary. Adding a new status to one producer without updating the other surfaces as a type error, not a silent fallback to `"unknown"`.

**Alternatives considered:**

- Polymorphic `status: string` with optional `statusIcon` / `statusColor` overrides — flexible but loses the centralization the change is trying to buy.
- Reuse `FlowAgentStatus` directly — `pending` is a flow-ism; using it as the canonical token has the right semantics, but importing the type from `pi-dashboard-shared` into `client-utils` would create a dep cycle in the wrong direction (`client-utils` is leaf-most). Define a fresh union in `client-utils` and convert at the shim boundary.

### Decision 3 — Entry shape: structural, not nominal

**Choice:** `MinimalChatView` takes `entries: MinimalChatEntry[]` where:

```ts
type MinimalChatEntry =
  | { kind: "tool"; toolName: string; input: unknown; output?: unknown; isError?: boolean }
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "error"; text: string };
```

This is structurally identical to `FlowDetailEntry`; it drops the `ts: number` field that `SubagentTimelineEntry` carries (the renderer does not use it today).

**Why:**

- Shape is identical across both producers ignoring `ts`. The renderer has no use for `ts` today; if a future feature needs it, add `ts?: number` as optional rather than complicate the contract now.
- `isError` is required on the flow type and optional on the subagent type. Treating it as optional in the shared shape (`isError?: boolean`, default `false`) loses nothing — the renderer already checks for truthiness.

**The shim's job:** map `SubagentTimelineEntry[]` and `FlowDetailEntry[]` to `MinimalChatEntry[]`. Both maps are trivial:

```ts
// subagent shim
const entries: MinimalChatEntry[] = (sub.entries ?? []).map(e =>
  e.kind === "tool"
    ? { kind: "tool", toolName: e.toolName, input: e.input, output: e.output, isError: e.isError }
    : { kind: e.kind, text: e.text }
);

// flow shim
const entries: MinimalChatEntry[] = agent.detailHistory.map(e =>
  e.kind === "tool"
    ? { kind: "tool", toolName: e.toolName, input: e.input, output: e.output, isError: e.isError }
    : { kind: e.kind, text: e.text }
);
```

### Decision 4 — Keep `SubagentDetailView` and `FlowAgentDetail` as shims

**Choice:** Both wrapper components remain as thin shim functions that:

1. Map plugin-specific state (`SubagentState` / `FlowAgentState`) → `MinimalChatView` props.
2. Forward props (`mode`, `onBack`).
3. Re-export.

**Why:**

- Zero call-site churn. `AgentToolRenderer`, `SubagentPopoutPage`, `FlowAgentCard`, and tests keep importing the same names from the same packages.
- The shim encodes the *adapter* knowledge (status enum mapping, title selection, tokens shape) so `MinimalChatView` can stay pure UI.
- Future popout pages (`FlowAgentPopoutPage` from `add-flow-agent-popout`) compose the existing wrapper, not `MinimalChatView` directly — keeps the popout-plugin boundary stable.

**Alternative rejected:** delete the wrappers and have every call site import `MinimalChatView` directly + do the adapter conversion at the call site. Spreads the same adapter logic across N call sites; loses the single mapping point; bigger diff for no gain.

### Decision 5 — Component API surface

```ts
// packages/client-utils/src/minimal-chat/MinimalChatView.tsx

export type MinimalChatMode = "inline" | "popout" | "row";

export type MinimalChatStatus =
  | "pending" | "running" | "complete" | "error" | "blocked";

export type MinimalChatEntry =
  | { kind: "tool"; toolName: string; input: unknown; output?: unknown; isError?: boolean }
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "error"; text: string };

export interface MinimalChatViewProps {
  /** Header title (e.g. agent name, "code-reviewer"). */
  title: string;
  /** Optional read-only path / sub-title under the title (e.g. agentMdPath). */
  subtitle?: string;
  status: MinimalChatStatus;
  entries: MinimalChatEntry[];
  /** Optional header-right meta (renders only when present and complete). */
  meta?: {
    modelName?: string;
    tokens?: { input?: number; output?: number };
    durationMs?: number;
  };
  /** Default: "inline". */
  mode?: MinimalChatMode;
  /** Back button handler (renders the chevron-left when set). */
  onBack?: () => void;
  /** Optional empty-state message override; default is mode-aware. */
  emptyMessage?: string;
  /** Optional footer (e.g. flow's "Summary" markdown block). */
  footer?: React.ReactNode;
}
```

`row` mode skips the body entirely and renders a single line (status + title + first `text` excerpt or activity). The wrappers pass an activity string in via `subtitle` for row mode.

`popout` mode is `flex h-full overflow-hidden` (fills its parent). `inline` mode caps body height at `max-h-[60vh] overflow-hidden`.

### Decision 6 — UI primitives via the existing registry

`MarkdownContent`, `formatTokens`, `formatDuration` come from `useUiPrimitive(UI_PRIMITIVE_KEYS.*)`. No new dependencies on shell components, no direct imports from `client-utils/src/agent-card-utils.ts` (still legal, but the primitive registry path is the canonical one and is already what `FlowAgentDetail` uses today). This keeps `MinimalChatView` testable with a `withUiPrimitiveProvider` wrapper, mirroring the existing flow-plugin tests.

### Decision 7 — Test surface

Three test files:

1. `packages/client-utils/src/minimal-chat/__tests__/MinimalChatView.test.tsx` — new. Each entry kind renders. Status → icon/color mapping. Three modes. Empty state. Optional header bits absent when meta omitted. Subtitle (path) renders when set. Footer renders when passed.

2. `packages/subagents-plugin/src/client/__tests__/SubagentDetailView.test.tsx` — **kept**. The existing assertions about external behavior (renders agent name, shows path under title, renders tool entries, etc.) must keep passing post-shim. Adjust internal-detail assertions only if they break on the new mount point.

3. `packages/flows-plugin/src/__tests__/` — add `FlowAgentDetail.test.tsx` if it doesn't already exist (verify by listing). Same external-behavior assertions: header renders, tool entries render, summary footer renders.

No snapshot tests. The renderer is small enough that explicit DOM assertions are clearer.

### Decision 8 — No barrel re-export from `MinimalChatView` into shims

The shims import directly from the new subpath:

```ts
import { MinimalChatView } from "@blackbelt-technology/pi-dashboard-client-utils/minimal-chat";
```

Not from a top-level re-export. The package already uses per-component subpath exports; we extend the pattern, not break it.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Status enum drift — a producer adds a status (e.g. `subagent-aborted`) and the shim's `switch` silently maps it to a default. | Use exhaustive `switch` with a `never` default at type level (TS will error if a new branch isn't handled). |
| `FlowDetailEntry` and `SubagentTimelineEntry` diverge in the future (e.g. one adds a field the renderer cares about). | The renderer only consumes the union it owns (`MinimalChatEntry`). Producer fields beyond that are dropped at the shim boundary. Adding a renderer-visible field is then a deliberate cross-plugin change to `MinimalChatEntry`, not an accidental leak. |
| Test churn in subagents-plugin / flows-plugin from mount-point changes. | Both packages already use `withUiPrimitiveProvider`; the shim swap is component-internal and shouldn't move test scaffolding. Re-run both suites before merging. |
| `MarkdownContent` resolved via primitive registry — if the registry isn't populated (e.g. in a fresh test setup), tests fail with a null-component error. | Use `withUiPrimitiveProvider` (existing helper) in `MinimalChatView` tests. Document this in the test file header. |
| Visual diff regressions from line-by-line reimplementation. | The new component is a literal port of the existing render trees; both wrappers already render identical JSX. CI must include the existing snapshot-free assertions in subagents-plugin's `SubagentDetailView.test.tsx`. |
| `pending` is a flow-ism; mapping `SubagentState.status: "created"` to `"pending"` may look odd at first glance to a subagent-producer maintainer. | Documented at the shim's mapping table (Decision 2). `pending` is the most natural shared token for "not-yet-running" across both producers. |

## Migration Plan

This is an internal refactor with no protocol surface. Migration is mechanical:

1. Add the new module + subpath export under `client-utils`.
2. Add `MinimalChatView` tests in `client-utils`.
3. Convert `SubagentDetailView.tsx` to a shim (delete inline entry renderers, status helpers, header).
4. Convert `FlowAgentDetail.tsx` to a shim (delete inline entry renderers, status helpers, header).
5. Re-run all three test suites; resolve any test-helper drift.
6. Update file-index rows for both plugins to point at the shim purpose and reference `MinimalChatView`.

No deprecations, no flags, no staged rollout. Ship in one PR.

**Rollback:** revert the single PR; both shims expand back to inline copies of `MinimalChatView`'s body. No data, persisted state, or wire types are affected.

## Open Questions

- Should `SubagentDetailView`'s Tier-1/Tier-3/Tier-4 fallback tree (entries-present / completed-no-entries / placeholder) live in the shim, in `MinimalChatView`, or in a thin `MinimalChatView` consumer wrapper? **Tentative answer:** keep the tier branch inside the shim — `MinimalChatView` should not know about subagent-specific replay semantics. The shim picks `entries` vs a synthesized one-line "result" string vs a placeholder before calling the view. Confirm during implementation.

- Activity string (e.g. "reading src/foo.ts") — `SubagentState.activity` and per-agent live activity in flow state. Today `SubagentDetailView`'s row mode shows it; the header in inline/popout does not. Should `MinimalChatViewProps` carry `activity?: string` separate from `subtitle`? **Tentative answer:** yes — add an optional `activity?: string` that the renderer shows under the title in `inline`/`popout` only when status is `running`. Keeps `subtitle` semantically for stable info (path, role). Confirm during task breakdown.

- `BackgroundSubagentsPanel` — `mode: "row"` is implemented in the existing `SubagentDetailView` for a panel that is not currently mounted. Worth keeping the row branch alive in `MinimalChatView` for future use, or strip and re-add later if needed? **Tentative answer:** keep it. Cheap. The shim already exposes the prop.
