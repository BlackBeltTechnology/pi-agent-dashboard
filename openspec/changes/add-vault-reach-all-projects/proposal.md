## Why

The vault is deny-by-default per project: a folder gets nothing until it is granted, and a folder grant doesn't cover subfolders. A user who opens their first new directory doesn't know the vault exists. On a device without its own login, the session then fails with pi's "No API key" error, and nothing points to the fix.

## What Changes

- **Reach "All my projects".** A new grant subject, alongside project keys and the `service:<id>` subjects of `absorb-service-secrets-into-vault`. A binding with this reach is delivered to every project of a trusted session, including folders opened later. **Hub-first:** remote vault delivery is off today (the hub can't prove bridge TLS), so paired devices are reached once the prerequisite `prove-vault-bridge-tls` lands, with no further change here. **BREAKING (default only):** the shipped rule "a project with no grant receives nothing" becomes "unless the binding's reach is All my projects". Existing bindings keep their grants and stay "Only projects I choose".
- **Reach chosen once, when an account is added.** "Who can use it" is preselected to All my projects in Providers → "Another account", in "Link to vault", and in Vault → "Add key". The risk is stated next to the choice: a repository cloned from someone else is a project too. "Only projects I choose" keeps today's per-project grants.
- **Exceptions.** For a binding with reach All my projects, a project can use another account (single bindings only) or have the binding turned off. An explicit project grant always wins, even while it waits for a confirmation. A turned-off project stays off when its git remote changes. The card lists only these exceptions. Widening a binding to All my projects asks for confirmation; narrowing doesn't.
- **No checkout confirmation under All my projects.** It reaches a repository's checkouts without a per-checkout confirmation; that is what the user accepts with this reach. Per-project repository grants keep their confirmation.
- **Missing-credential offer in the session.** It appears when a session's model provider has no credential on that device and the vault holds a matching account:
  - It appears when pi would refuse the session's model for lack of a credential. Delivery must be enabled.
  - The session view offers "Use in all my projects" (primary), "Only in <project>" or "Not now", at session start and under pi's "No API key" error. The offer states the reached devices and the cloned-repository risk before its primary action, and an existing binding keeps its default.
  - With several matching accounts, the user picks one. With none, it points to adding a login.
  - A viewer without operate authority gets an explanation instead.
  - After a choice, a confirmation with Undo is shown.
  - The offer never appears where a local login exists.
- **Session chip.** Each row says where access comes from ("From All my projects" or "Granted to this project") and offers "Turn off here".
- **Applies to `env` and `llm` bindings alike,** through the same per-target checks as grants. It never applies to `service:<id>` reads. Local credentials still win (`local-override`).
- **Pairing discloses the reach.** The device approval dialog lists the bindings a newly paired device will get.

## Capabilities

### New Capabilities
- `vault-reach`: the All-my-projects subject, exceptions (account override, opt-out), the reach choice when an account is added, and the missing-credential offer in the session.

### Modified Capabilities
- `credential-vault`: "Per-project grants, default deny" gains the reach branch (written on top of `add-vault-llm-delivery`'s delta). "Checkout confirmation for repository grants" does not apply under All my projects. The card display is an ADDED `vault-reach` requirement.
- `credential-delivery`: "Delivery only to granted sessions on trusted devices" also admits reach-delivered bindings; the trust gate is unchanged.

## Impact

- **Server.**
  - Vault store: the `all` grant subject and a `reachExclusions` array; no migration.
  - Grant resolution in snapshot building.
  - Missing-credential detection: the bridge reports the active model's provider has no credential; the hub answers with the matching vault accounts (names only).
  - Routes for reach changes, exceptions and the offer actions, all under the foundation's operate authority (D6).
- **Bridge.** Report "no credential for provider X" at `session_start` and on a no-API-key failure. Apply the delivered binding without a restart.
- **Client.** The reach control (shared), the reach line and exceptions on the card, a session-scoped banner at the top of the session view with an inline offer, the chip-row source with "Turn off here", and the pairing disclosure.
- **Mockup.** Approved 2026-10-18: `mockups/reach.html` (13 states), with decisions U13–U16 in `mockups/ui-plan.md`. Probes: 0 contrast / size / focus failures in base dark, base light and nord dark at 375 and 1440.
- **Security.**
  - All my projects widens access to every project of trusted sessions: code run in any reached checkout, including a cloned repository, can use the credential. Mitigations: the explicit choice and its warning, per-project opt-out, local precedence, the widening confirmation, and `proxy` delivery for immediate revocation.
  - It deliberately voids the shipped "Spoofed origin in an unconfirmed checkout" protection for reached bindings; it stays for project grants.
  - `key` accounts are copied into every reached session; only `lease` / `proxy` keep the secret on the hub.
  - Paired devices only; pairing revocation withdraws access within the 5-second propagation bound.
- **Compatibility and rollback.**
  - Additive for existing data (`chosen` reach).
  - Older bridges see ordinary snapshots.
  - Rollback: set every binding to `chosen`, which restores default-deny.
- **Order.** Archive after `add-vault-llm-delivery`, which carries `llm` bindings, the Providers integration, and the `credential-vault` text this delta builds on. Remote reach needs `prove-vault-bridge-tls`.

## Discipline Skills

- `security-hardening`: widening default delivery, the cloned-repository risk, offer authority.
- `doubt-driven-review`: before changing the shipped default-deny requirement (irreversible semantics).
- `observability-instrumentation`: reach changes, exceptions and offer accept/decline events (names only).
- `systematic-debugging`: none expected; listed for the missing-credential detection spike if pi's error surface differs on 1.0.0.
