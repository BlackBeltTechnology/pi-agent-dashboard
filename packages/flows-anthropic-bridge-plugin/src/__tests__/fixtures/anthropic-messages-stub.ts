/**
 * Test-only stand-in for the optional `@pi/anthropic-messages` peer.
 *
 * `bridge/index.ts` static-imports both peer specifiers; neither is installed
 * in the workspace, so Vite cannot transform the module without an alias.
 * Aliased in `vitest.config.ts`. See change: warn-missing-anthropic-messages-peer.
 */
export default async function piAnthropicMessages(_pi: unknown): Promise<void> {}
export function isClaudeAnthropicMessages(_ctx: unknown): boolean {
  return false;
}
