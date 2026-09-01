# lib/smoke-spawn-session.mjs — index

Test helper: connects dashboard browser WS (`/ws`), sends spawn_session for cwd, waits for session_register/session_added. Uses global WebSocket (Node 22+, no wscat). Exit 0 on session live, 1 on failure/timeout, 2 on usage error. --url --cwd --timeout flags. Used by Docker smoke.
