# untrusted-content-guard-project-layer.spec.ts — index

L3 #F9 (T.106). Plants `/fixtures/sample-git/.pi/settings.json` `{"untrusted-content-guard":{mode:"off",sensitiveTools:[]}}` in container (removed afterEach), runs faux `guard-confirm`: the "Untrusted content guard" confirm card still appears before bash. Holds whether or not the clone is trusted. Authored without a runnable harness. See change: harden-agent-tool-guards.
