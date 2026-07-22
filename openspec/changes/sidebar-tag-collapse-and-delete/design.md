## Context

The sidebar `YOUR TAGS` + `PHASE (READ-ONLY)` filter groups live in `SessionList.tsx`, rendered by the presentational `TagFilterGroup` over the shared `TagChip` primitive. The chip list is a **derived union** — `allTagsInUse(sessions)` flattens every session's `tags`. Tags are edited today only per-session via `TagEditor` (`set_session_tags { sessionId, tags }`); there is no bulk verb and no way to fold or delete from the sidebar. See the archived `session-tags` capability for the existing contract.

## Goals / Non-Goals

**Goals:**
- One master collapse over the entire tag area (both groups), **default collapsed**, with a discoverable count on the collapsed header, fold state persisted across reload.
- Overflow cap (10) + `+N more` inline expander inside `YOUR TAGS`.
- Destructive per-tag remove (✕) on user filter chips, gated by a confirm dialog, that strips the tag from every carrying session.
- A `remove_tag_globally { tag }` browser→server verb doing the fan-out server-side.

**Non-Goals:**
- Undo after a confirmed global delete (mitigated by the confirm dialog; possible follow-up).
- Editing phase chips — they remain read-only (spec already forbids it).
- Any change to per-session `TagEditor` add/remove, tag normalization, or the sidecar persistence path.
- A tag registry — tags stay a derived union; a deleted tag reappears if any session re-adds it.

## Decisions

**D1 — One master collapse, not per-group folds.** A single `Tags` header folds both groups together (user asked for the *whole* area). Inner groups become plain sub-labels (no nested chevrons) → less chrome, one control. *Alt considered:* per-group folds — rejected as more chrome for no stated benefit.

**D2 — Default collapsed, with a count signifier.** The collapsed header shows `N tags · M phases` so folded ≠ invisible (NN/g visibility of system status). *Alt:* default expanded — rejected; the request is explicitly default-collapsed and the sidebar is height-constrained.

**D3 — Fold state persisted in localStorage** (client-only UI preference, not session state). Key e.g. `sidebar.tagArea.open`; absent ⇒ collapsed. *Alt:* server-persisted preference — rejected as over-engineering for a per-browser view toggle.

**D4 — Overflow cap = 10 + `+N more`.** Borrow the *visual* of `TagStrip`'s `+N`, but note `TagStrip`'s `+N` is a read-only `<span>` (card, `max=3`) — the sidebar needs a **new interactive `<button>` expander** (toggles inline `show less`, no navigation). Not a drop-in reuse; only the chip-overflow look is shared. Cap chosen by the user.

