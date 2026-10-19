## ADDED Requirements

### Requirement: TLS solver accounts
The vault SHALL hold DNS-01 solver secrets of ACME certificate sources as accounts of kind `tls-solver` (not `key`) in the namespace `tls:<sourceId>`, with provider `cloudflare` or `acme-dns` and a label naming the field (`cloudflareToken`, `acmeDnsUser`, `acmeDnsKey`). `(namespace, label)` SHALL be unique; writing an existing pair SHALL rotate that account. These accounts SHALL be created, rotated and deleted only by the ACME certificate source and its credential route, under the same lock, file and minimum-length rules as every other account. Because they are not `key` accounts, they SHALL NOT be accepted as the default or override of an env binding, SHALL NOT be delivered to pi sessions, managed services or plugins, and SHALL NOT be rotated or revoked through the vault's generic account routes. The vault page's Accounts tab SHALL list them under a "TLS certificates" group with names only, SHALL state the Gateway source that uses each, SHALL offer no rotate or revoke action, and SHALL link to the Gateway page.

#### Scenario: Solver secret stored as a vault account
- **WHEN** the operator saves a Cloudflare token for ACME source `home`
- **THEN** the vault SHALL contain one `tls-solver` account with namespace `tls:home`, provider `cloudflare` and label `cloudflareToken`
- **AND** `config.json` SHALL contain no token

#### Scenario: Re-saving rotates instead of duplicating
- **WHEN** a new token is saved for source `home` that already has one
- **THEN** the vault SHALL still contain exactly one `tls:home` / `cloudflareToken` account, holding the new value

#### Scenario: TLS accounts cannot back a binding
- **WHEN** a caller tries to set a `tls:home` account as the default of an env binding
- **THEN** the request SHALL be refused and the binding SHALL be unchanged

#### Scenario: Generic rotate route refuses TLS accounts
- **WHEN** a caller with `operate` authority calls the vault's account value route for the `tls:home` / `cloudflareToken` account
- **THEN** the request SHALL be refused and the account SHALL be unchanged

#### Scenario: Generic revoke route refuses TLS accounts
- **WHEN** a caller with `operate` authority calls the vault's account revoke route for the `tls:home` / `cloudflareToken` account
- **THEN** the request SHALL be refused and the account SHALL be unchanged

#### Scenario: Vault page lists TLS accounts by name only
- **WHEN** the vault page is opened while source `home` has a saved Cloudflare token
- **THEN** a "TLS certificates" group SHALL list `home` / `cloudflareToken` with no value and no rotate or delete action, and a link to the Gateway page

## MODIFIED Requirements

### Requirement: Account rotation and revocation
The user SHALL be able to replace an account's value (rotate) and to revoke an account, except `tls-solver` accounts, which are rotated and deleted only through the ACME certificate source (see "TLS solver accounts"). Rotation and revocation SHALL be propagated to sessions that hold an affected binding (see `credential-delivery`).

When an account is revoked:
- every binding using it as default SHALL be left with no default;
- every grant naming it as an override SHALL be kept, marked `no-account`, and deliver nothing.

A grant SHALL NEVER fall back to the binding's default when its override account is revoked. A binding or grant left with no account SHALL deliver nothing and SHALL be listed for repair.

#### Scenario: Revoking an override account does not fall back
- **WHEN** the grant for project `github.com/acme/app` overrides `GEMINI_API_KEY` with account "work", and the user revokes "work"
- **THEN** that project receives no `GEMINI_API_KEY`, not the default account's value
- **AND** the grant is listed as `no-account`

#### Scenario: Revoking the account of a binding
- **WHEN** the user revokes the default account of `SONIOX_API_KEY`, which no grant overrides
- **THEN** the binding delivers nothing
- **AND** sessions that held it are told to withdraw it

#### Scenario: TLS solver account cannot be revoked from the vault page
- **WHEN** the user tries to revoke the `tls:home` / `cloudflareToken` account through the vault
- **THEN** the request SHALL be refused and the account SHALL be unchanged
