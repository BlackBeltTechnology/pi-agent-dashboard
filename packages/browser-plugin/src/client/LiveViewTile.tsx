/**
 * Live-view tile — the `content-view` claim (change: add-browser-relay, task
 * 4.3 / spec `browser-plugin-settings` "Live-view tile").
 *
 * One tile per `{instanceId, tabId}` reported by `browser_relay_status` (all
 * live instances — the relay is global, not per-session). Each tile:
 *  - subscribes on mount and unsubscribes on unmount (a tab leaving the status
 *    list unmounts its tile, which sends the unsubscribe);
 *  - renders the latest `browser_relay_frame` JPEG for its own ref;
 *  - forwards pointer/keyboard/wheel as `browser_relay_input` of kinds
 *    `mouse`/`key`/`scroll`, with coordinates NORMALIZED to `[0,1]` of the
 *    rendered frame (never CSS or device pixels — the relay scales by the last
 *    frame's `metadata.deviceWidth/Height`);
 *  - overlays the `no-frames` state with a `Bring to front` action, and STOPS
 *    forwarding input while the tab is `detached` (DevTools open).
 *
 * The tile is self-sufficient: it feeds the module store from
 * `browser_relay_status` (idempotent alongside `BrowserRelayBadge`) and reads
 * it reactively, so a layout without a mounted session card still updates.
 *
 * See change: add-browser-relay (task 4.3).
 */
import { usePluginMessage, usePluginSend, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type {
  BrowserRelayFrameMessage,
  BrowserRelayStatusMessage,
  BrowserRelayTabStatus,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { setRelayStatus, useRelayStatus } from "./relay-store.js";

export interface LiveViewTileProps {
  session: DashboardSession;
  routeParams: Record<string, string>;
  /** Provided by the host slot layer — returns to the default chat view. */
  onClose: () => void;
}

interface TileRef {
  instanceId: string;
  tab: BrowserRelayTabStatus;
}

/** A `mouse`/`scroll` position normalized to `[0,1]` of the rendered frame. */
interface NormalizedPoint {
  x: number;
  y: number;
}

/**
 * Normalize a client-space point against an element's rendered box.
 * Returns `null` for a degenerate box (width/height 0) so no bogus input is
 * sent.
 */
function normalizePoint(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): NormalizedPoint | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
}

export function LiveViewTile({ onClose }: LiveViewTileProps): React.ReactElement {
  const t = useT();
  // Feed the module store as well as the badge: the content-view can render
  // without a session card (mobile layout), and both writers are idempotent.
  usePluginMessage<BrowserRelayStatusMessage>("browser_relay_status", setRelayStatus);
  const status = useRelayStatus();

  const tiles = useMemo<TileRef[]>(() => {
    const out: TileRef[] = [];
    for (const instance of status?.instances ?? []) {
      for (const tab of instance.tabs) out.push({ instanceId: instance.instanceId, tab });
    }
    return out;
  }, [status]);

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="browser-live-view">
      <header className="flex items-center justify-between px-1 pb-2">
        <h2 className="text-sm font-medium">{t("liveViewTitle", undefined, "Live browser view")}</h2>
        <button
          type="button"
          data-testid="browser-live-view-close"
          onClick={onClose}
          className="text-xs px-2 py-1 rounded border border-[var(--border-secondary)] hover:bg-[var(--bg-secondary)]"
        >
          {t("close", undefined, "Close")}
        </button>
      </header>
      {tiles.length === 0 ? (
        <p data-testid="browser-live-view-empty" className="text-xs text-[var(--text-tertiary)]">
          {t("noTabs", undefined, "No live browser tabs.")}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 min-h-0 overflow-auto">
          {tiles.map(({ instanceId, tab }) => (
            <RelayTile key={`${instanceId}:${tab.tabId}`} instanceId={instanceId} tab={tab} />
          ))}
        </div>
      )}
    </div>
  );
}

