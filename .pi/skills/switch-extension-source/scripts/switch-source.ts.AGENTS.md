# switch-extension-source/scripts/switch-source.ts — index

Toggle script. Commands: status \| local <pkg> [--overlay] \| npm <pkg>. <pkg> = monorepo dir or npm name. Handles mixed string/object package entries; reports structured targets and refuses to drop their filters. Purges versioned/unversioned npm strings plus local paths from any checkout by package identity, backs up `*.bak-switch-*`, validates JSON. Skips dashboard-managed bridge plugins. See change: fix-reliable-live-control-events.
