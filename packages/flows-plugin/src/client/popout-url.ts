/**
 * Pure helper for building `shell-overlay-route` popout URLs.
 *
 * Encodes every variable segment via `encodeURIComponent`, resolves the
 * URL against `window.location.origin` so `window.open` receives a
 * fully-qualified URL (some browsers/configurations fall back to
 * `about:blank` when handed a path-only string).
 *
 * Console-warns when any segment is empty, so devs see a hint when an
 * agent or flow id is undefined.
 *
 * See change: fix-flows-plugin-polish (A3).
 */

export function buildPopoutUrl(path: string, origin: string = ""): string {
  // `new URL` requires a base when path is relative. Fall back to
  // `window.location.origin` if available (browser context). For tests
  // and SSR (no window) we pass through the path as-is.
  const base = origin || (typeof window !== "undefined" ? window.location.origin : "");
  if (!base) return path;
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}

export function buildFlowAgentPopoutUrl(
  sessionId: string | null | undefined,
  flowId: string | null | undefined,
  stepId: string | null | undefined,
): string | null {
  if (!sessionId || !flowId || !stepId) {
    if (typeof console !== "undefined") {
      console.warn(
        "[flows-plugin] buildFlowAgentPopoutUrl: missing identifier",
        { sessionId, flowId, stepId },
      );
    }
    return null;
  }
  const path = `/session/${encodeURIComponent(sessionId)}/flow/${encodeURIComponent(flowId)}/agent/${encodeURIComponent(stepId)}`;
  return buildPopoutUrl(path);
}

export function buildFlowArchitectPopoutUrl(
  sessionId: string | null | undefined,
): string | null {
  if (!sessionId) {
    if (typeof console !== "undefined") {
      console.warn(
        "[flows-plugin] buildFlowArchitectPopoutUrl: missing sessionId",
      );
    }
    return null;
  }
  const path = `/session/${encodeURIComponent(sessionId)}/architect`;
  return buildPopoutUrl(path);
}
