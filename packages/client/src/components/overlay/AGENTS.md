# DOX — packages/client/src/components/overlay

Route-backed overlay container. See change: add-route-backed-overlay-dialogs.

| File | Purpose |
|------|---------|
| `RouteBackedOverlay.tsx` | Route-backed overlay container (design D1 option C). Renders the overlay in the shared `Dialog` and the launching surface as a pinned underlay: a nested wouter `<Router>` whose `hook`+`searchHook` come from `memoryLocation({path, searchPath, static:true})`, so the underlay derives from a FROZEN location and never from `window.location`. Both location halves are pinned (three converted routes carry query strings). `static:true` blocks navigation out from under the overlay. Underlay is `aria-hidden` + `inert`; `useMemo` on `(path, search)` keeps it from remounting on in-overlay navigation, preserving scroll. Focus trap / Escape / backdrop / ✕ come from `Dialog`, not reimplemented. Exports `RouteBackedOverlay`. |
