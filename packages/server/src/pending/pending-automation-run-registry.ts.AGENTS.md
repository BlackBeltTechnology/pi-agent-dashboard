# pending-automation-run-registry.ts — index

FIFO-per-cwd registry of automation-run stamps {name,runId,visibility}. Enqueued by automation-plugin spawn hook; consumed in event-wiring onSessionRegistered to stamp kind="automation"+automationRun + persist .meta.json. TTL 60s, cap 8. See change: add-automation-plugin.
