# staging-socket.ts — index

`openStagingSocket(url, {timeoutMs}): Promise<WebSocket>` — single-settle helper that resolves on first `OPEN`, rejects on error/close/timeout, closes socket on timeout to avoid leaks. Used by transactional server-switch.
