# Proposal: add-fluid-chat-motion

## Why

The chat transcript feels stiff while an agent works. New rows (the optimistic prompt card, tool cards, the streaming bubble) mount with no transition. Streamed text lands in bursts, because the bridge coalesces text updates into 50 ms windows (`COALESCE_WINDOW_MS`) and providers stall and then dump whole paragraphs. Stick-to-bottom also snaps `scrollTop` instantly on every chunk. The result reads as jumpy rather than live. An explore-mode A/B mockup (`mockups/chat-fluid-motion`, illustrative only, no trace) showed that pacing the same bursty feed reads as continuous, while today's rendering reads as stepped.

## What Changes

- **Live-arrival entry motion.** Elements that newly arrive while the user follows a live session (the optimistic prompt card, a steering card, a tool call's first appearance, the streaming bubble's first content) play a short compositor-only entry (fade plus a small rise, ≈200 ms). Arrival is detected in the view (a seen-set re-seeded on every session switch, edge detection for singletons and steering, and a bulk guard), and the reducer stays pure. It only runs in hosts that signal replay; the team-app embed gets no entry or completion cues. History, replay, session switch, remount, off-screen arrivals, re-parented groups and commit swaps never animate.
- **Paced streaming reveal.** Received streaming text (the assistant answer and live reasoning) is revealed on animation frames at a rate that adapts to the backlog, instead of being painted per received chunk. A 400 ms deadline bounds the lag: every received character is visible within 500 ms. Pacing applies only while following the bottom. A held selection (answer or live reasoning) freezes the reveal. When the turn ends, the committed message shows its full content.
- **Soft trailing edge.** A small gradient mask sits at the reveal point, so the newest glyphs appear softened and turn crisp as the reveal advances. It fades away at rest. The markdown tree is untouched, so links, selection and copy are unaffected. The existing streaming caret is unchanged.
- **Glide follow-scroll.** While following the bottom, live and reveal growth is chased with a short frame-rate-independent exponential glide (τ 60 ms, settling in ≤ ~360 ms) instead of an instant `scrollTop` snap. Each glide step is an attributed bottom-pin under the existing `chat-scroll-lock` contract: events matching the achieved position keep follow, and any foreign scroll (scrollbar drag, keyboard, find-in-page) falls through and ends the glide. Wheel/touch, relocations, selection, and motion turning off cancel it too. Large growth and all relocations stay instant: session switch, replay, restore, jump-to-message, scroll-to-top.
- **Tool completion cue.** A tool that completes on screen pops its completion icon in, and any result body revealed by that completion fades in. This is detected by a running→done flip inside the component, so it is live-only, and no layout property is animated.
- **Robust under every pause.** Motion is built from CSS transitions with `@starting-style` and from frame-driven JS, never CSS keyframe animations. The existing `fx-idle` / `app-hidden` `animation-play-state: paused` marks therefore can never freeze content invisible. The settled state is always the element's static style. Motion is inactive while the document is hidden.
- **User control.** A new `chatMotion` display preference (boolean, default `true`) is settable globally (Settings chat-display section) and per session (`ChatViewMenu` View popover). Legacy prefs are backfilled. `prefers-reduced-motion: reduce` disables all of it regardless of the pref. With motion off, the transcript behaves exactly as today.
- **Out of scope:** the embeddable `MinimalChatView` (`client-utils/minimal-chat`), bridge or server changes (the coalescer stays at 50 ms), and the blur-in reveal variant from the mockup (fade only).
- Mockup: mockups/chat-fluid-motion (in this change)

## Capabilities

### New Capabilities
- `chat-motion`: The motion contract of the live chat transcript. It covers which rows animate on entry and which never do, paced reveal of streamed text with a bounded lag, fresh-text fade, spring follow-scroll versus instant relocation, tool completion motion, the `chatMotion` preference and reduced-motion gating, and the guarantee that motion never leaves content hidden or blocks behaviour under idle or hidden animation pauses.

### Modified Capabilities
- `ui-animation-energy`: the "Pause animations when the UI is visible but idle" requirement gains a second **bounded exemption**, parallel to the indeterminate-indicator one. Arrival-driven chat motion may run while idle, but schedules no work later than 1 s after the last arrival, and never while hidden or scroll-locked. The idle delay is 5 s, so without the exemption motion would be disabled during nearly every watched stream.
- `chat-scroll-lock`: "Auto-scroll robust to multi-batch event replay" adds that a follow-glide step is an attributed bottom-pin write (the escape paths are unchanged). "Scroll-to-bottom button" clarifies that a glide in progress is not scroll-lock, so no button appears mid-glide.

<!-- Preserved unchanged (constraints, not deltas): chat-view (streaming liveness cue + existing caret, bounded group transition, pending-prompt zero-shift), chat-transcript-virtualization (scroll semantics; the glide is a new internal writer class that preserves them), chat-selection-preservation (tail freeze; the snapshot becomes the revealed text), chat-event-render-batching (the reducer is untouched), chat-idle-render-cost (compositor-only, nothing when quiet). -->

## Impact

- **Client:** `packages/client/src/components/chat/ChatView.tsx` (arrival detection, answer + inline-reasoning pacing, trailing mask, `pinBottom` + attributed glide writer), `ThinkingBlock.tsx` (live reasoning reveal), `ToolCallStep.tsx` / `ToolBurstGroup.tsx` (entry + in-instance completion cue), `ChatViewMenu.tsx`, `settings/SettingsPanel.tsx`, `index.css` (transition classes + reduced-motion guard), new `lib/chat/` modules (paced-reveal hook, seen-set, glide spring). `lib/chat/event-reducer.ts` is NOT changed.
- **Shared:** `packages/shared/src/display-prefs.ts` (`chatMotion` field, presets, merge).
- **Server:** `packages/server/src/persistence/preferences-store.ts` (load backfill + both `setDisplayPrefs` construction literals).
- **i18n:** `common.chatMotion` + `settings.chatMotion` in `packages/client/src/lib/i18n-en-source.json` and every `packages/client/src/lib/i18n/i18n-*.ts` locale bundle.
- **Consumers:** the team-app `ChatPane` (`packages/team-app/src/agent/ChatPane.tsx`, via `chat-embed`) gets motion too. It passes no replay flags, so it gets pacing, the trailing edge and the glide, but no entry or completion cues (design D2). It falls back to `DISPLAY_PRESETS.standard`, so motion is on there and only OS reduced motion disables it.
- **No protocol, bridge, or dependency changes.** No new npm dependency. Patterns come from `use-stick-to-bottom` (spring step only) and AI SDK `smoothStream` (pacing), both re-implemented in a few lines.
- **Rollback:** set `chatMotion=false` globally (runtime, no deploy). Sessions with an explicit per-session override `true` keep motion until that override is reset. Code revert is self-contained because no persisted state other than the pref field changes, and an unknown pref field is ignored by older clients.

## Discipline Skills

- `performance-optimization`: paced reveal raises streaming-tail render frequency (≈20/s → up to 60/s). Design D4 requires a measure-first trace gate with a fixed escalation order before the trailing edge and the glide land.
- `doubt-driven-review`: the glide writer and the `handleScroll` attribution rework touch a known scroll-race hotspot (`fix-chat-scroll-race-during-replay`, `fix-chat-scroll-to-top-estimate-drift`). This is the irreversible-feeling step that needs a fresh review before it stands.
- `review-code`: before commit (non-trivial client change).
