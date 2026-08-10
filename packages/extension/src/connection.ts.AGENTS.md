# connection.ts — index

WebSocket connection manager with exponential backoff reconnect, message buffering while disconnected, server-liveness watchdog. Exports `ConnectionManager`, `ConnectionManagerOptions`. Holds `suppressUntil` deadline for `server_restarting` quiesce window.
