# research/neutral-shell-deploy-and-pairing-durability.md — index

Research artifact. Explore-mode, no change / no impl. Test shell at pi-dashboard.dev/app/: no release needed — site deploy independent of npm/Electron; stale `site/package-lock.json` blocks `Deploy Site`. Secure-context rule by design (D4); keyring `urls[]` go stale → misleading identity error; tailscale serve header check measured, no loopback bypass; stable https via reserved zrok name or tailnet HTTPS + MagicDNS `publicBaseUrls`. → see `research/neutral-shell-deploy-and-pairing-durability.md.AGENTS.md`
