# access.ts — index

Owner rule: `createAccess(identity)` → `canViewTeam`/`canControlTeam` (same predicate; identity absent/not enforced ⇒ allow; enforced: no principal ⇒ no, issuer `LOCAL_OPERATOR_ISSUER` ⇒ yes, else `Team.owner === ownerKeyOf({iss,sub})`, ownerless ⇒ operator only). Module-level `canViewTeam`/`canControlTeam` delegate to `activateAccess(...)` (registered with core's `setRouteVisibility`; reused by later team routes). Throws propagate: the routes fail closed + log. Core records the key (`shared/owner-key.ts`). See change: add-agent-teams-ui.
