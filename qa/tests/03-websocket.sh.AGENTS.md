# 03-websocket.sh — index

Unix WebSocket smoke. Probe pi gateway `ws://localhost:9999` + browser `ws://localhost:8000/ws` via `ws` module (5s timeout). Falls back to curl port-connectivity when `ws` unavailable. Requires server running.
