# live-server-api.ts — index

Client helper for live-server REST. `listLiveServers()`, `startLiveServer({host,port,label})` (pre-validates via shared `validateLiveTarget` — refuses remote before POST), `removeLiveServer(id)`. See change: improve-content-editor.

## retire-trusted-networks-bypass

`mintLiveCapability(id)` — `POST /api/live-server/:id/capability` → `{ok,path,expiresAt}` (flat response, not under `data`); `path` must match `/live/<id>/~c/<token>/` else refused. Used by `LiveServerViewer`. See change: retire-trusted-networks-bypass.
