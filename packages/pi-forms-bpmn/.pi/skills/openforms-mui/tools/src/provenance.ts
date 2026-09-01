/**
 * Single source of truth for upstream provenance.
 *
 * OpenForms is re-implemented here from its published `SCHEMA_REFERENCE.md` and
 * observed semantics; no upstream renderer or builder source is copied into this
 * skill. This constant is consumed by both the attribution text in `SKILL.md`
 * tooling and the preview harness `--reference` mode, so the pinned version is
 * declared exactly once.
 */
export const UPSTREAM_PROVENANCE = {
  /** Upstream GitHub repository the schema contract is derived from. */
  repository: "henriquefps/open-forms",
  /** Pinned reference version. `--reference` mode loads exactly this tag. */
  version: "1.0.7",
  /** Upstream licence. No upstream source is vendored; this is attribution only. */
  license: "Apache-2.0",
  /** jsDelivr base used by `--reference` mode to load the vanilla renderer. */
  referenceCdnBase: "https://cdn.jsdelivr.net/gh/henriquefps/open-forms@1.0.7",
} as const;

export type UpstreamProvenance = typeof UPSTREAM_PROVENANCE;
