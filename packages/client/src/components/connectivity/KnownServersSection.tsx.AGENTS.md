# KnownServersSection.tsx — index

Settings section managing persisted known remote servers. Lists `KnownServer` rows with remove; inline add form (host/port/label). Backed by `listKnownServers`/`addKnownServer`/`removeKnownServer`. Exports `KnownServersSection`. Uses `listKnownServersWithAccess`: `canManage:false` → read-only list (no add/remove/Update); entries with `movedTo` show the suggested address + Update (`acceptKnownServerMove`). See change: stabilize-mdns-server-identity. See change: retro-ux-identity-connectivity — contract tokens only; rows = Remote pill + "Verified" severity-success pill on `fingerprint` entries (sr-only description: verified at add time); two-step remove (icon button `aria-label` names target → Confirm remove/Cancel); load failure ⇒ error callout + Retry (never the empty text); remove / move-refusal errors inline on the row; read-only note when `!canManage`; labelled add form (`aria-invalid`/`aria-describedby`). Class recipes from `connectivity-ui.ts`.

## group-servers-by-identity

Merged Settings Servers section (saved + discovered), cards by identity, scan + manual add inside. See change: group-servers-by-identity.
