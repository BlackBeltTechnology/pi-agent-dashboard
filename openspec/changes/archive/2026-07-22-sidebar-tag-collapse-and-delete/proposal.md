## Why

The sidebar `YOUR TAGS` filter group renders every user tag as an always-visible, wrapping chip row. As tag count grows the group eats vertical sidebar height, and there is no way to delete a tag that is no longer wanted without opening each carrying session's editor one by one. Users need to (a) tuck the tag/phase groups away and cap chip overflow, and (b) delete a tag from every session in one action.

## What Changes

- Make the **entire sidebar tag area collapsible as one unit** — a single master `Tags` header with a chevron folds/unfolds both the `YOUR TAGS` and `PHASE (READ-ONLY)` groups together. **Default state is collapsed**; the collapsed header shows a total count (`N tags · M phases`) so tags stay discoverable without unfolding. Fold state persists across reload (localStorage).
- Add **overflow capping** inside each expanded group — show the first N (=10) chips, then a `+M more` control that expands the remaining chips inline.
- Add a **destructive per-tag remove control (✕)** to user chips in the `YOUR TAGS` group only. Activating it prompts a confirm dialog (`Remove #tag from N sessions?`) and, on confirm, strips that tag from **every** session that carries it. Phase chips stay read-only (no ✕).
- Add a new **bulk protocol verb `remove_tag_globally { tag }`** — the server performs the fan-out (strip the tag from every carrying session, one broadcast per changed session) rather than the client sending N individual `set_session_tags` messages. This is a **best-effort** fan-out over the existing per-session debounced-save path, not a single transaction (see design D5 / Risks). The delete is **global across all folders/projects** (the registry is not folder-scoped) — intended, and the confirm dialog states the cross-folder blast radius.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `session-tags`: add requirements for (1) a single master-collapse over the whole sidebar tag area (both groups together), default-collapsed, with a discoverable count on the collapsed header and persisted fold state, (2) overflow cap + `+M more` expander within a group, (3) a destructive global tag-delete affordance on user filter chips gated by a confirm dialog, and (4) a `remove_tag_globally` browser→server verb that fans the removal out to every carrying session.

## Discipline Skills

- `observability-instrumentation` — new `remove_tag_globally` browser→server verb (new external-facing message path).
- `doubt-driven-review` — destructive, non-undoable multi-session write before it stands.
- `review-code` — non-trivial client + server + protocol change before commit.

## Impact

- **Protocol** (`packages/shared/src/browser-protocol.ts`): new `remove_tag_globally` message type.
- **Server**: new handler in `packages/server/src/browser-handlers/session-meta-handler.ts` that iterates sessions, strips the tag via the existing normalize+update+broadcast path; **must be wired into the `browser-gateway.ts` message switch** — an unwired type falls through `default:` to `handlePiGatewayForward` (silently forwarded to a pi bridge), so the switch case is load-bearing.
- **Client**:
  - `packages/client/src/components/tags/TagChip.tsx` — `filter` variant gains an optional remove control (sibling to the toggle, not nested).
  - `packages/client/src/components/tags/TagFilterGroup.tsx` — collapsible header (chevron), overflow cap + `+M more`, optional per-chip remove wiring.
  - `packages/client/src/components/session/SessionList.tsx` — persisted fold state (localStorage), confirm dialog, dispatch of `remove_tag_globally`.
  - `packages/client/src/hooks/useSessionActions.ts` — `removeTagGlobally(tag)` sender.
- **No data migration** — tags remain a derived union of per-session sidecar fields; deleting is just editing every carrying session.
