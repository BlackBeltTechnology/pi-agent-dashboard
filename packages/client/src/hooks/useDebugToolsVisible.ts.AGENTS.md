# useDebugToolsVisible.ts — index

Deprecated shim over `useDisplayPrefs().debugTools`. Exports `DEBUG_TOOL_NAMES` set + `isDebugTool(toolName)`. `useDebugToolsVisible()` returns `[boolean, setter]`; setter PATCHes `/api/preferences/display` `{ debugTools }` and strips legacy `show-debug-tools` localStorage key.
