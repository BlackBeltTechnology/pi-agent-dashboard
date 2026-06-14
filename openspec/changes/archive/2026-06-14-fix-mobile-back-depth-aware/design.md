## Context

Mobile back (header arrow + swipe) funnels into `goBack = goBackOrHome(navigate)` → `window.history.back()` (`packages/client/src/lib/history-back.ts`, wired at `App.tsx:991/1173/1651`). The MobileShell is depth-based — `getMobileDepth` derives `0=list / 1=detail / 2=overlay` from the active route (`packages/client/src/lib/mobile-depth.ts`) — but `history.back()` pops whatever URL preceded the current one, which is not "one depth up". After a window has been in use, the predecessor is commonly another `/session/:id` (walks sibling chats) or a non-app page (escapes the dashboard). The `history.length > 1` guard is unsound: length > 1 ≠ predecessor belongs to the app.

Two structural facts constrain the fix:
1. **Browsers cannot read the previous history entry's URL** (security). "Is the predecessor a shallower in-app route?" is unanswerable by inspection — the app must track its own navigation.
2. **Some overlay URLs don't encode their launching detail.** `/folder/:cwd/openspec/:change/:artifact`, `/folder/:cwd/readme`, `/folder/:cwd/pi-resources`, `/pi-resource?path=` can be opened from a session chat OR a folder; the URL alone can't reconstruct the originating `/session/:id`. Only `/session/:id/diff` has a URL-computable parent (`strip /diff`).

Route → depth map (current):

| Route | Depth | URL-computable parent? |
|---|---|---|
| `/` | 0 | — |
| `/session/:id`, `/folder/:cwd/{terminals,editor}`, `/settings`, `/tunnel-setup` | 1 | yes → `/` |
| `/session/:id/diff` | 2 | yes → `/session/:id` |
| `/folder/:cwd/openspec/*`, `/folder/:cwd/readme`, `/folder/:cwd/pi-resources`, `/pi-resource?…` | 2 | **no** (origin not in URL) |

## Goals / Non-Goals

**Goals:**
- One back press (arrow or swipe) = exactly one depth up, deterministically.
- From ChatView (depth 1) back always reaches the session-card list (depth 0).
- Never walk sibling sessions; never escape the dashboard via back.
- Preserve browser-native back when it provably lands on a shallower in-app route (keeps scroll restoration + forward entry).

**Non-Goals:**
- No change to `getMobileDepth` route-derivation.
- No change to desktop two-panel list↔detail (it doesn't use `goBack`; only overlay back-arrows do).
- No new routes, no server/protocol/shared changes.
- Not implementing a full router history abstraction — minimal tracked stack only.

## Decisions

### D1. Hybrid: depth-navigate by default, `history.back()` as a proven fast-path
On back: if the tracked predecessor exists AND its depth `<` current depth, call `window.history.back()` and pop the tracked stack; otherwise `navigate(computeBackTarget(route))`. 
- *Why over pure `history.back()` (status quo):* unsound — predecessor may be a sibling chat or a foreign page.
- *Why over pure depth-navigation:* pure `navigate(parent)` pushes a new entry and discards the browser's forward stack + scroll restoration. The fast-path keeps native behaviour when it's safe. Hybrid was the explicitly chosen option.

### D2. Track an in-app depth-tagged nav stack
Maintain `stack: Array<{ url, depth }>` in a module/hook. Every wouter navigation appends `{ url, depth: getMobileDepth(parse(url)) }`. A `window.addEventListener("popstate", …)` handler realigns the stack on browser back/forward (pop on back, re-derive on forward). The stack's last-but-one entry is the "predecessor" used by D1.
- *Why:* the only way to answer "is the predecessor shallower and in-app" given browser constraints (Context fact 1).
- *Alternative considered — stamp `history.state` with depth:* readable only for the current entry, not the previous one, so it can't answer the predecessor question without already navigating. Rejected.

### D3. `computeBackTarget(route): string | null` — pure, tested fallback
- depth 1 → `/`.
- `/session/:id/diff` → `/session/:id` (strip `/diff`).
- ambiguous-origin depth-2 overlays (openspec/readme/pi-resources/pi-resource) → `/` (cards). Rationale: when the tracked stack lacks the real origin (deep link / hard refresh into an overlay), returning to cards is predictable and never traps the user; the common in-session case is already handled by the D1 fast-path returning to `/session/:id`.
- depth 0 → `null` (no-op).
- *Why `/` for ambiguous overlays rather than the `/folder/:cwd` route:* a bare folder has no depth-1 panel of its own in every case, and cards is the universal safe floor. Revisit only if a concrete origin becomes encodable.

### D4. Keep the public entry point name `goBack`
`App.tsx` has many `onBack={goBack}` call sites. `goBack` keeps its signature; its body changes from `goBackOrHome(navigate)` to the hybrid logic. `goBackOrHome` is removed or demoted to the cold-load branch.

## Risks / Trade-offs

- **Stack drift vs browser forward/back** → `popstate` listener re-aligns on every pop; treat the stack as a hint, never trust it blindly — D1 only *upgrades* to `history.back()` when the predecessor check passes, else falls back to deterministic `computeBackTarget`, so drift degrades to "still correct, just pushes instead of pops".
- **React StrictMode double-invoke / duplicate appends** → dedupe consecutive identical `{url}` on append; cover with a unit test.
- **wouter `replace:true` navigations** (e.g. `App.tsx:652` redirect) → replace must overwrite the stack top, not append, to mirror the real history mutation.
- **Ambiguous-overlay deep link returns to `/` not the folder** → accepted trade-off (D3); predictable floor over guessed origin.
- **Desktop regression surface** → desktop overlay back-arrows also call `goBack`; `computeBackTarget` returns their correct parent, but add a desktop smoke check that overlay back still closes to the prior view.

## Migration Plan

Pure client change, no rollout coordination. Ship behind normal build. Rollback = revert the `history-back.ts` + new `back-target.ts`/tracker files; `goBack` call sites unchanged so revert is isolated.

## Open Questions

- Should the D1 fast-path also require the predecessor URL to still match a live route (e.g. session not since ended), or is depth-shallower sufficient? Leaning sufficient — `App.tsx:652` already redirects dead `/session/:id` to `/`.
- Do we need forward-stack preservation at all on mobile, or is depth-navigation-only acceptable (simpler, drops D1/D2)? Hybrid chosen by user; revisit if the tracker proves flaky.
