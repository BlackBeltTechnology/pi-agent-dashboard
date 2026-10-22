# identity-auth-plugin-guide.md — index

Build a dashboard auth plugin. Three-way split (core seam / keycloak-resolver / your plugin); login separate-view kind + descriptor/tokenUrl/handoff; optional custom resolver; host access policy (default-deny, action families, road gate, WS gate, timeout) + `GET /api/identity/me`; product authz; break-glass; testing. → see `identity-auth-plugin-guide.md.AGENTS.md`
