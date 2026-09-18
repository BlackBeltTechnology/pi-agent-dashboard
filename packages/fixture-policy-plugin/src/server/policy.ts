/**
 * The fixture host access policy (TEST ONLY). Pure decision function over an
 * allow-list: a request is permitted iff SOME entry matches the principal
 * (`sub`, and `iss` when the entry pins one) AND grants the requested action
 * (`*` or omitted `actions` ⇒ all actions). Otherwise DENY — default-deny, no
 * resource-shape logic, no I/O. The resource descriptor is accepted for
 * signature parity but this fixture decides purely on principal + action.
 */
import type { HostAccessPolicyFn } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import type { AllowEntry, FixturePolicyConfig } from "./config.js";

function grantsAction(entry: AllowEntry, action: string): boolean {
  if (!entry.actions || entry.actions.length === 0) return true; // omitted ⇒ all
  return entry.actions.includes("*") || entry.actions.includes(action);
}

/** Build the `HostAccessPolicyFn` from parsed config. */
export function createFixturePolicy(config: FixturePolicyConfig): HostAccessPolicyFn {
  return async ({ principal, action }) => {
    for (const entry of config.allow) {
      if (entry.sub !== principal.sub) continue;
      if (entry.iss && entry.iss !== principal.iss) continue;
      if (grantsAction(entry, action)) return true;
    }
    return false;
  };
}
