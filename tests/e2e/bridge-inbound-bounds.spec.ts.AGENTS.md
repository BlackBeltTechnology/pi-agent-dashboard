# bridge-inbound-bounds.spec.ts — index

Browser E2E (#BF2): fill every per-session bash slot (default `PI_DASHBOARD_BRIDGE_MAX_BASH` 4) with slow `!!` commands; one more is refused inline ("bash concurrency limit reached"), no stuck pending bubble; after a slot frees the next `!!` runs and renders. `!!` never reaches the LLM, so no credential needed. See change: harden-bridge-inbound-and-discovery.
