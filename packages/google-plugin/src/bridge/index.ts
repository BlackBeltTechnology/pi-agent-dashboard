/**
 * Google plugin bridge entry (pi extension). Registers every product's tools (`tools/index.ts`) and declares
 * them to the untrusted-content guard registry at load: reads → `untrusted`, writes → `selfConfirming`
 * (they confirm themselves — no double prompt). Order-independent and inert without the guard (design D11).
 * See change: add-google-connect.
 */
import { buildTools, createRuntime, type RuntimeDeps, type ToolDef } from "./runtime.js";
import { PRODUCT_TOOLS } from "./tools/index.js";

export const GUARD_REGISTRY_SYMBOL = Symbol.for("pi.untrusted-content-guard");

interface GuardRegistry {
  declarations: Array<{ kind: "untrusted" | "selfConfirming"; names: string[] }>;
}

/** Push this plugin's declarations into the (possibly not-yet-loaded) guard registry. */
export function declareToGuard(
  reads: readonly string[],
  writes: readonly string[],
  host: Record<symbol, unknown> = globalThis as unknown as Record<symbol, unknown>,
): void {
  const existing = host[GUARD_REGISTRY_SYMBOL] as GuardRegistry | undefined;
  const reg: GuardRegistry = existing && Array.isArray(existing.declarations) ? existing : { declarations: [] };
  host[GUARD_REGISTRY_SYMBOL] = reg;
  reg.declarations.push({ kind: "untrusted", names: [...reads] });
  reg.declarations.push({ kind: "selfConfirming", names: [...writes] });
}

interface PiLike {
  registerTool?: (tool: ToolDef) => void;
}

/** `activate` with injectable deps (tests); the host calls the default export with just its context. */
export function activateWith(ctx: unknown, deps: RuntimeDeps): void {
  const c = ctx as { pi?: PiLike } | PiLike;
  const pi = ((c as { pi?: PiLike }).pi ?? c) as PiLike;
  if (!pi || typeof pi.registerTool !== "function") return;
  const { tools, reads, writes } = buildTools(createRuntime(deps), PRODUCT_TOOLS);
  declareToGuard(reads, writes);
  for (const tool of tools) pi.registerTool(tool);
}

export default function activate(ctx: unknown): void {
  activateWith(ctx, {});
}
