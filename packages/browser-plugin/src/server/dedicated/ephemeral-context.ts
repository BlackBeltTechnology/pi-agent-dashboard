/**
 * Server-owned ephemeral browser context for a dedicated instance (change:
 * add-gmail-auto-setup, D2/D8). Created on the server's own browser session — a
 * client can never create or dispose one — with its downloads routed to the
 * server-chosen downloads dir. The instance disposes it when it closes; Chrome
 * drops it on exit too.
 */
import { nextCdpId, type PipeLike, pipeCall } from "./pipe-call.js";

/** `Target.createBrowserContext` + per-context `Browser.setDownloadBehavior`; returns the context id. */
export async function createEphemeralContext(chrome: PipeLike, downloadsDir: string): Promise<string> {
  const created = (await pipeCall(chrome, "Target.createBrowserContext", {})) as { browserContextId?: unknown } | undefined;
  const browserContextId = created?.browserContextId;
  if (typeof browserContextId !== "string" || browserContextId === "") throw new Error("Target.createBrowserContext returned no id");
  try {
    await pipeCall(chrome, "Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadsDir, browserContextId });
  } catch (err) {
    disposeEphemeralContext(chrome, browserContextId);
    throw err;
  }
  return browserContextId;
}

/** Best-effort write, never throws (the pipe may be gone). */
export function disposeEphemeralContext(chrome: PipeLike, browserContextId: string): void {
  try {
    chrome.send({ id: nextCdpId(), method: "Target.disposeBrowserContext", params: { browserContextId } });
  } catch {
    /* pipe closed */
  }
}
