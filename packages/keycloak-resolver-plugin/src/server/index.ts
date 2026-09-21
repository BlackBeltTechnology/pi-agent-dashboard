/**
 * keycloak-resolver-plugin · SERVER entry.
 *
 * Bundled dashboard resolver plugin (openspec: add-multi-user-identity-plane).
 * It reads its Keycloak configuration from `getPluginConfig()` and, when the
 * config ACTIVATES it (enabled + issuer + audience, and — for http: — the
 * insecure opt-in), registers its RFC 9068 + conditional-DPoP resolver on the
 * host identity seam.
 *
 * Dashboard core imports NOTHING Keycloak-specific: all JWT/JWKS/DPoP logic
 * lives here in the plugin. When inert, no resolver is registered and the
 * dashboard behaves exactly as before this change.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { activeConfig, isAllowedProviderUrl, parseKeycloakResolverConfig } from "../shared/config.js";
import { JtiReplayCache } from "./dpop.js";
import { JwksSource } from "./jwks.js";
import { createKeycloakResolver } from "./resolver.js";

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const config = parseKeycloakResolverConfig(ctx.getPluginConfig());
  if (!config.enabled) {
    ctx.logger.info("keycloak-resolver disabled; no resolver registered");
    return;
  }

  if (typeof ctx.registerPrincipalResolver !== "function") {
    ctx.logger.warn(
      "keycloak-resolver host exposes no registerPrincipalResolver capability; resolver not registered",
    );
    return;
  }

  const active = activeConfig(config);
  if (!active) {
    // Registered-but-unconfigured is deliberately inert (D1/D7): the host
    // sees the plugin but does not activate identity readiness/auth dispatch.
    ctx.registerPrincipalResolver(async () => null, { active: false });
    ctx.logger.info("keycloak-resolver inert (missing issuer/audience or insecure http without opt-in)");
    return;
  }

  const resolver = createKeycloakResolver({
    config: active,
    jwks: new JwksSource(active),
    replayCache: new JtiReplayCache(),
  });
  ctx.registerPrincipalResolver(resolver, { clockSkewSeconds: active.clockSkewSeconds });
  // Issuer is operator configuration, not credential material; logging it is
  // useful for diagnosing issuer pinning without exposing a token or key.
  ctx.logger.info(`keycloak-resolver active for issuer ${active.issuer}`);

  // Browser login gate (D16): publish the pre-auth login descriptor ONLY when a
  // dedicated public `browserClientId` is configured. Without it the browser
  // login gate is not offered (the host returns `{active:false}`). `browserIssuer`
  // (a browser-reachable base) falls back to the validation `issuer`.
  if (active.browserClientId && typeof ctx.registerBrowserLoginConfig === "function") {
    const browserIssuer =
      active.browserIssuer && isAllowedProviderUrl(active.browserIssuer, active.allowInsecureHttp)
        ? active.browserIssuer
        : active.issuer;
    ctx.registerBrowserLoginConfig({ issuer: browserIssuer, clientId: active.browserClientId });
    ctx.logger.info(`keycloak-resolver browser login offered (client ${active.browserClientId})`);
  }
}

export default registerPlugin;
