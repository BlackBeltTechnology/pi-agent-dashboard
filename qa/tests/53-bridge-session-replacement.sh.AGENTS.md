# 53-bridge-session-replacement.sh — index

L2 smoke (#E31, #1175): spawns `pi --mode rpc -e qa/fixtures/faux-provider.ext.ts --model faux/faux-1` in a unique cwd, waits until `GET /api/sessions` (via `pi-dashboard api`) lists its session, sends RPC `new_session` on stdin (pi emits `session_shutdown{reason:"new"}` and loads a fresh ExtensionAPI), asserts a NEW live id registers and the old id is ended/absent within 45 s. Reuses the 10-faux-model.sh server bootstrap. `SKIP:`+exit 0 when pi absent. Registered in `qa/tests/run-all.sh`. See change: fix-session-bridge-registration.
