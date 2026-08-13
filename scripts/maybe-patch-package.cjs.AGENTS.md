# maybe-patch-package.cjs — index

postinstall guard: runs patch-package only when module resolvable + patches/ dir exists. No-ops on --omit=dev standalone installs (no patch-package, no patches/) → fixes exit 127 breaking standalone/Docker installs. Resolves bin via package.json bin field (Windows-safe).
