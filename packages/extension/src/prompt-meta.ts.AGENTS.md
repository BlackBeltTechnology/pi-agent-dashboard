# prompt-meta.ts — index

`buildPromptMeta(opts, explicitMessage?)` — dialog `metadata`: `message`, `toolCallId`, plus validated `opts.pluginMeta` → `metadata.plugin` (plain object, JSON-serializable, ≤ 2048 UTF-8 bytes; else dropped with a warning, prompt still raised; never overrides core keys, never sets top-level `kind`). `sanitizePluginMeta`, `PLUGIN_META_MAX_BYTES`. See change: add-browser-editor-pane-tab.
