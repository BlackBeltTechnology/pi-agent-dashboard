# ui-modules.ts — index

Extension UI system bridge side. Exports `refreshUiModules`, `subscribeUiInvalidate`, `handleUiManagement`, `INVALIDATE_RATE_CAP_PER_SEC`, `UiModulesBridgeCtx`, `UiManagementInbound`. Synchronous `ui:list-modules` probe → `ui_modules_list` + `ext_ui_decorator` messages. Last-write-wins dedup. 20/sec `ui:invalidate` throttle. `ui_management` re-emit with `_reply` → `ui_data_list`.
