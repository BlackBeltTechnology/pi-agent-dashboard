/**
 * pi-flows · Anthropic Messages Bridge — dashboard client entry.
 *
 * The `FlowsAnthropicBridgeSettings` settings-section loads lazily from
 * `./FlowsAnthropicBridgeSettings.tsx` via the manifest `module` field. Do NOT
 * re-export it here: the registry generator rejects a main entry that also
 * exports a lazy component.
 *
 * See change: lazy-plugin-claim-modules.
 */
export { catalog } from "./i18n.js";
