# DOX — packages/client/src/components/editor-pane/live

Files in this directory. One row per source file. See change: improve-canvas-html-and-url-ux.

| File | Purpose |
|------|---------|
| `EgressBanner.tsx` | Non-modal blocked-origin banner (`egress-banner`, `role=status`). Rows: source label, shared-host warning, Allow once / Allow for this project (markup+prompting only) / none (ungrantable); prompts-off footnote; scan-incomplete note; allowed-once pills. |
| `LiveFrame.tsx` | Framed preview shared by `LiveServerViewer` + `HtmlPreview`. Composes header, notices, banner, sandboxed iframe (`sandboxFor(policy)`, never `allow-same-origin`/`srcdoc`). `FramedTarget` = port|static. |
| `LiveFrameParts.tsx` | Presentational parts: `InfoNote`, `ModeToggle`, `OpenControl`, `UpdatedNotice`, `ExposedNotice` (`live-run-scripts`), `RootAbsoluteHint`, `AddressConfirm`, `InlineError`. |
| `LiveHeader.tsx` | Header row: back, root chip + `live-address` form, Restricted pill, reload, Scripts⇄Static, Open. |
| `TargetPicker.tsx` | Picker: active canvas target → added by you → collapsed Older targets (N) + confirmed Clear all; ✕ remove; add form (`live-url`/`live-label`/`live-confirm`). |
| `useAddressBar.ts` | Address bar state via `classifyAddress` (shared `validateAddressPath`): same→re-point, other loopback→inline confirm, else error. |
| `useEgressReport.ts` | Polls `GET /:id/egress` 2 s while visible+restricted, stops after 30 s unchanged; `once` mode for open static; `restart()`. |
| `useFramePolicy.ts` | Wanted policy (provenance, Scripts toggle, exposure, Run scripts epoch) + capability under it. |
| `useLiveCapability.ts` | Mint with policy on every mint; reuse per (target,egress,scripts,epoch); re-mint 10 min before expiry; keepalive `touch` every 5 min while mounted+visible; failed touch → policy re-read + re-mint. |
| `useOpenExternal.ts` | Open ↗ for capability previews: fresh mint, window opened synchronously then navigated. |
