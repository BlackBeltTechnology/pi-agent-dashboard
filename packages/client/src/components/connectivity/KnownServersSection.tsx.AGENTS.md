# KnownServersSection.tsx — index

Settings section managing persisted known remote servers. Lists `KnownServer` rows with remove; inline add form (host/port/label). Backed by `listKnownServers`/`addKnownServer`/`removeKnownServer`. Exports `KnownServersSection`. Uses `listKnownServersWithAccess`: `canManage:false` → read-only list (no add/remove/Update); entries with `movedTo` show the suggested address + Update (`acceptKnownServerMove`). See change: stabilize-mdns-server-identity.
