/**
 * The session's flow catalog, from the newest `flow_catalog` event in its event
 * stream (replay included), via `useFlowsSessionState`.
 *
 * `known === false` until a catalog event was seen. While unknown and
 * `autoAsk` is set (only the viewed session's consumers: the dock chip and the
 * flow panel claim), it sends `plugin_action flow.request-catalog` after one
 * re-ask interval and then every interval, up to the configured attempts per
 * mount ("per view"). The first ask waits one interval so a catalog arriving
 * with the session's replay needs no ask (and does not spend the server's
 * per-session ask budget a picker refresh may need right after). `refresh({rediscover})` asks on demand (chip / menu / picker open).
 * Timings come from the flows plugin config at use time.
 *
 * See change: flows-dock-chip-and-panel-actions (D3, D5, D11).
 */
import { usePluginConfigOf, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useCallback, useEffect, useMemo } from "react";
import { readCatalogTimings } from "../catalog-timings.js";
import { FLOW_REQUEST_CATALOG_ACTION, type FlowCatalogEntry } from "../flow-catalog-contract.js";
import { useFlowsSessionState } from "./FlowsSessionStateContext.js";
import { makeSafeSend } from "./send-safe.js";

const EMPTY: readonly FlowCatalogEntry[] = Object.freeze([]);

export interface FlowCatalogView {
  known: boolean;
  flows: readonly FlowCatalogEntry[];
  refresh: (opts?: { rediscover?: boolean }) => void;
}

export function useFlowCatalog(sessionId: string, opts: { autoAsk?: boolean } = {}): FlowCatalogView {
  const { catalog } = useFlowsSessionState(sessionId);
  const send = usePluginSend();
  const dispatch = useMemo(() => makeSafeSend(send), [send]);
  const config = usePluginConfigOf<Record<string, unknown>>("flows");
  const { reaskIntervalMs, reaskAttempts } = readCatalogTimings(config);
  const known = catalog !== undefined;
  const autoAsk = opts.autoAsk === true;

  const refresh = useCallback(
    (o?: { rediscover?: boolean }) =>
      dispatch({
        type: "plugin_action",
        pluginId: "flows",
        sessionId,
        action: FLOW_REQUEST_CATALOG_ACTION,
        payload: o?.rediscover ? { rediscover: true } : {},
      }),
    [dispatch, sessionId],
  );

  useEffect(() => {
    if (known || !autoAsk) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      timer = undefined;
      attempts++;
      refresh();
      if (attempts < reaskAttempts) timer = setTimeout(tick, reaskIntervalMs);
    };
    timer = setTimeout(tick, reaskIntervalMs);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [known, autoAsk, refresh, reaskAttempts, reaskIntervalMs]);

  return { known, flows: catalog ?? EMPTY, refresh };
}
