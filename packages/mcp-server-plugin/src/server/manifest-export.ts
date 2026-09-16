/**
 * Public manifest surface for the server-side completeness/invariants tests
 * (change: expand-mcp-tiered-surface, D6). Re-exports the reviewed manifest,
 * the denylist and the generated tool rows without pulling in the plugin's
 * runtime entry.
 */
export { GENERATED_TOOLS, type GeneratedTool } from "./generated/tools.js";
export {
  ALL_CONTEXT_MEMBERS,
  ALLOWLISTED_CONTEXT_MEMBERS,
  DENIED_CONTEXT_MEMBERS,
  INTERNAL_ONLY_CONTEXT_MEMBERS,
} from "./tools.js";
export { isDenylisted, DENYLIST, type DenylistEntry } from "./tools.denylist.js";
export { MANIFEST, type ToolRow } from "./tools.manifest.js";
