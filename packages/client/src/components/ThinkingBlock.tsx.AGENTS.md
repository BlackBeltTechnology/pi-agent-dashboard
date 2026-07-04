# ThinkingBlock.tsx — index

Exports `ThinkingBlock`. Collapsible reasoning panel; props `content`, `isStreaming`, `defaultExpanded`, `startedAt`, `duration`, `streamedLive`, `autoCollapseMs`, `onUserCollapse`. Renders `MarkdownContent` body + `ElapsedBadge`. i18n label "Reasoning".

Testids: `reasoning-block` (outer div), `reasoning-body` (expanded body div, present only when expanded) — asserted by `tests/e2e/reasoning-auto-collapse.spec.ts`.

Auto-collapse timer (change: reasoning-auto-collapse-timer): live-streamed persisted block mounts expanded (`streamedLive` alone, NOT gated on ms); arms `setTimeout(collapse, msRef)` when `streamedLive && ms>0 && !touched`. `msRef` captured at mount (mid-window pref change never restarts). Effect deps `[streamedLive, isStreaming]`; skips entirely when `isStreaming` (streaming block user-controlled, no timer/demotion). Demotion (C2): `streamedLive` true→false collapses mounted block. Manual toggle sets `touchedRef`, clears timer, calls `onUserCollapse` on collapse. `autoCollapseMs=0` = stay open, never arms.
