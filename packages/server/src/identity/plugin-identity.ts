/**
 * `ctx.identity` — the plugin CONSUMER seam (D24, task 18.27).
 *
 * Registering seams (resolver / policy / login descriptor) is not enough: a
 * plugin must also CONSUME identity for its own routes, data and actions. This
 * builds the per-plugin object the host hands to `ServerPluginContext.identity`:
 *
 *   isEnforced()              the D21 latch.
 *   principalOf(request)      the frozen principal the host resolved on a plugin
 *                             HTTP route (bearer principal, or the break-glass
 *                             operator), else null.
 *   principalOfUpgrade(req)   the same for a plugin WS upgrade: the host resolves
 *                             the upgrade's `Authorization` credential. Plugin WS
 *                             scopes take no core ticket (the plugin owns its
 *                             per-connection credential), so this is how a WS
 *                             route learns WHO connected. null ⇒ unauthenticated.
 *   authorize(p, action, r)   asks the ONE trusted policy (D9). The action is
 *                             namespaced `plugin:<id>:<action>` by the host, so a
 *                             plugin cannot ask about (or impersonate) a core or
 *                             another plugin's action. No policy ⇒ true.
 *   userDataDir(p)            `<plugin data root>/users/<sha256(iss,sub)>`, 0700,
 *                             stable per user, never derived from the raw `sub`.
 *
 * Pure over injected deps so the contract is unit-testable without a server.
 * See change: add-multi-user-identity-plane (D24).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import type { HostAction, HostResource, Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { isLocalOperator } from "./session-access.js";

/** What a plugin sees; mirrored structurally by `ServerPluginContext.identity`. */
export interface PluginIdentity {
  isEnforced(): boolean;
  principalOf(request: unknown): Principal | null;
  principalOfUpgrade(request: IncomingMessage): Promise<Principal | null>;
  authorize(principal: Principal, action: string, resource: HostResource): Promise<boolean>;
  userDataDir(principal: Principal): string;
}

export interface PluginIdentityDeps {
  isEnforced: () => boolean;
  /** The principal the host resolved on an HTTP request (`sessionPrincipalOf`). */
  principalOfRequest: (request: unknown) => Principal | null;
  /** Resolve an upgrade request's credential to a principal (break-glass, then resolvers). */
  resolveUpgrade: (request: IncomingMessage) => Promise<Principal | null>;
  /** The ONE host policy (D9); resolves `true` when none is registered. */
  policy: { authorize(input: { principal: Principal; action: HostAction; resource: HostResource }): Promise<boolean> };
  /** `~/.pi/dashboard/plugins/<id>` for a plugin id. */
  pluginDataRoot: (pluginId: string) => string;
}

/** A plugin-chosen action name: short, no separator, so it cannot leave its namespace. */
const ACTION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function createPluginIdentity(pluginId: string, deps: PluginIdentityDeps): PluginIdentity {
  return {
    isEnforced: () => deps.isEnforced(),

    principalOf(request) {
      try {
        return deps.principalOfRequest(request) ?? null;
      } catch {
        return null;
      }
    },

    async principalOfUpgrade(request) {
      if (!deps.isEnforced()) return null; // inert plane makes no claim
      try {
        return (await deps.resolveUpgrade(request)) ?? null;
      } catch {
        return null; // a resolver fault is "unauthenticated", never a throw into plugin code
      }
    },

    async authorize(principal, action, resource) {
      if (!deps.isEnforced()) return true; // ungated, as before identity
      if (!principal) return false;
      if (typeof action !== "string" || !ACTION_RE.test(action)) return false;
      if (isLocalOperator(principal)) return true; // break-glass operator sees everything (D23)
      return deps.policy.authorize({ principal, action: `plugin:${pluginId}:${action}`, resource });
    },

    userDataDir(principal) {
      if (!principal || typeof principal.iss !== "string" || typeof principal.sub !== "string") {
        throw new Error("userDataDir requires a principal");
      }
      // JSON-encode the pair so ("a","bc") and ("ab","c") cannot collide.
      const key = createHash("sha256").update(JSON.stringify([principal.iss, principal.sub])).digest("hex");
      const dir = path.join(deps.pluginDataRoot(pluginId), "users", key);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      return dir;
    },
  };
}
