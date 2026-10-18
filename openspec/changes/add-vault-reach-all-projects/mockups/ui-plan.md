# UI plan — vault reach (approved 2026-10-18)

Board: `reach.html` (20 states). Assets copied from `add-vault-llm-delivery/mockups/`.

Problem: a user who opens their first new folder doesn't know the vault exists, and default-deny gives that folder nothing.

| # | Decision |
|---|---|
| U13 | New grant subject **All my projects** ("reach"): every project on the hub, including future folders. Paired devices get it once remote delivery is on (`prove-vault-bridge-tls`); until then a paired session explains why it gets nothing. Imported keys start as "Only projects I choose" with a widen link on the Import done step. It is the preselected default whenever an account or key is added (Providers "another account", "Link to vault", Vault add key). "Only projects I choose" keeps today's per-project grants. The cloned-repository risk is stated next to the choice. |
| U14 | A card with reach "all" shows one "All my projects" line (devices and number of projects using it) plus **exceptions** only: another account for a project, or turned off. Widening to "all" needs a confirmation that lists the impact; narrowing doesn't. |
| U15 | **Missing-credential offer in the session.** When a session's model provider has no credential on that device (no local login and no vault delivery) and the vault holds a matching account, a session-detail notice above the chat (its own component, not the `MissingRequiredBanner` slot) offers "Use in all my projects" (primary) / "Only in <project>" / "Not now". It is also shown inline under pi's "No API key" error. With several accounts, the user picks one. With none, it points to adding a login. A viewer without operate authority gets an explanation instead. After choosing, it confirms with Undo. It never appears where a local login exists. "Not now" re-arms only when the session reports a different provider. A pool is offered as-is (named, order and failover unchanged). If the project has an exception for that provider, the notice offers to repair it instead. |
| U16 | Chip dialog rows say where access comes from ("From All my projects" or "Granted to this project") and offer "Turn off here", which creates the opt-out exception. |
| U17 | Pairing approval lists reach bindings by name, worded for whether remote delivery is on; if the vault can't be read it says "Vault unavailable" and approval stays enabled. |

Probes: 0 / 0 / 0 in base dark, base light and nord dark at 375 and 1440.
