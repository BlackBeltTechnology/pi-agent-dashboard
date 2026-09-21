/**
 * The provider-auth registry surface consumers import.
 *
 * What used to live here — three hand-ported OAuth flows, their PKCE helpers,
 * and a `ProviderHandler` union — is gone. pi-ai owns the flows; the server
 * only needs the registry it builds from the pi runtime. The readiness promise
 * and the one-shot error string are imported straight from
 * `provider-auth-registry.js` by the two surfaces that need them (the routes'
 * startup kick-off and `/api/health`), so they are not re-exported here.
 *
 * Kept as its own module (rather than importing `provider-auth-registry.js`
 * everywhere) so the import surface the storage layer and the routes already
 * use does not churn when the registry's internals move.
 * See change: delegate-provider-oauth-to-pi-ai (D1, D5).
 */

export { getOAuthRegistry } from "./provider-auth-registry.js";
export type { OAuthRegistryEntry } from "./pi-oauth-types.js";
