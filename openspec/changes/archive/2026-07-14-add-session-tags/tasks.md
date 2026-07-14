## 1. Shared types & color helper

- [x] 1.1 Add `tags?: string[]` to `SessionMeta` in `packages/shared/src/session-meta.ts` with a doc comment (user-owned; normalized; `See change: add-session-tags`).
- [x] 1.2 Add `tags?: string[]` to `DashboardSession` in `packages/shared/src/types.ts` (mirror of the sidecar field; bridges SHALL NOT send it).
- [x] 1.3 Add a `normalizeTags(input: string[]): string[]` helper in shared (trim, lowercase, drop empty, dedupe first-seen, truncate to `MAX_TAG_LEN`, cap to `MAX_TAGS`). Export `MAX_TAGS = 12` and `MAX_TAG_LEN = 32`.
- [x] 1.4 Add a `tagColor(tag: string)` pure helper + exported `TAG_PALETTE` (9 dark-tuned entries from `mockups/_tokens.css`) in shared. Hash = FNV-1a 32-bit (`0x811c9dc5` basis, `0x01000193` prime) over `new TextEncoder().encode(name)` UTF-8 bytes (NOT `charCodeAt` UTF-16 code units — they differ for non-ASCII like `café`), unsigned wraparound each step: `h = Math.imul(h ^ byte, 0x01000193) >>> 0`. `TAG_PALETTE[fnv1a32(tag) % TAG_PALETTE.length]`.
- [x] 1.5 Unit tests: `normalizeTags` (dupes/blanks/truncate/cap) and `tagColor` (assert exact palette index for an ASCII input AND a non-ASCII input like `café` — proves the TextEncoder byte source).

## 2. Protocol message

- [x] 2.1 Add `SetSessionTagsBrowserMessage { type: "set_session_tags"; sessionId: string; tags: string[] }` to `packages/shared/src/browser-protocol.ts` and include it in the browser message union.
- [x] 2.2 Ensure `session_updated` broadcast payload carries `tags` (it broadcasts `DashboardSession`, so 1.2 covers the shape — verify no field allowlist drops it).

## 3. Server write + persistence path (three enumeration sites)

> **Land 3.1 and 3.2 together (3.2 before or with 3.1).** If the handler ships without the
> `onChange` enum, the next unrelated meta save (drawer/rename/hide) WIPES tags via the
> full-overwrite path. Do not merge 3.1 alone.

