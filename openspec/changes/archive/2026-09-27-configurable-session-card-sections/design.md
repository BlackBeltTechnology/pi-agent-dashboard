## Context

`SessionCard.tsx` (desktop branch) renders sections in this order: tags strip → OPENSPEC → KB (worktree slot, bare `SlotPill`) → GIT → STATUS (`session-card-badge`) → PROCESS → FLOWS → MEMORY. Every subcard already self-hides when empty (`SessionSubcard` returns null on empty children; plugin wrappers gate on `useSlotHasClaimsForSession`). The mobile branch renders a flat subset: tags, OpenSpec, `MobileProcessSubcard`, etc.

The preferences plumbing to reuse:
- `preferences-store.ts#collapsedFolders`: `pathKey`-folded folder keys, platform from `inferPlatform`, WS `set_folder_collapsed` → `collapsed_folders_updated` snapshot, and a snapshot on connect.
- `displayPrefs`: a global value plus a sparse override, merged in a pure shared helper.

Mockup: `mockups/index.html` (tabs A/B/C).

## Goals / Non-Goals

**Goals:** one resolve function shared by desktop and mobile; server-authoritative persistence; zero behaviour change when no preference exists.

**Non-Goals:**
- per-session overrides
- reordering sections
- hiding header lines 1–3 (name, model, activity, context, cost)
- a "N sections hidden" card footer (considered in the mockup, rejected by the user)

## Decisions

### D1 — Separate `cardSections` preference, not a `DisplayPrefs` field
The stored shape is `cardSections?: { global?: Record<SectionId, boolean>; folders?: Record<FolderKey, Record<SectionId, boolean>> }` in `preferences.json`.

*Alternative:* add the field to `DisplayPrefs`. Rejected because `DisplayPrefs` carries per-session overrides, which would add a third layer we explicitly don't want, and it has a first-launch preset flow that doesn't apply here.

### D2 — WS messages, following the collapsed-folders pattern
- `set_card_section_visibility { path?: string; section: string; visible: boolean | null }`:
  - `path` absent means global.
  - `null` means inherit, which deletes the key; an empty folder map is removed.
- `reset_folder_card_sections { path }`.
- `card_sections_updated { cardSections }` is a full snapshot. It's sent on every mutation and on connect when the preference is non-empty.
- Setters return `true` only on a real mutation, so the server broadcasts only on change.

*Alternative:* REST PATCH, like display prefs. WS was chosen because it matches the closer precedent (per-folder state) and needs no auth-route wiring.

### D3 — Folder key = `pathKey(gitWorktree?.mainPath ?? cwd)`
This is the same fold rule as `collapsedFolders`, so the client and server compute identical keys without resolving symlinks. Worktree sessions therefore follow their sidebar group folder (spec: worktree requirement).

### D4 — Section ids are strings with a known built-in set
`CARD_SECTION_IDS = ["openspec","git","process","kb","status","flows","memory","tags","spawn"] as const`. Stored maps accept any valid id, so future plugin sections are preserved on write.
- Validation: `/^[a-z0-9-]{1,64}$/`.
- Caps: 1000 folders and 64 keys per map. Over-cap writes are rejected without mutation.

### D5 — One pure resolver in shared
`resolveCardSectionVisible(prefs, folderKey, id): boolean` returns `folders[key]?.[id] ?? global?.[id] ?? true`. It's unit-tested in shared.

On the client, `CardSectionsContext` (hydrated from `card_sections_updated`) and `useCardSectionVisible(session, id)`. Each call site does an AND with its existing gate. There's no new wrapper component, so the empty-hide logic stays untouched.

### D6 — Gating points in `SessionCard.tsx`
- Desktop:
  - tags strip, spawn buttons (`+Session` and `+Worktree` together), OPENSPEC IIFE
  - `WorktreeCardSectionSlot` wrapper (kb)
  - `GitSubcard`, `BadgeSubcard` (status), `ProcessSubcard`, `FlowsSubcard`, `MemorySubcard`
- Mobile: the equivalent flat rows.
- `Fork`/`Resume` stay visible; they're lifecycle controls, not section chrome.

### D7 — PROCESS safety chip
When `process` resolves hidden and `processes.length > 0`, render a compact `⚠ N background process(es)` chip. It reuses the existing mobile `⚠ N` chip visual, and activating it opens the process drawer or bottom sheet. In-flight bash activity is NOT surfaced, because it's transient and visible in chat.

### D8 — Legend menu on `SessionSubcard`
Add an optional `menu?: { sectionId; folderKey }` prop. The `⋯` button:
- is shown on hover or focus-within of the subcard and is always in the tab order
- calls `stopPropagation` so it doesn't select the card

Actions send `set_card_section_visibility`, then `showToast(msg, "info", { action: Undo })`. Undo re-sends the previous value, captured before the write (`boolean | null`).

The KB, tags and spawn sections have no legend, so they're reachable only through the settings pages.

### D9 — Settings UIs
- `DirectorySettings` gains the page id `cards` ("Session cards"), placed after Packages. The live preview is a static synthetic card built from the same resolver, which avoids depending on a live session.
- `SettingsPanel` Display area gains a `CardSectionsSection` with switches and override counts. Counts are derived client-side from the snapshot.
- Plugin rows render only when `registry.getClaims(slot).length > 0`, through a new small `useSlotHasAnyClaims(slotId)` in `slot-consumers.tsx`.

## Risks / Trade-offs

- [User hides GIT, forgets, thinks it's broken] → the legend menu is discoverable and the Directory Settings page marks overrides. The footer was declined; revisit if feedback shows confusion.
- [Hidden PROCESS masks a runaway process] → D7 safety chip.
- [Worktree cwd vs group mismatch confuses users] → the page subtitle states "(and its worktrees)".
- [Global change silently shadowed by folder overrides] → per-row override counts in global settings.
- [Unbounded growth of the folders map from transient paths] → caps (D4). No pruning, same rationale as `collapsedFolders`.

## Migration Plan

- Additive field. Absent means all visible. No backfill needed.
- Rollback: an older server ignores the unknown WS messages. If the store drops unknown top-level fields on its next write, the preference is lost and cards revert to all-visible. That's acceptable.
- No client/server version gate needed: a new client talking to an old server just never receives a snapshot, and cards show all sections.
