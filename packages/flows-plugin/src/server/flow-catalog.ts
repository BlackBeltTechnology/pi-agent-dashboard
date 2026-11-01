/**
 * Plugin-server side of the flow catalog (see `../flow-catalog-contract.ts`).
 *
 *   - Feeds `stateStore` from forwarded `flow_catalog` events (`ctx.onEvent`)
 *     and clears it on session end, so `makeFlowsForCwd` (automation) sees
 *     the same catalog the browser does.
 *   - `requestCatalog(sessionId, {rediscover})`: asks the session's bridge to
 *     (re)publish via `dashboard-flows:report-files`, at most once per session
 *     per configured ask limit (own map, independent of the files ask).
 *   - Sibling follow: a catalog that DIFFERS from the session's previous known
 *     catalog makes every other live session in the same folder rediscover and
 *     report. Equal catalogs ask nothing (no loop).
 *   - Server start: asks every live session to report, then re-asks the ones
 *     that have not reported at the configured interval for the configured
 *     window (bridges reconnecting after a restart).
 *
 * Timings are read from the plugin config at each use (a save applies at once).
 * See change: flows-dock-chip-and-panel-actions (D3, D4, D11).
 */
import { FLOW_CATALOG_EVENT, type FlowCatalogEntry, parseCatalogPayload, sameCatalog } from "../flow-catalog-contract.js";
import { FLOW_FILES_REQUEST_EVENT } from "../flow-files-contract.js";
import { type CatalogTimings, readCatalogTimings } from "../catalog-timings.js";

interface CatalogStore {
  getState(id: string): { flows?: FlowCatalogEntry[]; catalogKnown?: boolean } | undefined;
  setFlows(id: string, flows: FlowCatalogEntry[]): void;
  clearSession(id: string): void;
}

export interface FlowCatalogDeps {
  onEvent: (handler: (sessionId: string, event: unknown) => void) => () => void;
  onSessionEnded?: (handler: (sessionId: string) => void) => () => void;
  sessionManager: { listActive(): unknown[] };
  emitEventToSession: (sessionId: string, eventType: string, data: Record<string, unknown>) => boolean;
  getPluginConfig: () => Record<string, unknown>;
  store: CatalogStore;
  logger?: { info(m: string): void; warn(m: string): void };
}

export interface FlowCatalogController {
  /** Ask a session to report (rate-limited). Returns true when an ask was sent and delivered. */
  requestCatalog(sessionId: string, opts?: { rediscover?: boolean }): boolean;
  /** Start the server-start ask loop. Returns a stop fn. */
  startServerStartAsks(): () => void;
  dispose(): void;
}

function liveSessions(sm: FlowCatalogDeps["sessionManager"]): Array<{ id: string; cwd?: string }> {
  const out: Array<{ id: string; cwd?: string }> = [];
  for (const s of sm.listActive()) {
    const r = s as { id?: unknown; cwd?: unknown; status?: unknown } | null;
    if (!r || typeof r.id !== "string" || r.status === "ended") continue;
    out.push({ id: r.id, cwd: typeof r.cwd === "string" ? r.cwd : undefined });
  }
  return out;
}

export function registerFlowCatalog(deps: FlowCatalogDeps): FlowCatalogController {
  const lastAsk = new Map<string, number>();
  const reported = new Set<string>();
  const timings = (): CatalogTimings => readCatalogTimings(deps.getPluginConfig());

  const requestCatalog = (sessionId: string, opts?: { rediscover?: boolean }): boolean => {
    const now = Date.now();
    const prev = lastAsk.get(sessionId);
    if (prev !== undefined && now - prev < timings().askLimitMs) return false;
    lastAsk.set(sessionId, now);
    try {
      return deps.emitEventToSession(sessionId, FLOW_FILES_REQUEST_EVENT, opts?.rediscover ? { rediscover: true } : {});
    } catch {
      return false;
    }
  };

  const offEvent = deps.onEvent((sessionId, raw) => {
    const ev = raw as { eventType?: unknown; data?: unknown } | null;
    if (ev?.eventType !== FLOW_CATALOG_EVENT) return;
    const flows = parseCatalogPayload(ev.data);
    if (!flows) return;
    const prev = deps.store.getState(sessionId);
    const changed = prev?.catalogKnown === true && !sameCatalog(prev.flows, flows);
    deps.store.setFlows(sessionId, flows);
    reported.add(sessionId);
    if (!changed) return;
    const live = liveSessions(deps.sessionManager);
    const cwd = live.find((s) => s.id === sessionId)?.cwd;
    if (!cwd) return;
    for (const s of live) {
      if (s.id !== sessionId && s.cwd === cwd) requestCatalog(s.id, { rediscover: true });
    }
  });

  const offEnded = deps.onSessionEnded?.((sessionId) => {
    deps.store.clearSession(sessionId);
    lastAsk.delete(sessionId);
    reported.delete(sessionId);
  });

  const startServerStartAsks = (): (() => void) => {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      timer = undefined;
      for (const s of liveSessions(deps.sessionManager)) {
        if (!reported.has(s.id)) requestCatalog(s.id);
      }
      const { serverStartIntervalMs, serverStartWindowMs } = timings();
      const next = Date.now() + serverStartIntervalMs;
      if (next - startedAt > serverStartWindowMs) return;
      timer = setTimeout(tick, serverStartIntervalMs);
      (timer as { unref?: () => void }).unref?.();
    };
    tick();
    return () => {
      if (timer) clearTimeout(timer);
    };
  };

  return {
    requestCatalog,
    startServerStartAsks,
    dispose: () => {
      offEvent();
      offEnded?.();
    },
  };
}
