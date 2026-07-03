# ConnectionStatusBanner.tsx — index

Disconnection banner: appears only after active WebSocket has been non-`OPEN` for &gt;3s continuously; hidden immediately on reconnect; suppressed during in-flight staging switch. Mounted above `<MobileShell>` in `App.tsx`. See change: distinguish-offline-from-network-denied — new props networkDenied + onOpenServers; renders distinct "Network not allowed" amber surface (server hint + Settings → Servers affordance) immediately on a guard 403, takes precedence over offline banner; transport drop keeps Disconnected/Retrying.
