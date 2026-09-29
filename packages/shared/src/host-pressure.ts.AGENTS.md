# host-pressure.ts — index

Host-pressure thresholds, ONE source of truth. Exports `HOST_PRESSURE_DEGRADED_MS` (35_000), `HOST_PRESSURE_UNRESPONSIVE_MS` (60_000). Server `host-pressure-tracker.ts` FIRES on them; `SessionCard.tsx` escalates degraded → unresponsive BETWEEN transitions on them. Both re-export, neither redefines — a private copy drifts and the card escalates ahead of or behind the server. See change: fix-false-unresponsive-badge.
