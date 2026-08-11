# notify.ts — index

`normalizeNotifyLevel(level)` — maps an unrecognized notify level to `"info"`. Shared by the bridge send site (`notify-proxy.ts`) and the server's legacy-shape guard (`fromLegacyPromptRequest`), because an already-published bridge forwards pi's `level` as an unvalidated string. See change: split-notify-from-prompt-request.
