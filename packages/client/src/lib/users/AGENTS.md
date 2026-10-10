# DOX — packages/client/src/lib/users

Passkey user-directory client helpers. See change: add-passkey-user-auth.

| File | Purpose |
|------|---------|
| `users-api.ts` | `/api/users*` fetch helpers: `listUsers`→`UsersState{enabled,rp{rpId,rpOrigin,stable,reason?},bootstrapRequired,users}`, `createUser`, `setUserTier`, `revokeUser`, `mintInvite`→`MintedInvite{url,qrDataUrl,expiresAt,maxUses}`, `credentialImpact(ImpactQuery)` (`{url}` or `{redirectBaseUrl}`)→`{currentRpId,nextRpId,orphaned,users}`. |
| `users-text.ts` | Pure copy: `unstableReasonText(reason)`, `impactConsequence(impact)` (null when nothing orphaned). i18n keys `users.*`. |
| `__tests__/users-text.test.ts` | Copy helpers. |
