# blackhole-session-pipeline.spec.ts — index

L3 (add-blackhole-session-pipeline, F9; task 7.0). pi-blackhole NOT installed in harness: probes `/api/plugins/blackhole/status` → `{installed:false}` (meaningful negative), then asserts zero MEMORY subcards / zero `bh-memory-*` DOM on all session cards. Port from harness config, never hardcoded.
