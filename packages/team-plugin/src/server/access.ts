/**
 * Modes + caller resolution (D2/D4). Multi-user needs identity enforced;
 * otherwise every admitted caller is the local operator (admin).
 * See change: add-team-plugin.
 */
import { LOCAL_USER_KEY, userKey } from "./paths.js";
import type { Caller, Mode, TeamConfig } from "./types.js";

export interface IdentityLike {
  isEnforced(): boolean;
  principalOf(request: unknown): { iss: string; sub: string; email?: string; name?: string } | null;
}

const LOCAL_ISS = "urn:pi-dashboard:local-operator";

export interface Access {
  mode(): Mode;
  /** null ⇒ 401 (multi-user without a principal). */
  callerOf(request: unknown): Caller | null;
}

export function createAccess(identity: IdentityLike | undefined, config: () => TeamConfig): Access {
  const mode = (): Mode => (identity?.isEnforced() ? "multi" : "single");
  return {
    mode,
    callerOf(request) {
      if (mode() === "single") {
        return { uk: LOCAL_USER_KEY, iss: LOCAL_ISS, sub: "local", name: "Local operator", admin: true };
      }
      const p = identity?.principalOf(request);
      if (!p?.iss || !p.sub) return null;
      const admins = config().admins ?? [];
      return {
        uk: userKey(p.iss, p.sub),
        iss: p.iss,
        sub: p.sub,
        email: p.email,
        name: p.name,
        admin: admins.some((a) => a.iss === p.iss && a.sub === p.sub),
      };
    },
  };
}
