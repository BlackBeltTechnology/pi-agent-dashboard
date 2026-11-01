/**
 * Publishes this session's flow catalog (what pi-flows answers to
 * `flow:list-flows`) on `dashboard-flows:catalog`, which the dashboard bridge
 * forwards as the `flow_catalog` event with `latest` delivery (declared here,
 * re-declared on every `dashboard:bridge-ready`). The event rides the session
 * event store, so it is replayed on cold load and late subscribe.
 *
 * Triggers (debounced, fixed 300 ms): `session_start`, `flow:(un)register-
 * (flows|agents)-dir`, `flow:rediscover`, `flow:complete`, publisher attach, and
 * the server's `dashboard-flows:report-files` ask (`{ rediscover: true }` makes
 * pi-flows re-read its flows from disk first).
 *
 * Only answered probes publish: no listener → nothing (a previous catalog
 * stays latest); an answered `[]` publishes an empty catalog. Never throws.
 * See change: flows-dock-chip-and-panel-actions (D1–D3).
 */
import {
  BRIDGE_READY_CHANNEL,
  type EventForwardDeclaration,
  REGISTER_EVENT_FORWARD_CHANNEL,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";
import {
  FLOW_CATALOG_CHANNEL,
  FLOW_CATALOG_EVENT,
  FLOW_CATALOG_KEY,
  FLOW_CATALOG_KEY_FIELD,
  type FlowCatalogEntry,
  type FlowCatalogPayload,
  toCatalogEntry,
} from "../flow-catalog-contract.js";
import { FLOW_FILES_REQUEST_EVENT } from "../flow-files-contract.js";
import { probeFlows } from "./flow-probe.js";

const FLOWS_FORWARD_DECLARATION: EventForwardDeclaration = {
  pluginId: "flows",
  channels: {
    [FLOW_CATALOG_CHANNEL]: { as: FLOW_CATALOG_EVENT, delivery: "latest", key: FLOW_CATALOG_KEY_FIELD },
  },
};

const CATALOG_DEBOUNCE_MS = 300;

const TRIGGERS = [
  "flow:register-flows-dir",
  "flow:register-agents-dir",
  "flow:unregister-flows-dir",
  "flow:unregister-agents-dir",
  "flow:rediscover",
  "flow:complete",
];

interface PiEvents {
  on(name: string, fn: (data: unknown) => void): unknown;
  emit(name: string, data: unknown): unknown;
}
interface PiLike {
  events?: PiEvents;
  on?: (name: string, fn: () => void) => unknown;
}

/** Current catalog, or `undefined` when pi-flows did not answer. */
function collectCatalog(events: PiEvents): FlowCatalogEntry[] | undefined {
  const raw = probeFlows(events);
  if (raw === undefined) return undefined;
  const out: FlowCatalogEntry[] = [];
  for (const f of raw) {
    const e = toCatalogEntry(f);
    if (e) out.push(e);
  }
  return out;
}

export function startFlowCatalogPublisher(pi: PiLike): void {
  const events = pi.events;
  if (!events || typeof events.emit !== "function" || typeof events.on !== "function") return;

  const declare = () => {
    try {
      events.emit(REGISTER_EVENT_FORWARD_CHANNEL, FLOWS_FORWARD_DECLARATION);
    } catch {
      /* never break session start */
    }
  };
  declare();
  try {
    events.on(BRIDGE_READY_CHANNEL, declare);
  } catch {
    /* noop */
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = () => {
    timer = undefined;
    const flows = collectCatalog(events);
    if (flows === undefined) return;
    const payload: FlowCatalogPayload = { catalogKey: FLOW_CATALOG_KEY, flows };
    try {
      events.emit(FLOW_CATALOG_CHANNEL, payload);
    } catch {
      /* best-effort */
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(publish, CATALOG_DEBOUNCE_MS);
  };

  for (const name of TRIGGERS) {
    try {
      events.on(name, schedule);
    } catch {
      /* noop */
    }
  }
  try {
    events.on(FLOW_FILES_REQUEST_EVENT, (data) => {
      // Rediscover first: pi-flows re-reads disk, then its `flow:rediscover`
      // (a trigger above) schedules the publish too.
      if ((data as { rediscover?: unknown } | null)?.rediscover === true) {
        try {
          events.emit("flow:rediscover", {});
        } catch {
          /* pi-flows absent */
        }
      }
      schedule();
    });
  } catch {
    /* noop */
  }
  try {
    pi.on?.("session_start", schedule);
  } catch {
    /* noop */
  }
  // Attach (bridge load / reload).
  schedule();
}
