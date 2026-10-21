# PiTrustMirrorSection.tsx — index

Settings → Access: mirror switches, effective list, per-entry choice, ignored rows with reason code, pi trust.json entries + agent dir, disclosures. See change: mirror-dashboard-trust-to-pi.

Live rows (`live` + `lifetime`) show lifetime via exported `liveLifetimeLabel`: `restart` → "until dashboard restarts"; `yolo-until` → "YOLO until HH:MM" (viewer locale); `yolo-process` → "YOLO while the server runs". Live rows read-only in entries list (no choice control).
`LiveQueryControls`: `liveQuery` checkbox + `liveQueryTimeoutMs` number input (50–1000, clamped on commit, empty → `null` = default 300 ms local / 1000 ms remote).
`ReasonLegend`: all 18 `MIRROR_WITHHELD_LABELS` codes (`pi-trust-legend`). `yolo` source switch (`SOURCE_LABEL`). New disclosures: live entries / other-machine bridges + server-only counters / npm residual.
See change: mirror-dashboard-trust-live-remote.
