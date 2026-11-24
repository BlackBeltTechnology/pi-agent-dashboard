/**
 * agent-teams-plugin · bridge entry (stub).
 *
 * Auto-registered as a pi extension (manifest `bridge` entry). Later sections
 * register the team tools and the teammate-scope guard here.
 *
 * See change: add-agent-teams-core.
 */
interface PiLike {
  on?: (event: string, handler: (event: unknown, ctx: unknown) => void) => void;
  events?: { emit: (name: string, payload: unknown) => void };
}

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: PiLike } | PiLike;
  const pi = ((c as { pi?: PiLike }).pi ?? c) as PiLike;
  if (!pi || typeof pi.on !== "function") return;
  // Intentionally empty — filled by tasks 6.x–8.x.
}
