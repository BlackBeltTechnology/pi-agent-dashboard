# connection.ts — index

WebSocket connection manager with exponential backoff reconnect, message buffering while disconnected, server-liveness watchdog. Exports `ConnectionManager`, `ConnectionManagerOptions`. Holds `suppressUntil` deadline for `server_restarting` quiesce window.
Handles `register_rejected` as a TERMINAL refusal: bypasses the inbound pump, fires `onRegisterRejected(sessionId, reason)`, sets `intentionalClose` and tears down — so the refused duplicate never reconnects/re-registers for that id. Every other close still reconnects with backoff. See change: fix-duplicate-bridge-registration.
