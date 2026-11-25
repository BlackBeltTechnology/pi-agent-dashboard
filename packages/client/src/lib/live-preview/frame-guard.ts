/**
 * D6(b) — Fetch-Metadata-independent client guard (change: serve-live-previews-on-capability-origin).
 *
 * A preview can navigate its own frame to a dashboard document, or nest
 * `<iframe src="http://<dashIP>:8000/">`. On plain-http IP dashboards no `Sec-Fetch-*`
 * header is sent, so the server-side sandbox never fires. The SPA therefore refuses to
 * boot when it runs framed by a live frame (`data-pi-live-frame`) or by a cross-origin
 * parent (`frameElement === null`), matching the intended `frame-ancestors 'self'`.
 */

/** Marker `LiveFrame` puts on its iframe so a dashboard document inside it can recognise the case. */
export const LIVE_FRAME_ATTR = "data-pi-live-frame";

interface FrameContext {
  top: unknown;
  frameElement: Element | null;
}

/** True when this document is framed in a way the dashboard SPA must not render in. */
export function isDashboardBootBlocked(win: FrameContext & object): boolean {
  let framed: boolean;
  let frameElement: Element | null;
  try {
    framed = win !== win.top;
    frameElement = win.frameElement;
  } catch {
    // A cross-origin access error means we are framed by another origin.
    return true;
  }
  if (!framed) return false;
  if (frameElement === null) return true;
  return frameElement.hasAttribute(LIVE_FRAME_ATTR);
}

/** After a live frame `load`: a readable `location.href` means the frame is same-origin with the dashboard. */
export function isFrameSameOriginReadable(frame: HTMLIFrameElement): boolean {
  try {
    return typeof frame.contentWindow?.location.href === "string";
  } catch {
    return false;
  }
}
