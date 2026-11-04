# __tests__/ship-it-codeql-wiring.test.ts — index

Static wiring guard (#E30): `ship-it` step 4.4 lists the CodeQL baseline-diff check; step 4.4b sits between 4.4 and 4.5 and documents prune/accept/ask_user/`--no-growth`/`SHIP_IT_BLOCKED.md`/retry-abort/revert-abort. See change: add-local-codeql-ratchet. #E17/#E18: 4.4b `operator-authz` preset is a gate template (`gate: <symbol>`), canned "can already spawn shell-capable" absent from every file under `.pi/skills/ship-it`. See change: fix-codeql-baseline-coverage.
