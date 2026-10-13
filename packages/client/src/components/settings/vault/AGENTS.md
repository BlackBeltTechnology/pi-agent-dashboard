# DOX — packages/client/src/components/settings/vault

Settings → Vault page. Never receives a stored value: listings carry ids, labels, names, states.

| File | Purpose |
|------|---------|
| `VaultAccountsPanel.tsx` | Accounts: list (provider/label only), add (password field, cleared on submit), rotate, revoke. See change: add-credential-vault. |
| `VaultBindingsPanel.tsx` | Env bindings (default account), per-project grants (repo or directory, optional account override, `no-account` repair flag), confirmed checkouts (revoke). See change: add-credential-vault. |
| `VaultImportPanel.tsx` | Import: existing known-location candidates (opaque ids) + file upload ≤64 KiB → names-only proposal → confirm. See change: add-credential-vault. |
| `OperateRequiredCallout.tsx` | Info callout (`role="status"`, `aria-busy` while retrying) for an `operate_required` load refusal: fixed copy, one row per recognised remedy in server order (unknown dropped), `/auth/login` link on `sign-in`, single-flight Try again. Ids `vault-operate-{required,remedy,signin,retry}`. See change: surface-operate-required-remedy. |
| `VaultPluginsPanel.tsx` | Plugin approvals for manifest-declared bindings (server-wide, default account). See change: add-credential-vault. |
| `VaultSection.tsx` | Settings → Vault page (Network group, route `vault`): loads `GET /api/vault`, corrupt banner, composes the panels. Renders `OperateRequiredCallout` when load fails `operate_required` with `remedies`, else `vault-error`. Tests: `__tests__/VaultSection.test.tsx`, e2e `vault-settings.spec.ts` (F1, F5). See change: add-credential-vault, surface-operate-required-remedy. |
| `vault-ui.tsx` | Shared panel/error/input class tokens for the vault panels (theme tokens only). See change: add-credential-vault. |
