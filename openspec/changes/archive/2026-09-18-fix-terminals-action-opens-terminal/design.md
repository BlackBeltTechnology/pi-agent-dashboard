## Context

See `proposal.md` — Why. Verified wiring today (all line refs against the working tree at planning time):

- `App.tsx:2469-2470` — `onOpenTerminals` and `onOpenEditor` both `navigate(\`/folder/${enc}/editor\`)`.
- `App.tsx:562` — `folderEditorCwd` is derived from the **live** `useRoute` match, and `folderViewContent` (`:2415`) returns `null` when it is absent. So the folder pane **unmounts and remounts** across any overlay route cycle.
- `App.tsx:2417` (desktop) and `App.tsx:2515` (`renderFolderEditor`, consumed by `ShellContent.tsx:165` for mobile) are the **two** `FolderEditorView` call sites. Both are in `App.tsx`; `ShellContent` does not need touching.
- `App.tsx:686` — `terminals` is `useState<Map<string, TerminalSession>>(new Map())`, populated from the WebSocket snapshot. It is **empty on cold load**. `App.tsx:669` — `snapshotGeneration` counts applied snapshots; `useOpenSpecReconcile.ts:91` already gates on it.
- `FolderEditorView` → `SplitWorkspaceProvider autoSurfaceTerminals` → `useTerminalPaneTabs({ cwd, terminals, autoSurface, dispatch, ensureOpen, onCreateTerminal, … })`.
- `use-terminal-pane-tabs.ts:57-62` — `reconcileTerminalTabs` carries a **cold-load guard**: an empty live set means "not yet known", so no `term:` tab is dropped.
- `use-terminal-pane-tabs.ts:154` — auto-surface dispatches `openFile` with **no** `activate` flag, and `editor-pane-state.ts` `reduceOpenFile` computes `activate = action.activate !== false` → **true**. Auto-surface therefore *does* activate each tab it opens; the last id in set order wins.
- `use-terminal-pane-tabs.ts:157` — the "open the freshly-created terminal" branch is gated `if (!autoSurface && pendingCreateRef.current)`, so it is **dead on the folder pane**. A terminal created there surfaces (and activates) purely through the auto-surface dispatch above.
- `EditorTabs.tsx:128-135` — tabs carry `role="tab"`, `aria-selected`, `title={file.path}` and **no** `data-testid`.

## Goals / Non-Goals

**Goals:** a deterministic activate-or-create driven by a URL flag; zero change to the plain editor entry; no duplicate PTY under any load ordering the readiness gate can observe; deterministic in vitest and Playwright.

The duplicate-PTY goal is deliberately scoped to orderings the gate can observe, because one ordering provably escapes it: a reload landing inside the window between a create and the server registering that terminal sees a snapshot reporting no terminal, and creates one extra. That residual is **accepted and bounded to one extra terminal per entry** (see Risks); closing it would need server-side create idempotency (a request key deduplicated across reloads), which is out of scope here. Stating the goal as "under any load ordering" would contradict that accepted risk.

**Non-Goals:** a dedicated `/terminals` route (removed by `terminals-in-tabbed-panes`, not reintroduced); focusing a *specific* terminal id from the URL; changing how the session split handles terminals; changing auto-surface's own activation behaviour.

## Decisions

### D1 — Signal via `?focus=terminal` on the existing editor route

A search parameter keeps the route table and the `useRoute` non-shadowing analysis untouched. `App.tsx` reads it with the already-imported `useSearchParams` and passes three props down through `FolderEditorView` → `SplitWorkspaceProvider` → `useTerminalPaneTabs`, at **both** call sites (`:2417`, `:2515`):

- `focusTerminal: boolean` — the request (`focus === "terminal"`).
- `terminalsReady: boolean` — `snapshotGeneration > 0` (D2a).
- `onFocusConsumed: () => void` — fired once when the request is honoured (D3).

*Alternative rejected:* navigation state (`history.state`) — not visible in tests or bookmarks and lost on reload.

### D2 — One-shot inside `useTerminalPaneTabs`, ordered after reconcile

Add `focusOnMount?: boolean`, `terminalsReady?: boolean`, `onFocusConsumed?: () => void` to the hook. A `focusHandledRef` gates an effect **declared after** the existing reconcile effect.

