# DOX — packages/client/src/components/extension-ui

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `AgentMetricSlot.tsx` | Re-export shim. Forwards `@blackbelt-technology/pi-dashboard-client-utils/extension-ui/AgentMetricSlot`. Symbol migrated in change `complete-flows-plugin-migration` (Layer 0). |
| `BreadcrumbSlot.tsx` | Re-export shim. Forwards `@blackbelt-technology/pi-dashboard-client-utils/extension-ui/BreadcrumbSlot`. Symbol migrated in change `complete-flows-plugin-migration` (Layer 0). |
| `decorator-utils.ts` | Re-export shim. Forwards `@blackbelt-technology/pi-dashboard-client-utils/extension-ui/decorator-utils`. Exports `decoratorsOfKind` helper. Symbol migrated in change `complete-flows-plugin-migration` (Layer 0). |
| `FooterSegmentSlot.tsx` | Phase-2 `footer-segment` slot. Renders `kind: "footer-segment"` decorators as inline pills in `SessionHeader`. Exports `FooterSegmentSlot`. Uses `decoratorsOfKind`, `resolveMdiIcon`. |
| `GateSlot.tsx` | Re-export shim. Forwards `@blackbelt-technology/pi-dashboard-client-utils/extension-ui/GateSlot`. Symbol migrated in change `complete-flows-plugin-migration` (Layer 0). |
| `GenericExtensionDialog.tsx` | Phase-1 modal renderer for Extension UI System. Renders `ExtensionUiModule` whose `view.kind` is `"table" \| "grid" \| "form"`. Exports `GenericExtensionDialog`. Mount dispatches `ui_management { action: "list" }` for table/grid. Actions gate `confirm` behind `Confirm` dialog. IO-via-dispatcher, no direct WebSocket. Helpers: `getDeep`, `getRowKey`, `formatCell`, `withRowParams`. |
| `ToastSlot.tsx` | Phase-2 `toast` slot. Mounts fixed top-right tray rendering `kind: "toast"` decorators across all sessions. Exports `ToastSlot`. No dedup. Auto-dismiss via `payload.durationMs` (default 5000, `0` = sticky). Display cap 5 with FIFO eviction. Level icons + classes for info/success/warn/error. |
