/**
 * chat-gateway · CLIENT entry (intentionally empty).
 *
 * The only claim — the `ChatGatewaySettings` settings-section — loads lazily
 * from `./ChatGatewaySettings.tsx` via the manifest `module` field. Do NOT
 * re-export it here: the registry generator rejects a main entry that also
 * exports a lazy component.
 *
 * See change: lazy-plugin-claim-modules.
 */
export {};
