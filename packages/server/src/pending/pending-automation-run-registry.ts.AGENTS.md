# pending-automation-run-registry.ts — index

FIFO-per-cwd registry of automation-run stamps {name,runId,visibility}. Enqueued by automation-plugin spawn hook; consumed in event-wiring onSessionRegistered to stamp kind="automation"+automationRun + persist .meta.json. TTL 60s, cap 8. See change: add-automation-plugin.

Claim is spawn-token-exact: `bindToken(cwd,runId,spawnToken)` after spawn resolves; `consume(cwd,spawnToken?)` = exact-token match, else oldest UNBOUND entry, else null. A token-bound stamp is never claimable by a foreign/tokenless register. Plain cwd-FIFO let one plugin's session claim another plugin's runId in a shared cwd; the owner then never correlated the run and never delivered the action, wedging it `running` until the max-age reaper. See change: fix-automation-stamp-correlation.
