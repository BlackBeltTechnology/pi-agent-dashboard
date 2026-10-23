# network-trust-telemetry.ts — index

In-memory network-only admission counters (`noteNetworkOnlyAdmission`, `networkOnlySnapshot`, `createNetworkTrustTelemetry`). 256-peer LRU, 7 d window, hourly buckets, 1 h per-peer log throttle. Per-request marker `networkOnlyCounted` stops double count. Feeds `/api/health` `trustPosture.networkOnly`: counts only, never IPs. See change: retire-trusted-networks-bypass.
