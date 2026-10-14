/**
 * apple-tools · CLIENT entry (intentionally empty).
 *
 * The only claim — the `AppleToolsSettings` settings-section — loads lazily
 * from `./AppleToolsSettings.tsx` via the manifest `module` field, keeping the
 * settings UI out of the cold-landing chunk. Do NOT re-export it here: the
 * registry generator rejects a main entry that also exports a lazy component.
 *
 * See change: lazy-plugin-claim-modules.
 */
export {};
