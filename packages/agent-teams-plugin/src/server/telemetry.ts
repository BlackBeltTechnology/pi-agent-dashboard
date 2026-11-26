/**
 * Observability: structured one-line logs and per-team counters.
 *
 * Logs carry ids, names, kinds and sizes ONLY — never a mail body, task text,
 * result, final text or error message (test-plan S97). The counters live in
 * memory (they restart with the server) and are exposed as `stats` in the REST
 * snapshot; they hold numbers and nothing else.
 * See change: add-agent-teams-core.
 */
import type { Logger } from "./types.js";

/** Counter names, in snapshot order. */
const STAT_NAMES = ["spawns", "claims", "claimConflicts", "deliveries", "queued", "urgentAborts", "rateLimited"] as const;
type StatName = (typeof STAT_NAMES)[number];
type TeamStats = Readonly<Record<StatName, number>>;

/** Events with a structured log line. */
type LogEvent =
  | "spawn"
  | "bind"
  | "claim"
  | "complete"
  | "deliver"
  | "queue"
  | "ack"
  | "idle"
  | "shutdown"
  | "orphan";

/** Field values are identifiers, enums and sizes: a free-text field cannot be expressed. */
type LogFields = Readonly<Record<string, string | number | boolean | undefined>>;

export interface Telemetry {
  /** Add `n` (default 1) to one counter of a team. */
  count(teamId: string, name: StatName, n?: number): void;
  /** A copy of the team's counters (all zero for an unknown team). */
  stats(teamId: string): TeamStats;
  /** One structured line: `agent-teams: <event> [head] team=<id> k=v …` (undefined fields are omitted; `head` is ids only). */
  log(event: LogEvent, teamId: string, fields?: LogFields, head?: string): void;
}

const zero = (): Record<StatName, number> => ({ spawns: 0, claims: 0, claimConflicts: 0, deliveries: 0, queued: 0, urgentAborts: 0, rateLimited: 0 });

export function createTelemetry(logger: Logger): Telemetry {
  const byTeam = new Map<string, Record<StatName, number>>();
  return {
    count(teamId, name, n = 1) {
      const row = byTeam.get(teamId) ?? zero();
      row[name] += n;
      byTeam.set(teamId, row);
    },
    stats: (teamId) => ({ ...(byTeam.get(teamId) ?? zero()) }),
    log(event, teamId, fields = {}, head) {
      const parts = Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${String(v)}`);
      logger.info(`agent-teams: ${event}${head ? ` ${head}` : ""} team=${teamId}${parts.length > 0 ? ` ${parts.join(" ")}` : ""}`);
    },
  };
}
