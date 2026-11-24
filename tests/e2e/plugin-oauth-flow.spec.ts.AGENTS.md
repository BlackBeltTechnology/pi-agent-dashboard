# plugin-oauth-flow.spec.ts — index

L3 demo-plugin seams, unmocked: F1 start → auth link + paste `ok` → `complete`, `signed in`, `demo-account` in container `plugin-credentials.json`; F2 cancel → `Cancelled`, restart works; X13 `[[faux:demo-echo]]` → expanded tool step shows `echo: hi`. Settings at `/settings/plugins/demo`. See change: expose-plugin-credential-and-oauth-seams.

Adds `google connect dialog (L3)` (A59 keeps waiting, B21 return-page sign-in via fixture return page + tunnel-like route, B22 closed window, B16 paste fallback per path, B32 foreign-origin messages really delivered then ignored, B39 no restricted scope on the remote built-in). See change: add-google-connect.
