# repair-meta-source.mjs — index

Removes `source: "dashboard"` from every `~/.pi/agent/sessions/**/*.meta.json`. Atomic tmp+rename. Idempotent. Prints `kept N / cleaned M / errors E`. Exit 0. See change: fix-dashboard-spawn-correlation-by-token.
