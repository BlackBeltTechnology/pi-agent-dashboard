# ConnectionStatusBanner.tsx — index

Disconnection banner: appears only after active WebSocket has been non-`OPEN` for &gt;3s continuously; hidden immediately on reconnect; suppressed during in-flight staging switch. Mounted above `<MobileShell>` in `App.tsx`. See change: distinguish-offline-from-network-denied — new props networkDenied + onOpenServers; renders distinct "Network not allowed" amber surface (server hint + Settings → Servers affordance) immediately on a guard 403, takes precedence over offline banner; transport drop keeps Disconnected/Retrying.

"Network not allowed" restyled onto `--severity-warning-*` tokens + icon + wrapping hint, and gains a "Request access" action: same origin → `/pair?request`; a remote active server → `window.open(<server>/pair?request, "_blank", "noopener")`. See change: add-lan-knock-pairing.

## add-request-access-remedy

`requestAccess` uses `requestAccessTarget(apiBase, window.location.origin)` from `lib/pairing/request-access-target.ts`; `window.open(href,"_blank","noopener")` / `location.assign(href)` unchanged.

## retire-trusted-networks-bypass

Denied bar follows this tab's knock (`lib/pairing/knock-state.ts`, `useKnockView`, 1 s tick only while a countdown shows): idle ⇒ warning tokens, `network-denied-banner`, hint verbatim; pending ⇒ info tokens, `network-denied-request-pending` ("Waiting for approval on {host}. Type 4821 7730 there…", countdown); refused ⇒ error tokens, `network-denied-request-refused`, shared `knockRefusalCopy` reason. Request access stays the primary (`--accent-solid`), Settings → Servers secondary in every state. Offline banner unchanged. See change: retire-trusted-networks-bypass.

Request-access opens via `openExternalUrl` / same-origin `assignLocation` (`classifyUrl` gate). See change: harden-client-sinks.