```
if (!focusOnMount || !terminalsReady || focusHandledRef.current) return;
const newest = paneTerminals with max createdAt (fall back to the last element);
if (newest) { openTerminal(newest.id); consume(); }
else if (onCreateTerminal) { createTerminal(); consume(); }
// no onCreateTerminal → createTerminal() early-returns; do NOT burn the flag
```

`consume()` sets `focusHandledRef.current = true` **and** calls `onFocusConsumed()`.

Three things this pins that the first draft did not:

- **(D2a) Readiness gate.** `terminalsReady` is the only thing that distinguishes "no terminal exists at this cwd" from "the snapshot has not landed". Without it, a reload or deep-link with `?focus=terminal` sees `terminals === []` on the first commit and mints a duplicate PTY. This is the same hazard `reconcileTerminalTabs`'s cold-load guard already handles for tab-dropping.
- **(D2b) Effect ordering is load-bearing.** Auto-surface's reconcile dispatch activates the last id in set order; the one-shot's `openTerminal(newest)` must land **after** it to win `activeIndex`. React runs effects in declaration order within a commit, so the one-shot effect is declared below the reconcile effect and both depend on `idSig` (the live-id-set signature — **not** the `terminals` array identity, which changes on every title update).
- **(D2c) Creation path.** On the folder pane `autoSurface` is `true`, so the hook's `pendingCreateRef` branch does not run. The created terminal's tab is opened **and activated** by the auto-surface dispatch once the new id reaches `idSig`, because `reduceOpenFile` defaults to `activate: true`. The one-shot needs no follow-up activation — but for that reason, not the one the first draft gave.

Because `focusHandledRef` is set synchronously before the async creation lands, the later `terminals` update cannot trigger a second creation.

*Why in the hook, not the provider:* the hook owns the reconcile and both affordances. Keeps the one-shot next to the state it reads.

### D3 — Consume the parameter after it is honoured

On `onFocusConsumed`, `App.tsx` strips `focus` from the URL with a **replace** navigation (no history entry). Reasons the first draft's "leave it in the URL" was wrong:

- The folder pane unmounts whenever an overlay route is live and remounts on dismissal with the background URL restored (`App.tsx:562/2415`). A sticky parameter re-fires the one-shot on every such cycle, yanking the user off whatever tab they had chosen — and creating a fresh terminal if they had closed them all.
- With the parameter gone, remounts are inert by construction; no extra bookkeeping state is needed. The URL stays the single source of truth.

**Cwd-switch corollary:** `focusHandledRef` is instance-scoped, and `/folder/A/editor?focus=terminal` → `/folder/B/editor?focus=terminal` changes props without remounting. The ref is therefore **reset whenever `cwd` changes**, so the entry works per cwd rather than per component instance.

### D4 — Stable tab testids

`EditorTabs.tsx` tabs gain `data-testid="editor-tab"` and `data-tab-path={file.path}`. Additive attributes on a shared component; no behaviour change. The browser test asserts `[data-testid="editor-tab"][aria-selected="true"]` has a `data-tab-path` starting with `term:`, instead of depending on title text or tab ordering.

## Risks / Trade-offs

- **[Terminal set genuinely empty vs. slow snapshot]** — the readiness gate delays the one-shot until the first snapshot is applied, so the Terminals action feels marginally slower on a cold load. Accepted: correctness over an imperceptible delay, and the SPA-navigation path (the common case) is already ready.
- **[`onCreateTerminal` absent]** — `createTerminal()` early-returns (`use-terminal-pane-tabs.ts:170-174`). The one-shot does not burn its flag in that case, so a later render with the handler present still honours the entry. No retry on a *server-side* create failure: the flag is burned and nothing appears. Bounded to a failed POST; the user can retry with the pane's own new-terminal button.
- **[Ephemeral terminals present but no non-ephemeral]** — treated as "none exists" → create; matches the pane's own `!t.ephemeral` filtering.
- **[Reload immediately after a create, before the server registered the terminal]** — the readiness gate closes the cold-load window, but a snapshot applied in that narrow interval still reports no terminal → one extra terminal. Bounded to one per entry, and far narrower than the unguarded draft.

## Migration Plan

Client-only; `npm run build && curl -X POST …/api/restart`. No rollback concerns.
