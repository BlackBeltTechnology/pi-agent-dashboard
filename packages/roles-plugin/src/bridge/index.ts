/**
 * roles-plugin · bridge entry (runs inside every pi session as a pi extension).
 *
 * Before each agent run, appends ONE guideline to the `Agent` tool telling the
 * model to prefer `model: "@<role>"` over literal model ids, listing the
 * currently assigned roles. Seeded from the resolver's `roles:get-all` probe
 * (answered synchronously by the dashboard bridge's role manager), recomputed
 * every run so role edits apply on the next turn.
 *
 * Modular by construction: this file ships only with the roles plugin, and the
 * plugin's bridge is registered only while the plugin is enabled — so with the
 * roles plugin off there is no guidance. Core and the subagents producer carry
 * none of it. See change: add-plugin-bridge-contributions (D12/D13).
 */

export const ROLES_GET_ALL_CHANNEL = "roles:get-all";
const AGENT_TOOL = "Agent";
const MAX_LISTED_ROLES = 12;
/** `provider/model` with an optional `:level` suffix; no whitespace. */
const MODEL_REF_RE = /^[^\s/]+\/\S+$/;

/** Build the guideline bullet from a raw role map; undefined when nothing assignable. */
export function buildRoleGuideline(roles: unknown): string | undefined {
  if (!roles || typeof roles !== "object") return undefined;
  const assigned: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(roles as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const ref = value.trim();
    if (ref && MODEL_REF_RE.test(ref)) assigned.push([name, ref]);
  }
  if (assigned.length === 0) return undefined;
  assigned.sort(([a], [b]) => a.localeCompare(b));
  const listed = assigned
    .slice(0, MAX_LISTED_ROLES)
    .map(([name, ref]) => `@${name} → ${ref}`)
    .join(", ");
  return (
    `When calling ${AGENT_TOOL}, prefer a role ref \`model: "@<role>"\` over a literal model id ` +
    `so the user's role assignments decide the model. Roles: ${listed}.`
  );
}

interface PromptOptionsLike {
  selectedTools?: string[];
  toolGuidelines?: Record<string, string[]>;
}

interface PiLike {
  on?: (event: string, handler: (event: unknown) => unknown) => unknown;
  events?: { emit: (channel: string, data: unknown) => void };
}

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: PiLike } | PiLike | undefined;
  const pi = ((c as { pi?: PiLike } | undefined)?.pi ?? c) as PiLike | undefined;
  if (!pi || typeof pi.on !== "function" || !pi.events) return;
  const events = pi.events;
  pi.on("before_agent_start", (event: unknown) => {
    try {
      const opts = (event as { systemPromptOptions?: PromptOptionsLike } | undefined)?.systemPromptOptions;
      if (!opts || !Array.isArray(opts.selectedTools) || !opts.selectedTools.includes(AGENT_TOOL)) return;
      const probe: { roles?: unknown } = {};
      events.emit(ROLES_GET_ALL_CHANNEL, probe);
      const guideline = buildRoleGuideline(probe.roles);
      if (!guideline) return;
      opts.toolGuidelines ??= {};
      opts.toolGuidelines[AGENT_TOOL] = [...(opts.toolGuidelines[AGENT_TOOL] ?? []), guideline];
    } catch {
      /* guidance is best-effort; never block a run */
    }
  });
}
