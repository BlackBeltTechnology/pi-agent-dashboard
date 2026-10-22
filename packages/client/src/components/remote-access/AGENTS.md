# DOX — packages/client/src/components/remote-access

**Remote access** dialog: status landing + four scenario wizards over one step engine (`lib/remote-access`). Replaces the tabbed Gateway dialog. Step bodies reuse the Gateway sections the Settings page composes. See change: add-remote-access-wizard.

| File | Purpose |
|------|---------|
| `__tests__/RemoteAccessDialog.test.tsx` | Landing, fold/re-open, exposure copy order, provider write rules, transport per endpoint, refusals, pinned bind, approve outcomes. |
| `__tests__/connect-machine.test.tsx` | Which machine / reach / ask / finish: browser tab (`noopener`, unverified), desktop knock identity, remove-only-if-created. |
| `__tests__/harness.tsx` | Test-only fetch router + dialog renderer. |
| `__tests__/resume.test.tsx` | Resume after restart through `useRemoteAccessIndicator` + the dialog: TTL 119/121s, resolved-host change triggers, key always removed. |
| `ConnectMachine.tsx` | Connect-to-another-machine step bodies + `useConnectMachine` state (held by the dialog). Exports `MachineBody`, `ReachBody`, `AskBody`, `FinishBody`. New-context opens go through `openExternalUrl` (`classifyUrl`; `noopener,noreferrer`). See change: harden-client-sinks. No `known-elsewhere`; `updated` add maps to known on typed address. See change: group-servers-by-identity. |
| `Landing.tsx` | Status landing: roads (loading/unknown/on/off), paired count, waiting callout (`remote-access-review`), open-networks warning, four task entries with plan-derived hints. Exports `Landing`, `taskTitle`, `hintText`. |
| `RemoteAccessDialog.tsx` | Dialog shell. Holds the run, snapshot, readiness-poll gating (provider steps only), qr→approve capture, done-vs-already-set tracking. Root `gateway-dialog`; footer `gateway-done`, error `gateway-dialog-error`. |
| `StepBodies.tsx` | Bodies for provider/install/enable/address/connect/bind/accept/door/road/qr/approve. Listen on network: source check → `PUT bindHost 0.0.0.0` → `saveRun` → restart; refusal/failure leaves no key. |
| `Wizard.tsx` | Renders `planTask` rows: collapsed ✓ rows (re-openable), folds of 2+, one expanded current step. Exports `Wizard`, `stepTitle`. |
| `ra-context.ts` | `StepCtx` handed to every step body. |
| `ra-ui.tsx` | `Callout`, `PrimaryButton`, `SmallButton`, `UnknownNote`, `REFUSED_FALLBACK`. |