function RelayTile({
  instanceId,
  tab,
}: {
  instanceId: string;
  tab: BrowserRelayTabStatus;
}): React.ReactElement {
  const t = useT();
  const send = usePluginSend();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [jpegBase64, setJpegBase64] = useState<string | null>(null);

  usePluginMessage<BrowserRelayFrameMessage>("browser_relay_frame", (msg) => {
    if (msg.instanceId === instanceId && msg.tabId === tab.tabId) setJpegBase64(msg.jpegBase64);
  });

  // Subscribe for the tab's lifetime; unsubscribe on unmount (which is also
  // what happens when the tab disappears from the status list).
  useEffect(() => {
    void send({ type: "browser_relay_subscribe", instanceId, tabId: tab.tabId });
    return () => {
      void send({ type: "browser_relay_unsubscribe", instanceId, tabId: tab.tabId });
    };
  }, [send, instanceId, tab.tabId]);

  // DevTools has taken the tab: the overlay shows and input forwarding stops.
  const detached = tab.state === "detached";

  const normalized = (clientX: number, clientY: number): NormalizedPoint | null => {
    const el = boxRef.current;
    if (!el) return null;
    return normalizePoint(el.getBoundingClientRect(), clientX, clientY);
  };

  const sendMouse = (clientX: number, clientY: number, action: "click" | "move"): void => {
    if (detached) return;
    const point = normalized(clientX, clientY);
    if (!point) return;
    void send({
      type: "browser_relay_input",
      instanceId,
      tabId: tab.tabId,
      kind: "mouse",
      x: point.x,
      y: point.y,
      action,
      ...(action === "click" ? { button: "left", clickCount: 1 } : {}),
    });
  };

  const testId = `browser-tile-${instanceId}-${tab.tabId}`;

  return (
    <div
      ref={boxRef}
      data-testid={testId}
      tabIndex={0}
      className="relative border border-[var(--border-secondary)] rounded overflow-hidden bg-black/5"
      onClick={(e) => sendMouse(e.clientX, e.clientY, "click")}
      onMouseMove={(e) => sendMouse(e.clientX, e.clientY, "move")}
      onWheel={(e) => {
        if (detached) return;
        const point = normalized(e.clientX, e.clientY);
        if (!point) return;
        void send({
          type: "browser_relay_input",
          instanceId,
          tabId: tab.tabId,
          kind: "scroll",
          x: point.x,
          y: point.y,
          deltaX: e.deltaX,
          deltaY: e.deltaY,
        });
      }}
      onKeyDown={(e) => {
        if (detached) return;
        void send({
          type: "browser_relay_input",
          instanceId,
          tabId: tab.tabId,
          kind: "key",
          keyType: "keyDown",
          key: e.key,
          code: e.code,
        });
      }}
      onKeyUp={(e) => {
        if (detached) return;
        void send({
          type: "browser_relay_input",
          instanceId,
          tabId: tab.tabId,
          kind: "key",
          keyType: "keyUp",
          key: e.key,
          code: e.code,
        });
      }}
    >
      <div data-testid={`browser-tile-title-${instanceId}-${tab.tabId}`} className="text-[10px] px-1 py-0.5 truncate text-[var(--text-tertiary)]">
        {tab.title || tab.url || t("untitledTab", undefined, "Untitled tab")}
      </div>
      {jpegBase64 ? (
        <img
          data-testid={`browser-frame-${instanceId}-${tab.tabId}`}
          alt={t("frameAlt", undefined, "Live browser frame")}
          src={`data:image/jpeg;base64,${jpegBase64}`}
          className="block w-full h-auto select-none"
          draggable={false}
        />
      ) : (
        <div
          data-testid={`browser-frame-waiting-${instanceId}-${tab.tabId}`}
          className="p-3 text-[11px] text-[var(--text-tertiary)]"
        >
          {t("waitingFrame", undefined, "Waiting for frames…")}
        </div>
      )}

      {tab.state === "no-frames" && (
        <div
          data-testid={`browser-overlay-noframes-${instanceId}-${tab.tabId}`}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--bg-primary)]/90 text-center p-2"
        >
          <p className="text-[11px] text-[var(--text-secondary)]">
            {t("noFramesOverlay", undefined, "No repaints — tab may be idle or in the background")}
          </p>
          <button
            type="button"
            data-testid={`browser-bring-to-front-${instanceId}-${tab.tabId}`}
            onClick={(e) => {
              e.stopPropagation();
              void send({
                type: "browser_relay_input",
                instanceId,
                tabId: tab.tabId,
                kind: "bringToFront",
              });
            }}
            className="text-xs px-2 py-1 rounded border border-[var(--border-secondary)] hover:bg-[var(--bg-secondary)]"
          >
            {t("bringToFront", undefined, "Bring to front")}
          </button>
        </div>
      )}

      {detached && (
        <div
          data-testid={`browser-overlay-devtools-${instanceId}-${tab.tabId}`}
          className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/90 text-center p-2"
        >
          <p className="text-[11px] text-[var(--text-secondary)]">
            {t("devtoolsOverlay", undefined, "DevTools open on this tab — close it to resume")}
          </p>
        </div>
      )}
    </div>
  );
}
