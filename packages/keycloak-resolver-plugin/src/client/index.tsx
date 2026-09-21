/**
 * Client entry barrel for the keycloak-resolver-plugin.
 *
 * Re-exports the React slot-claim component referenced by the
 * `pi-dashboard-plugin` manifest's `claims[]`. The vite plugin's
 * plugin-registry generator resolves each `component` string in the manifest
 * against this module's named exports — names MUST match.
 *
 * Slots claimed:
 *   - login-provider → KeycloakLogin (D16 detachable browser login)
 *
 * See change: add-multi-user-identity-plane.
 */
export { catalog } from "../i18n.js";
export { KeycloakLogin } from "./KeycloakLogin.js";
