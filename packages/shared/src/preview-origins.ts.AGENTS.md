# preview-origins.ts — index

Pure `liveServer.previewOrigins` parse + overlap validation (D12). `parsePreviewOrigins(raw)`→`{value,issues}` (per-tier drop, normalise), `resolvePreviewOrigins(cfg,ctx)`→tiers/pool/issues, `formatTierSet`, `previewOriginsConfigChanged`. → see `preview-origins.ts.AGENTS.md`
