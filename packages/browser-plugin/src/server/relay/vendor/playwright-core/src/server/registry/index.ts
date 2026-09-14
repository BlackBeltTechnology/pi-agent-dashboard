/**
 * SHIM — NOT upstream code. Replaces upstream
 * `packages/playwright-core/src/server/registry/index.ts` (a ~60 KB module
 * pulling the whole browsers/executables registry tree). See ../NOTICE.
 *
 * Only the surface `tools/mcp/cdpRelay.ts` reaches is declared:
 * `registry.isChromiumAlias(channel)` and `registry.findExecutable(channel)`,
 * both called exclusively inside `CDPRelayServer._openConnectPageInBrowser` —
 * the upstream browser-launching path this plugin BYPASSES (connect opens
 * Chrome via the host `systemOpen` capability + `--profile-directory`, owned
 * by relay-instance/connect). Calling either throws loudly instead of
 * silently no-op'ing: an accidental reach into the shim is a bug to surface,
 * not to swallow.
 */

export interface ExecutableInfo {
  executablePath(): string | undefined;
}

function notSupported(): Error {
  return new Error(
    "not supported — browser launch is supplied by relay-instance.ts (systemOpen path); the vendored registry is a shim",
  );
}

export const registry = {
  isChromiumAlias(_channel: string): boolean {
    throw notSupported();
  },
  findExecutable(_channel: string): ExecutableInfo | undefined {
    throw notSupported();
  },
};
