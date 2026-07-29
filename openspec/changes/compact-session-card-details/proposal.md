# Compact session-card details

## Why

The sidebar may contain many active sessions. `SessionCard` currently renders its
detail subcards inline, so OpenSpec workflow details consume the same vertical
space for every card even when the operator is only scanning titles, status, and
cost. The card needs a compact default that preserves operational awareness and
reveals secondary details only on demand.

## What Changes

- Add a client-side compact/expanded details toggle to each desktop `SessionCard`.
- Keep the compact card's identity and live operational signals visible: title,
  status/source indicator, model, relative time, cost/context summaries, and
  `OpenSpecActivityBadge` when present.
- Hide the detail-only session subcards behind an accessible toggle in compact
  mode, including the detailed OpenSpec actions/pipeline surface.
- Default cards to compact; expansion is per-card UI state for the current
  browser session and does not change the session's agent state.
- Do not hide error, approval, unread, or active-process signals that require
  the operator's attention.

## Non-goals

- No server, bridge, shared-protocol, or persistence change.
- No change to OpenSpec workflow semantics, attached proposals, or action
  availability.
- No redesign of the mobile session-card layout.

## Affected areas

- `packages/client/src/components/session/SessionCard.tsx`
- `packages/client/src/components/__tests__/SessionCard.test.tsx`
- `openspec/specs/session-card-subcards/spec.md`
