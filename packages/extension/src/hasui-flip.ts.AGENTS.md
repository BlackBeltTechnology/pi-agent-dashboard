# hasui-flip.ts — index

Flip `ctx.hasUI` to `true` after bridge patches `ctx.ui.*`. Exports `flipHasUI`. Defensive try/catch for frozen/future non-writable ctx; null ctx no-op. Caller captures original value first (source-detector needs it).
