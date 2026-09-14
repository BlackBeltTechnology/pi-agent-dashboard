# mcp-client-settings-a11y.spec.ts — index

L3 accessibility floor for the mcp-client settings section (change: extract-mcp-client-plugin, task 7.7). Injects `axe-core` from the workspace tree and asserts no serious/critical violation in `[data-testid="mcp-settings"]` (`color-contrast` off — `severity-contrast.spec.ts` owns the repo's 3:1 floor), then checks every control's hit area is >=44x44 at 390px. Rewrites `/api/plugins` to report the plugin loaded and fixtures `/api/mcp-client/{effective,schema}` (the real schema, read off disk).
