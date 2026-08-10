# ModelSelector.tsx — index

Variant C: grouped by provider, pinned ★ Favorites group, per-row star toggle, capability badges (🧠/👁 catalog-confirmed, 👁?/🧠? fallback, none when metadataSource absent), context badge, favs-only filter, provider filter persisted to localStorage (modelselector.providerFilter/favOnly). See change: enrich-model-selector-capabilities-favorites. See change: fix-popover-viewport-flip — replaces hand-rolled static flip with usePopoverFlip; behavior parity. See change: refresh-model-selector-models — optional onRefresh prop; footer refresh button (mdiRefresh, data-testid model-refresh) renders only when onRefresh set; refreshing state disables control, clears on models prop identity change or 10s safety timeout. See change: fix-and-prefer-model-proxy-resolution — optional `placeholder?: string` prop; trigger shows `current ?? placeholder ?? "no model"` (used by ModelProxySection "＋ Add model").

See change: fix-popover-container-clip — ModelSelector opts into the horizontal axis left-preserving: `boundaryRef` + `estimatedWidth:320` + `minContentWidth:280` + `preferredAnchor:"left"`; removed hardcoded `width:20rem`, drives `width:min(320,maxWidth)` + `anchorRight` class.

## fix-popover-pane-bounded-height

- Applies BOTH `minHeight` and `maxHeight` from `usePopoverFlip` (`style={{ width, maxHeight, minHeight }}`). `maxHeight` is the pane-measured bound; `minHeight` the floor capped by it.
- Opts into `minPopoverHeight: LIST_POPOVER_MIN_HEIGHT` (260) — the list filters as you type, so without a generous floor it collapses to a sliver.
- Height is content-driven BY CSS: outer `flex flex-col overflow-hidden` box carries both bounds, inner list keeps `flex-1 min-h-0 overflow-y-auto`. No JS content measurement.
