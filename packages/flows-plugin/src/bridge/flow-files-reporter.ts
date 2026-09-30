/**
 * Reports the files this session's pi-flows engine uses — flow sources from
 * `flow:list-flows`, agent sources from `flow:get-agents` — to the flows-plugin
 * server over the private plugin request lane (`requestPluginServer`), so the
 * UI can open YAML / agent / handler files in runtime-registered flow dirs.
 *
 * Triggers (debounced): `session_start`, `flow:(un)register-(flows|agents)-dir`,
 * `flow:rediscover`, and the server's `dashboard-flows:report-files` ask (sent
 * when it has no report, e.g. after a dashboard restart). Retries while the
 * dashboard lane is unavailable. Best-effort: never throws into pi.
 * See change: attach-flow-before-run.
 */
import { requestPluginServer } from "@blackbelt-technology/dashboard-plugin-runtime/bridge";
import { FLOW_FILES_REPORT, FLOW_FILES_REQUEST_EVENT, type FlowFilesReport, type ReportedFile } from "../flow-files-contract.js";

interface PiEvents {
  on(name: string, fn: (data: unknown) => void): unknown;
  emit(name: string, data: unknown): unknown;
}
interface PiLike {
  events?: PiEvents;
  on?: (name: string, fn: () => void) => unknown;
}

const TRIGGERS = [
  "flow:register-flows-dir",
  "flow:register-agents-dir",
  "flow:unregister-flows-dir",
  "flow:unregister-agents-dir",
  "flow:rediscover",
  FLOW_FILES_REQUEST_EVENT,
];
const DEBOUNCE_MS = 300;
const RETRY_MS = 2_000;
const MAX_RETRIES = 5;

function toFile(name: unknown, source: unknown): ReportedFile | null {
  return typeof name === "string" && typeof source === "string" && source ? { name, source } : null;
}

/** Synchronously probe pi-flows for its flow + agent sources. */
export function collectFlowFiles(events: PiEvents): FlowFilesReport {
  const flows: ReportedFile[] = [];
  const agents: ReportedFile[] = [];
  try {
    const probe: { flows?: unknown } = {};
    events.emit("flow:list-flows", probe);
    if (Array.isArray(probe.flows)) {
      for (const f of probe.flows) {
        const r = toFile((f as ReportedFile)?.name, (f as ReportedFile)?.source);
        if (r) flows.push(r);
      }
    }
  } catch {
    /* pi-flows absent */
  }
  try {
    const probe: { agents?: unknown } = {};
    events.emit("flow:get-agents", probe);
    const entries: Iterable<[unknown, unknown]> =
      probe.agents instanceof Map
        ? probe.agents.entries()
        : probe.agents && typeof probe.agents === "object"
          ? Object.entries(probe.agents)
          : [];
    for (const [key, cfg] of entries) {
      const c = cfg as { name?: unknown; source?: unknown } | null;
      const r = toFile(typeof c?.name === "string" ? c.name : key, c?.source);
      if (r) agents.push(r);
    }
  } catch {
    /* pi-flows absent */
  }
  return { flows, agents };
}

export function startFlowFilesReporter(pi: PiLike): void {
  const events = pi.events;
  if (!events || typeof events.emit !== "function" || typeof events.on !== "function") return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;

  const send = async () => {
    timer = undefined;
    const reply = await requestPluginServer("flows", FLOW_FILES_REPORT, collectFlowFiles(events));
    if (reply.ok) {
      retries = 0;
      return;
    }
    if ((reply.error === "unavailable" || reply.error === "disconnected" || reply.error === "timeout") && retries < MAX_RETRIES) {
      retries++;
      timer = setTimeout(() => void send(), RETRY_MS);
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    retries = 0;
    timer = setTimeout(() => void send(), DEBOUNCE_MS);
  };

  for (const name of TRIGGERS) {
    try {
      events.on(name, schedule);
    } catch {
      /* noop */
    }
  }
  try {
    pi.on?.("session_start", schedule);
  } catch {
    /* noop */
  }
}
