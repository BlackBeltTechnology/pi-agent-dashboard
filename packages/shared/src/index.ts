/**
 * Barrel re-exports for selected shared symbols. Most consumers import
 * directly from per-file paths (`@blackbelt-technology/pi-dashboard-shared/<file>.js`)
 * via the package's `exports` map. This barrel exists for symbols that
 * would otherwise be cumbersome to wire — currently the doctor core.
 *
 * Added by change: doctor-rich-output.
 */
export * from "./doctor-core.js";
export type { FileKind, FileKindResult, ViewerKind } from "./file-kind.js";
export {
  fileKind,
  IMAGE_EXTENSIONS,
  TEXT_EXTENSIONS,
} from "./file-kind.js";
export * from "./node-version.js";
export type { RoleNameValidation } from "./role-name-validation.js";
export { isValidRoleName } from "./role-name-validation.js";
export { toolWorkdir } from "./tool-workdir.js";
export type { ViewTarget } from "./types.js";
