# DOX — packages/client/src/lib/state

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `DisplayPrefsContext.tsx` | React context exposing `{ global: DisplayPrefs|undefined, getSessionOverride(id):… → see `DisplayPrefsContext.tsx.AGENTS.md` |
| `draft-storage.ts` | Per-session chat-input draft persistence in `localStorage` under `chat-draft:<sessionId>`. → see `draft-storage.ts.AGENTS.md` |
| `recovery-offer-bus.ts` | App-level channel for the cold-start recovery offer: server broadcasts/replays one `recovery_offer` (≥1 unclean-shutdown session, setting `ask`); `setRecoveryOffer(candidates)`, `RecoveryOffer`. Consumed by `<RecoveryOfferHost>`. |
| `spawn-error-toast-bus.ts` | Module-singleton bus for off-screen `spawn_error` toasts. → see `spawn-error-toast-bus.ts.AGENTS.md` |