**D5 — Global delete via a NEW `remove_tag_globally` verb (server fan-out), not client fan-out.** Server normalizes the inbound tag (`normalizeTags([tag])[0]`); if that yields `undefined` (blank/whitespace-only input, since `normalizeTags` returns `[]`) the handler is an early no-op. Otherwise it iterates sessions whose list contains it, strips it through the existing normalize→`sessionManager.update`→broadcast path, one `session_updated` per changed session. *Alt:* client loops `set_session_tags` ×N — rejected; server-side keeps it off the wire as N round trips (user's explicit choice). **Not atomic**: each `sessionManager.update` schedules an independent per-session debounced save (`meta-persistence`), so a crash mid-fan-out can leave some sessions stripped and others not — acceptable for a non-critical UI tag (see Risks). The verb is wired into the `browser-gateway.ts` switch; unwired, it falls through `default:`→`handlePiGatewayForward` and is misrouted to a bridge. It operates over `sessionManager.listAll()`, which is **not folder-scoped** — the delete is global across projects by design.

**D6 — Confirm dialog before delete.** Destructive, non-undoable, multi-session. Dialog states the blast radius (`Remove #tag from N sessions?`) and the honest derived-union caveat (reappears if re-added). Primary action styled destructive; Cancel is the safe default.

**D7 — The ✕ is a sibling control, not a nested button.** `TagChip` `filter` variant's body is today a *bare* toggle `<button>` (no wrapper); a nested `<button>` is invalid HTML. The fix wraps the toggle + ✕ in a `<span>` (new), re-homing the `selected` outline ring onto the wrapper, with the ✕ as a real sibling `<button>` carrying its own `aria-label` + focus ring. As a true sibling its click does NOT bubble to the toggle, so no `stopPropagation` is needed (it would be a no-op) — the earlier framing assumed nesting. The wrapper must stay a single flex-wrap unit so the ✕ never wraps to its own line. ✕ shows on user-tone filter chips only — never on phase (`exec`) chips.

**D8 — Active-filter indicator on the collapsed header.** Because the area is default-collapsed and `selectedTags`/`selectedPhases` persist independently of visibility, a folded area could hide an *active* filter (and its `Clear tags` control) with no signal — the user would see a filtered list with no visible cause. Decision: when any tag/phase filter is active, the collapsed master header shows an **active-selection indicator** (e.g. `2 active`) distinct from the available `N tags · M phases` count, and exposes a clear-filters affordance without unfolding. *Alt:* auto-expand when a filter is active — rejected as fighting the user's fold choice.

**D9 — Phases stay a distinct read-only sub-group under the master collapse.** The master control folds both groups but MUST NOT re-classify phases as tags: the `Phase (read-only)` sub-label + dashed read-only chips are preserved, and the existing "Execution phase chips are a read-only filter view" requirement is unchanged. The master header is a neutral filter-area collapse, not a claim that phases are tags.

## Risks / Trade-offs

- **Fan-out is not a transaction** → a crash mid-fan-out leaves a partial strip. Acceptable for a UI tag (no data integrity impact); re-issuing the delete is idempotent.
- **Last-write-wins race inside the fan-out** → a concurrent `set_session_tags` from another browser can re-add the tag to an already-processed session. Bounded, low-stakes, and indistinguishable from an intentional re-add; no lock introduced.
- **Global-across-folders blast radius** → intended (user chose "every session"); the confirm dialog states the cross-folder count so it is never silent.
- **First-deploy regression** → default-collapsed hides the previously always-visible tag filter for existing users on first load (one-time); mitigated by the header count + active-filter indicator (D8).
- **Per-session broadcast under frame-drop** → one `session_updated` per changed session; a dropped WS frame can leave a client stale until reconnect. A batched `tags_removed_globally` verb was considered and rejected to reuse the existing update path.
- **Confirm count is client-derived** (from the client session map) and may skew slightly vs the server's `listAll()` between dialog render and fan-out — cosmetic only.
- **Two tab stops per chip** (toggle + ✕) → with 10+ chips this lengthens sidebar keyboard nav; accepted for now (spec requires the ✕ independently reachable). Revisit with roving-tabindex if it becomes a burden.
- **Derived-union surprise** (deleted tag reappears when a session re-adds it) → the confirm copy states it explicitly; it is not a bug.
- **No undo on a destructive multi-session write** → confirm dialog is the guard; undo toast is a possible follow-up, out of scope here.
- **✕ target size** (~small in a dense sidebar, below WCAG 2.5.5 AAA 44px) → give the ✕ ≥24px hit-area padding and independent keyboard focus (WCAG 2.5.8 AA 24px). Captured as a build task.
- **Fan-out broadcast volume** (one `session_updated` per carrying session) → bounded by tag usage; acceptable, mirrors existing per-session update volume.
- **`stopPropagation` on ✕** must not swallow keyboard activation of the toggle → verified via the a11y task.

## Migration Plan

No data migration — tags remain per-session sidecar fields; deleting is editing every carrying session. Protocol addition is additive (new message type; old clients simply never send it). Rollout is a normal client build + server restart. Rollback = revert the change; no persisted schema touched.

## Open Questions

- None blocking. Undo-toast for global delete is deferred to a possible follow-up change.
