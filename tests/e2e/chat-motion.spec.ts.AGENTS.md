# chat-motion.spec.ts — index

L3 chat motion in a real browser: F1 live entry (`@starting-style` first-frame opacity) · F2 paced reveal (length changes per WS update) · F3 glide follow · F4/F5/F6 Page Up / wheel-up / foreign scroll mid-glide · F7 relocation mid-glide · F8 selection freeze · F9 trailing edge · F10 completion cue · F11 idle exemption (`data-chat-motion-busy`) · F12 reduced motion · F13 pref off. Fixtures `chat-motion-stream` / `chat-motion-glide`. See change: add-fluid-chat-motion.

Companion `chat-motion-perf.spec.ts` (L3 opt-in `PW_PERF=1`): render-cost gate for chat motion (D4) — tail scripting on/off ratio ≤ 1.5 (CDP `ScriptDuration`), p95 rAF frame interval < 16.7 ms (+0.3 jitter). Numbers recorded in the change's `perf.md`. See change: add-fluid-chat-motion.
