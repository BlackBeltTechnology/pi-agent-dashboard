# DOX — packages/system-one-plugin/src/client

Settings section "Decision models (System 1)". Spec: system-one-settings-ui. Approved mockup: `openspec/changes/add-system-one-registry/mockups/` (design D13). Theme-token classes only. See change: add-system-one-registry.

| File | Purpose |
|------|---------|
| `api.ts` | `api` fetch client for `/api/system-one/*` (relative URLs); `ApiError{status, code}` carries the server machine code. Types `Draft` (UI-managed keys), `ConfigResponse`, `BackendView` (server-computed `offMachine`, `egress`, capabilities, `managed`), `ConsumerRow`, `EvalReport`, `ManagedStatus`, `KeyStatus`. |
| `BackendsSection.tsx` | Backend rows: `EgressBadge`, kind line, capabilities (null → "unknown"), managed `StatusLine` (shape + text) + Start/Stop (immediate), write-only `KeyEntry` (password input, clears on save, env-sourced → no input), inline `AddBackend` (managed/http/llm; http/https only). uv-missing / Windows callouts. Remove also strips the id from every chain. |
| `ChainEditor.tsx` | Ordered chain editor adapted from blackhole `ChainEditor`: button reorder, boundary disabled, one-entry chain no remove, accessible names name the backend, focus stays on a moved entry. With `consumer`: incompatible hidden until "show incompatible" (count + warning); off-machine options disabled while switch off. |
| `ConfirmDialog.tsx` | Modal: `role=dialog`, `aria-modal`, labelled title, focus on Cancel, Tab trap, Escape cancels, focus returns to opener. |
| `ConsumersSection.tsx` | Consumer `<details>` rows: declaration + calibration summary, "Use preset" vs "Override" (seeded via `seedOverride`), fail-open + llm warning chip/callout, `TestPanel`. Per-row component `ConsumerItem`. |
| `EgressBadge.tsx` | On-/off-machine badge: icon + words (server egress label); severity-success / severity-warning tokens as second channel only. |
| `index.tsx` | Client barrel: `SystemOneSettings`, `catalog` (names match manifest). |
| `model.ts` | Pure helpers: `unusableReason` (off-machine \| runtime \| not-saved), `isUsable`, `incompatibleWith` (uses `pi-system-one/capabilities`), `seedOverride` (preset chain minus incompatible), `presetChain`, `overrideChain`, `move`, `withPresetChain`, `withOverride`, `sameDraft`. No client-side egress classification. |
| `SystemOneSettings.tsx` | Container. Loads config/keys/consumers; draft of `allowOffMachine`/`backends`/`presets`/`activePreset` registered via `useSettingsDraftSource` id `plugin:system-one`. `commit` PUTs `{config, baseRevision}`; 409 → reject + in-section conflict callout with Reload. `baseRevision` moves only on rebase (explicit reload, clean draft, own save) — background polls never rebase a dirty draft. Off-machine `role=switch`; preset radio cards + no-usable warning with fixes; default `ChainEditor`. Polls every 2 s while a managed backend starts. |
| `TestPanel.tsx` | Per-consumer Test: backend picker (off-machine while off / managed not ready / unsaved disabled with reason), Run/Cancel (AbortController), results table (accuracy, AUC, p50, p90, chars, estimated cost), read-only thresholds, save shadow or enforce (enforce → `ConfirmDialog` naming backend + model, `confirm: true`). Calibration saves immediately. `ResultsTable` renders the report. |
| `__tests__/ChainEditor.test.tsx` | L1: boundary disabled, focus follows moved entry, off-machine option disabled, incompatible hidden → revealed with reason + warning. |
| `__tests__/model.test.ts` | L1: usability, override seeding, chain edits touch only the active preset. |
