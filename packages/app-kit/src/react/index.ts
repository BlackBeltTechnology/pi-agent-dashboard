// `@blackbelt-technology/pi-dashboard-app-kit/react` — the React + OIDC half.

export {
  type Identity,
  IdentityProvider,
  LOCAL_OPERATOR,
  OidcIdentityBridge,
  type OidcIdentityBridgeProps,
  operatorFromUser,
  type RoleResolver,
  useIdentity,
  useOptionalIdentity,
} from "./identity-context.js";
export { type BuildOidcConfigOptions, buildOidcConfig } from "./oidc-config.js";
