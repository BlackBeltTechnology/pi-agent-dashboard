# ConnectionStatusBanner.tsx — index

Disconnection banner: appears only after active WebSocket has been non-`OPEN` for &gt;3s continuously; hidden immediately on reconnect; suppressed during in-flight staging switch. Mounted above `<MobileShell>` in `App.tsx`. See change: distinguish-offline-from-network-denied — new props networkDenied + onOpenServers; renders distinct "Network not allowed" amber surface (server hint + Settings → Servers affordance) immediately on a guard 403, takes precedence over offline banner; transport drop keeps Disconnected/Retrying.

"Network not allowed" restyled onto `--severity-warning-*` tokens + icon + wrapping hint, and gains a "Request access" action: same origin → `/pair?request`; a remote active server → `window.open(<server>/pair?request, "_blank", "noopener")`. See change: add-lan-knock-pairing.

## add-request-access-remedy

`requestAccess` uses `requestAccessTarget(apiBase, window.location.origin)` from `lib/pairing/request-access-target.ts`; `window.open(href,"_blank","noopener")` / `location.assign(href)` unchanged.
