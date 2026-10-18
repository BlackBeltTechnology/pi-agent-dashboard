# UI plan — vault reach (approved 2026-10-18)

Board: `reach.html` (13 states). Assets copied from `add-vault-llm-delivery/mockups/`.

Problem: a user who opens their first new folder doesn't know the vault exists, and default-deny gives that folder nothing.

| # | Decision |
|---|---|
| U13 | New grant subject **All my projects** ("reach"): every project on the hub and paired devices, including future folders. It is the preselected default whenever an account or key is added (Providers "another account", "Link to vault", Vault add key). "Only projects I choose" keeps today's per-project grants. The cloned-repository risk is stated next to the choice. |
| U14 | A card with reach "all" shows one "All my projects" line (devices and number of projects using it) plus **exceptions** only: another account for a project, or turned off. Widening to "all" needs a confirmation that lists the impact; narrowing doesn't. |
| U15 | **Missing-credential offer in the session.** When a session's model provider has no credential on that device (no local login and no vault delivery) and the vault holds a matching account, a session banner (the `MissingRequiredBanner` slot) offers "Use in all my projects" (primary) / "Only in <project>" / "Not now". It is also shown inline under pi's "No API key" error. With several accounts, the user picks one. With none, it points to adding a login. A viewer without operate authority gets an explanation instead. After choosing, it confirms with Undo. It never appears where a local login exists. |
| U16 | Chip dialog rows say where access comes from ("From All my projects" or "Granted to this project") and offer "Turn off here", which creates the opt-out exception. |

Probes: 0 / 0 / 0 in base dark, base light and nord dark at 375 and 1440.
