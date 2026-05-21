/**
 * Compatibility shim — re-exports the prompt component registry from
 * `@blackbelt-technology/dashboard-plugin-runtime` so legacy import paths
 * keep working. The real registry moved there so plugins can register
 * component types without crossing the shell boundary.
 *
 * See change: route-flow-asks-to-upper-slot.
 */
export {
  getPromptComponentInfo,
  registerPromptComponent,
  isWidgetBarPrompt,
} from "@blackbelt-technology/dashboard-plugin-runtime";
export type { PromptComponentInfo } from "@blackbelt-technology/dashboard-plugin-runtime";
