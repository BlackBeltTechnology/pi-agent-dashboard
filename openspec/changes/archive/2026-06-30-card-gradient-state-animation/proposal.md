## Why

Session-card state today is signalled by 45° barber-pole stripes that drift and pulse (`card-stripes-running` amber, `card-stripes-unread` cyan, `card-stripes-input` purple). The high-contrast diagonal edges run *under* the card's title and status text across the whole card, so the moving lines fight the glyphs and hurt readability — the exact complaint that motivated this change.

The dashboard already ships a calmer motion vocabulary the eye trusts: the pending sent-prompt "sweep" shimmer (`linear-gradient(90deg,transparent,color,transparent)` gliding across). Reusing that feel for card state keeps the state colors and the "alive" signal while removing the hard moving edges.

## What Changes

- Replace the `.card-stripes-fx` diagonal `repeating-linear-gradient(45deg, …)` with a **horizontal sweep gradient**: a soft, double-wide color band gliding left→right over a faint flat tint of the same color.
- Keep the loop **seamless and fluid**: an over-wide overlay carries a *repeating* soft band and is translated by exactly one period at constant (`linear`) velocity — no exit/re-entry snap. Compositor-only (`transform`), same cost profile as the stripes (per `throttle-idle-ui-animations`).
- Apply to all three states with the **identical colors**: running = amber `rgb(234 179 8)`, unread = cyan `rgb(34 211 238)`, ask_user = purple `rgb(168 85 247)`.
- **No change** to state-class wiring: `getCardPulseClass` / `getCardStripeFxClass` / `deriveProposalCardState` in `session-status-visuals.ts`, the class names (`card-stripes-running/unread/input`), precedence, and the OpenSpec board + folder rows all stay — they inherit the new look for free.
- Preserve `prefers-reduced-motion` (static tinted background, no drift) and the `app-hidden` pause hook.
- Verified the new gradient reads cleanly **underneath the selected card's rotating rainbow neon ring** (`card-ring-fx` / `card-glow-fx`); the combined surface stays legible.

## Capabilities

- **session-card-status** (MODIFIED): the streaming and unread state cues, plus their reduced-motion variants, now describe a horizontal seamless sweep gradient instead of diagonal drifting stripes. Class names, colors, precedence, and reduced-motion semantics are unchanged.

## Impact

- `packages/client/src/index.css` — swap the `.card-stripes-fx::before` background + keyframes (~12 lines). The OpenSpec board (`BoardSessionRow`) and folder rows use the same CSS, so they migrate with no component edits.
- Tests in `packages/client/src/lib/__tests__/session-status-visuals.test.ts` assert class names + precedence (unchanged), so they keep passing; visual scenario wording in the spec updates from "diagonal stripe" to "sweep gradient".
- Mockup: `openspec/changes/card-gradient-state-animation/mockup/index.html` (candidate A, double-wide, with the selected/rainbow combined column).
