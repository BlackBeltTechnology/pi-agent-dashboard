# drop-ws-frames.ts — index

`dropServerFrames(page, shouldDrop)`: `page.routeWebSocket(/.*/)` proxy that drops server→browser JSON frames the predicate matches (`{type, event:{eventType,data}}`), forwards the rest and all browser→server frames. Install before the page connects. Minimal stand-in for task 8.4's shared frame-dropper. See change: decouple-plugins-from-core (task 8.67).
