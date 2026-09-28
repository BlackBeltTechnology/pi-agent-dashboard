/**
 * Gmail plugin bridge entry (pi extension). Registers the Gmail tools and
 * declares them to the untrusted-content guard registry at load: reads →
 * `untrusted`, writes → `selfConfirming` (they confirm themselves — no double
 * prompt). Order-independent and inert without the guard (design D6).
 * See change: add-gmail-plugin.
 */
import { resolveGoogleEndpoints } from "../shared/endpoints.js";
import { LeaseClient } from "./lease-client.js";
import { createGmailTools, type GmailToolDef, READ_TOOLS, WRITE_TOOLS } from "./tools.js";

export const GUARD_REGISTRY_SYMBOL = Symbol.for("pi.untrusted-content-guard");

interface GuardRegistry {
  declarations: Array<{ kind: "untrusted" | "selfConfirming"; names: string[] }>;
}

/** Push this plugin's declarations into the (possibly not-yet-loaded) guard registry. */
export function declareToGuard(host: Record<symbol, unknown> = globalThis as unknown as Record<symbol, unknown>): void {
  const existing = host[GUARD_REGISTRY_SYMBOL] as GuardRegistry | undefined;
  const reg: GuardRegistry =
    existing && Array.isArray(existing.declarations) ? existing : { declarations: [] };
  host[GUARD_REGISTRY_SYMBOL] = reg;
  reg.declarations.push({ kind: "untrusted", names: [...READ_TOOLS] });
  reg.declarations.push({ kind: "selfConfirming", names: [...WRITE_TOOLS] });
}

interface PiLike {
  registerTool?: (tool: GmailToolDef) => void;
}

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: PiLike } | PiLike;
  const pi = ((c as { pi?: PiLike }).pi ?? c) as PiLike;
  if (!pi || typeof pi.registerTool !== "function") return;
  declareToGuard();
  const tools = createGmailTools({ leases: new LeaseClient(), endpoints: resolveGoogleEndpoints() });
  for (const tool of tools) pi.registerTool(tool);
}
