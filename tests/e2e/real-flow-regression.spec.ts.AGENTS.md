# real-flow-regression.spec.ts — index

L3 spec (change: add-flow-plugin-e2e-tests, D5 follow-up). OPT-IN real-flow regression: skipped unless `PI_E2E_REAL_FLOW=<flow-name>` set (real flow + its agents baked under docker/fixtures/sample-git/.pi/flows/, agent models on a role the faux preset maps to faux/faux-1). Mirrors flow-roundtrip: gate → pick flow → agents render → terminal state. Keeps the managed run green until a real flow is wired.
