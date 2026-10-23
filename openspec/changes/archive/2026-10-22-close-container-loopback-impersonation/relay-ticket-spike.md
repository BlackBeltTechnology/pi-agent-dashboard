# Spike note — relay ticket query survives the real clients (task 6.1)

Question (design D10): do the relay clients keep a `?ticket=` query on the relay WS URL, and do any of
them need to redial the SAME URL? A single-use ticket breaks a client that does.

Method: a throwaway loopback server (`ws` + `http`) that records the upgrade request-target, `Origin`
and any HTTP probe, answers CDP minimally, and can drop the socket. Run 2026-10-22 on macOS (node 24).

| Client | Version | Query kept? | Extra requests / headers | Redials the same URL? |
|---|---|---|---|---|
| Playwright `chromium.connectOverCDP("ws://127.0.0.1:P/ws/browser-cdp/G?ticket=T")` | playwright-core 1.62.1 | **Yes** — upgrade seen as `/ws/browser-cdp/G?ticket=T` | none: no HTTP probe, no `Origin` | No (no auto-reconnect) |
| `agent-browser connect <url>` | 0.27.1 | **Yes** — same request-target, once | none: no HTTP probe, no `Origin` | **No.** After the server dropped the socket the next command (`tab list`) made no second dial of the URL (it quietly fell back to a fresh local browser) |
| Pinned Playwright Chrome extension (`connect.html?mcpRelayUrl=…`) | Web Store 0.4.0 | Not testable offline (needs a real Chrome profile with the extension). Upstream `connect.tsx` validates only the URL's host (`127.0.0.1` / `[::1]`) and opens `new WebSocket(mcpRelayUrl)`, so the query rides in the opaque value | n/a | No: it dials once per `connect.html` open and shows "Disconnected" on a drop |

Verdict: **no client needs a reusable URL and none drops the query**, so a single-use,
60 s ticket appended to `cdpUrl` and `mcpRelayUrl` is compatible. No `SHIP_IT_BLOCKED.md`.

Consequences carried into the build:
- A reconnect needs a fresh `connect` (the existing contract: one CDP client at a time, a drop ends it).
- The extension leg is covered by the manual check **X9 / task 6.7** (real Chrome profile + extension).
- The ticket is a query parameter, so `guidFromPath` (which already strips the query) keeps working.
