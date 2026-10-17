# DOX — packages/client/src/components/settings/services

Settings → Services (All services, per-service detail, Runtimes). Instant-apply: registers no Save Bar draft. Data via `hooks/useServices` (list refetch on `services_changed`/reconnect only).

| File | Purpose |
|------|---------|
| `AddServiceDialog.tsx` | Choose offer / paste JSON → dry-run review → Confirm; prefetch = separate unchecked option; validation errors one per line (`service-add-errors`). See change: add-services-settings-ui. |
| `RuntimesPage.tsx` | `GET /api/services/runtimes` table: installed/version/reachable/host VM + capability matrix; read-only (only Refresh). See change: add-services-settings-ui. |
| `ServiceDetailPage.tsx` | Detail at `/settings/services/<id>`: why-callout (reason, hint, `tried`, retry countdown), `ActionBar` per `actionsFor`, lease holders as text, update diff + apply, secrets, logs, danger zone. Probing `GET /:id` only on open + Refresh. Refusal shown inline (`ActionFailure`). See change: add-services-settings-ui. |
| `ServiceDialogs.tsx` | `RemoveDialog` (unchecked purge, names volumes), `ResetDataDialog` (typed id), `ForceStopDialog` (explains override), `PruneDialog` (dry-run → exact previewed ids → skipped), `VolumeReport`. See change: add-services-settings-ui. |
| `ServiceLogsPanel.tsx` | Tail 200/500/2000, load/refresh on demand, text-only lines, `«secret:…»` marks, stale label, reason sentences + secret link; no request when `canOperate` false. See change: add-services-settings-ui. |
| `ServiceSecretsSection.tsx` | Write-only password input for `store:` secrets (cleared at submit), read-only ref for others; `secretInputId`. See change: add-services-settings-ui. |
| `ServicesListPage.tsx` | Grouped list (Needs attention/Running/Stopped + counts), corrupt banners, empty state, add + prune entry points; `useTicker` for the retry countdown. See change: add-services-settings-ui. |
| `ServicesPages.tsx` | Entry: `services` → list or detail (unknown id → list + notice), `runtimes` → `RuntimesPage`. See change: add-services-settings-ui. |
| `services-ui.tsx` | `StatePill`, `Chip`, `ServicesOperateCallout` (banner/inline, fixed remedy copy), `ActionFailure`, `SectionTitle`. See change: add-services-settings-ui. |
| `__tests__/ServicesPages.test.tsx` | L1: list grouping, gating render, inline errors (X10/X11), read-only (F12), secrets (F9), logs (F13), dialogs (F10/F11), add flow (F7/F8), runtimes (X13), F16 colour-literal scan. |
| `__tests__/services-fixtures.ts` | `makeService`, `makeList`, `stubServicesFetch`, `fakeServices`. |
| `__tests__/services-model.test.ts` | E33 gating table + invariants, E34 grouping. |
| `__tests__/services-settings-panel.test.tsx` | E32 route parse, nav group + attention dot, E35 Save Bar exemption. |
