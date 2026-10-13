/**
 * Boot restore of ended ACP sessions.
 *
 * ACP sessions have no pi `.jsonl` under `~/.pi/agent/sessions`, so the regular
 * scanner never sees them. Their `.meta.json` sidecars live beside the
 * registered `sessionFile` in `~/.pi/dashboard/acp/`; this reads them back as
 * ENDED sessions carrying `driver:"acp"` + `acpAgentId` (pi-only controls stay
 * hidden). They are never recovery candidates: nothing can resume an ACP
 * session (continue-session guards).
 *
 * See change: add-acp-session-driver (D12, D15).
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { getAcpDir } from "@blackbelt-technology/pi-dashboard-shared/acp/paths.js";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { sessionFromMeta } from "../session/session-scanner.js";

const UUID_META = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.meta\.json$/i;

export function scanAcpSessions(dir: string = getAcpDir()): DashboardSession[] {
  if (!existsSync(dir)) return [];
  const out: DashboardSession[] = [];
  for (const file of readdirSync(dir)) {
    const id = UUID_META.exec(file)?.[1];
    if (!id) continue;
    const sessionFile = path.join(dir, `${id}.jsonl`);
    const meta = readSessionMeta(sessionFile);
    if (meta?.driver !== "acp" || !meta.cwd || meta.archived === true) continue;
    let startedAt = Date.now();
    try {
      startedAt = statSync(path.join(dir, file)).birthtimeMs || startedAt;
    } catch {
      /* keep now */
    }
    const session = sessionFromMeta(id, sessionFile, dir, { ...meta, live: false }, startedAt);
    out.push({ ...session, status: "ended", endedAt: session.endedAt ?? meta.endedAt ?? startedAt });
  }
  return out;
}
