/**
 * fixture-policy-plugin · SERVER entry (TEST ONLY).
 *
 * Registers a trusted host access policy on the identity seam for the §11.2
 * E2E harness. The dashboard trusts a policy ONLY from the plugin named in
 * `identity.trustedPolicyPlugin`; this fixture's id is `fixture-policy`.
 *
 * When disabled, or when the host exposes no `registerHostAccessPolicy`
 * capability, nothing is registered and every non-session road stays ungated —
 * i.e. the plugin is inert, exactly like production when no policy is set.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { parseFixturePolicyConfig } from "./config.js";
import { createFixturePolicy } from "./policy.js";

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const config = parseFixturePolicyConfig(ctx.getPluginConfig());
  if (!config.enabled) {
    ctx.logger.info("fixture-policy disabled; no policy registered");
    return;
  }
  if (typeof ctx.registerHostAccessPolicy !== "function") {
    ctx.logger.warn(
      "fixture-policy host exposes no registerHostAccessPolicy capability; policy not registered",
    );
    return;
  }
  ctx.registerHostAccessPolicy(createFixturePolicy(config));
  ctx.logger.info(`fixture-policy registered with ${config.allow.length} allow entr(ies)`);
}

export default registerPlugin;