- [x] 3.1 Add `handleSetSessionTags` in `packages/server/src/browser-handlers/session-meta-handler.ts`, mirroring `handleHideSession`: `normalizeTags`, then `ctx.sessionManager.update(id, { tags })` + `ctx.broadcast({ type: "session_updated", sessionId, updates: { tags } })`. Do NOT call `mergeSessionMeta` (persistence is via `onChange`).
- [x] 3.2 **[land with/before 3.1] Add `tags: session.tags` to the `metaPersistence.save({…})` field enumeration in `server.ts` `sessionManager.onChange` (~L331).** This save is a FULL overwrite, not a merge — omitting `tags` wipes it on every unrelated save (same rule the `goalId` comment states).
- [x] 3.3 **Add `tags: meta.tags` to `sessionFromMeta` in `packages/server/src/session-scanner.ts` (~L57)** so cold-start restore carries tags (it is an explicit field enumeration — this is an ADD, not a confirm).
- [x] 3.4 Wire the `case "set_session_tags":` dispatch in `packages/server/src/browser-gateway.ts` next to `hide_session` / `set_session_process_drawer`.
- [x] 3.5 Handler tests in `packages/server/src/browser-handlers/__tests__/session-meta-handler.test.ts`: set tags → update + broadcast (assert the broadcast payload's `updates.tags` shape); empty array → untagged; unnormalized/over-cap input → normalized+clamped; **wipe-regression: set tags, then a subsequent unrelated meta save (e.g. drawer collapse), then `metaPersistence.flushAll()` (or advance past the debounce) — tags are NOT dropped**; **persistence round-trip: save enumerates tags AND `sessionFromMeta` restores them after a simulated restart**.

## 4. Client — chip primitives

- [x] 4.1 Create `<TagChip>` in `packages/client/src/components/tags/` with variants `user` (colorized, removable ✕), `exec` (dashed, muted, read-only), `filter` (selectable, `sel` ring). Colors from `tagColor`. Keyboard-operable + ARIA labels.
- [x] 4.2 Create `<TagFilterGroup>` (label + chip row + selection state) reused by the sidebar for the "Your tags" and "Phase (read-only)" groups.
- [x] 4.3 Create `<TagEditor>` — the add-tag popover: free-form input + autocomplete over the union of all in-use tags (allow new), commit on Enter/select, remove on chip ✕. Emits `set_session_tags` with the full new array.
- [x] 4.4 Component tests: add via autocomplete, add brand-new, remove, keyboard remove, overflow `+N` collapse.

## 5. Client — surfaces (depends on §4 chip primitives)

- [x] 5.1 Add a memoized "all tags in use" selector (flatten every session's `tags`, dedupe; recompute only when the session list changes) to feed `<TagEditor>` autocomplete and the sidebar tag group.
- [x] 5.2 Render the compact read-only tag strip (user chips + `+N` overflow + read-only phase chip) on the session card.
- [x] 5.3 Render the full editable `<TagEditor>` strip in the session detail header.
- [x] 5.4 Derive the phase pseudo-tag chip on card/detail from `openspecPhase` ONLY (read-only, no add/remove control). Do NOT include `kind` (automation is not a phase and is filtered out pre-pipeline).

## 6. Client — sidebar filter (depends on §4 + §5.1)

- [x] 6.1 Add TWO separate states to `SessionList.tsx`: `selectedTags: Set<string>` and `selectedPhases: Set<string>` (avoids the `apply` user-tag vs `apply` phase collision). Render "Your tags" (`<TagFilterGroup>` over the §5.1 union) and "Phase (read-only)" groups. Phase chips render `openspecPhase` values ONLY (not `kind`).
- [x] 6.2 **AUDIT then wire — the integration is multi-gate, not a fixed site list.** `grep -n 'workspaceFilter\|sessionSearch' SessionList.tsx` and route `selectedTags`/`selectedPhases` through EVERY visibility/expand/suppression decision it touches, across ALL folder tiers (pinned, unpinned w/ and w/o workspace filter, workspace-tier — which currently has NO visibility gate, add one), plus ended-session auto-expand and the "Show N ended" suppression. Known sites include `folderMatchesFilters` (~L568), `isFolderCollapsed` (~L583), within-folder filter (~L820), unpinned gate (~L1172), workspace render (~L1105), ended-expand (~L989) — treat this list as a STARTING POINT, not complete. Tag axis passes when `selectedTags` empty OR `session.tags` intersects it; phase axis passes when `selectedPhases` empty OR `session.openspecPhase` is in it. OR-within, AND-across; no "Active only" axis exists.
- [x] 6.3 Phase chips write no state (selection only); user-tag chips select `selectedTags`.
- [x] 6.4 Empty/clear states: show a "clear tags" affordance only while ≥1 tag/phase is active; show an inline "0 match" when a selection matches nothing.
- [x] 6.5 Filter tests in `SessionList` suite: OR within tags, AND across axes (folder+search+tag), no-selection inert, phase-chip filter writes nothing, user-tag `apply` does NOT match a phase-only `apply` session, **and folder-tier coverage: a tag-matching session keeps its folder visible + auto-expanded (including an ENDED match) in pinned, unpinned, AND workspace tiers; a zero-match folder is hidden in every tier**.

## 7. Verify & land

- [x] 7.1 `npm test` green; `npm run quality:changed` clean (Tier A errors zero).
- [x] 7.2 Automated as `tests/e2e/session-tags.spec.ts` (Playwright + Docker harness): add/remove/colorized tag on a live session, sidebar filter select, reload → tags persist. Verified green (8.9s) against a locally-built image. OR/AND filter + phase-chip read-only fully covered by unit/component tests (`SessionList.tags-filter.test.tsx`, `tags-components.test.tsx`).
- [x] 7.3 Discipline checkpoints: `component-architecture` (shared chip primitives), `accessibility-a11y` (keyboard + ARIA on interactive chips).
- [x] 7.4 Add per-file rows for new files (`tags/` components, shared helper) to the nearest directory `AGENTS.md`; run code-review + code-quality gates before commit.
