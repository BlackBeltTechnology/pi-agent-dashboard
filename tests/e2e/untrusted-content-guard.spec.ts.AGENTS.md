# untrusted-content-guard.spec.ts — index

L3 #F1 (change: add-untrusted-content-guard): `[[faux:guard-confirm]]` → `stub_fetch` untrusted HTML → guard confirm card before `bash` (title `Untrusted content guard`, names `stub_fetch`); Yes → bash output `guard-42`; result shows `[guard] 1 hidden span removed`, hidden payload never rendered. Expands the `2 tool calls` group + both cards. Needs `PI_E2E_SEED=1`.
