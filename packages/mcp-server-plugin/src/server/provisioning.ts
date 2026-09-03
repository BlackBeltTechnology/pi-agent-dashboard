/**
 * Provisions the dashboard's own entry into `~/.pi/agent/mcp.json` so a local
 * pi session can reach `/mcp` (design.md Decision 5, Decision 11).
 *
 * Reuses the discipline proven in `packages/apple-tools/src/mcp-config.ts`:
 * read → merge exactly one key → atomic write; refuse a present-but-unparseable
 * file rather than "fixing" it; inject all filesystem access so the suite never
 * touches real user config.
 *
 * TWO traps this module exists to avoid.
 *
 * 1. **The legacy-default trap.** Per the `pi-mcp-adapter` 2.20.0 changelog,
 *    "Legacy remains the default." An entry written WITHOUT `protocolVersion`
 *    gets the legacy handshake — `initialize` plus `Mcp-Session-Id` — against a
 *    server that is spec-bound to ignore both. The failure would look like a
 *    handshake timeout rather than a config mistake, so `protocolVersion` is
 *    never omitted (J2).
 *
 * 2. **The wrong-shape trap.** `ensureMcpEntry` writes a stdio `command` entry
 *    for iMCP. This endpoint is HTTP and must be declared by `url` (J1).
 */

/** Injected filesystem surface. `readFile` returns null when absent. */
export interface ConfigIO {
  readFile: (path: string) => string | null;
  /** Atomic write (temp-file + rename). */
  writeFileAtomic: (path: string, content: string) => void;
}

/**
 * The reserved key (Decision 11). Namespaced by product so it cannot collide
 * with `iMCP` or a future provisioner.
 */
export const DASHBOARD_MCP_KEY = "pi-dashboard";

/** Pinned rather than "auto": this server serves exactly one revision. */
export const PROVISIONED_PROTOCOL_VERSION = "2026-07-28";

export type ProvisionResult =
  | { ok: true; action: "created" | "updated" | "unchanged" }
  | {
      ok: false;
      state: "CONFIG_UNPARSEABLE" | "CONFIG_WRITE_FAILED" | "FOREIGN_ENTRY";
      message: string;
    };

export interface DashboardMcpEntry {
  url: string;
  protocolVersion: string;
}

export function buildDashboardEntry(url: string): DashboardMcpEntry {
  return { url, protocolVersion: PROVISIONED_PROTOCOL_VERSION };
}

function parseConfig(
  io: ConfigIO,
  path: string,
): { parsed: Record<string, unknown> } | { error: ProvisionResult } {
  const raw = io.readFile(path);
  // An absent or empty file is first-run, not corruption (J8).
  if (raw === null || raw.trim() === "") return { parsed: {} };
  try {
    const val = JSON.parse(raw);
    if (val === null || typeof val !== "object" || Array.isArray(val)) {
      // J5's second case: valid JSON whose root is an array. Refused, because
      // merging into it would silently discard the operator's document.
      return {
        error: { ok: false, state: "CONFIG_UNPARSEABLE", message: `${path} is not a JSON object` },
      };
    }
    return { parsed: val as Record<string, unknown> };
  } catch (e) {
    return {
      error: {
        ok: false,
        state: "CONFIG_UNPARSEABLE",
        message: `${path} contains invalid JSON: ${(e as Error).message}`,
      },
    };
  }
}

/**
 * Write (or refresh) the dashboard entry.
 *
 * Collision policy for the reserved key, per Decision 11:
 *   - absent                      → create
 *   - present AND declares a url  → overwrite (ours; the port may have moved)
 *   - present, any other shape    → REFUSE the whole write, file untouched
 *
 * The refusal is deliberately total rather than "write the other keys anyway":
 * a partial write against a config we do not understand is exactly the silent
 * clobber J6 forbids.
 */
export function provisionDashboardEntry(
  io: ConfigIO,
  path: string,
  url: string,
): ProvisionResult {
  const read = parseConfig(io, path);
  if ("error" in read) return read.error;
  const config = read.parsed;

  const rawServers = config.mcpServers;
  if (rawServers !== undefined && (!rawServers || typeof rawServers !== "object" || Array.isArray(rawServers))) {
    return {
      ok: false,
      state: "CONFIG_UNPARSEABLE",
      message: `${path}: "mcpServers" must be an object`,
    };
  }
  const servers = (rawServers as Record<string, unknown> | undefined) ?? {};

  const existing = servers[DASHBOARD_MCP_KEY];
  if (existing !== undefined) {
    const isOurs =
      typeof existing === "object" &&
      existing !== null &&
      !Array.isArray(existing) &&
      typeof (existing as { url?: unknown }).url === "string";
    if (!isOurs) {
      return {
        ok: false,
        state: "FOREIGN_ENTRY",
        message: `${path}: mcpServers["${DASHBOARD_MCP_KEY}"] exists but is not a dashboard HTTP entry; refusing to overwrite it`,
      };
    }
  }

  const entry = buildDashboardEntry(url);
  const unchanged =
    existing !== undefined && JSON.stringify(existing) === JSON.stringify(entry);
  if (unchanged) return { ok: true, action: "unchanged" };

  const next = {
    ...config,
    mcpServers: { ...servers, [DASHBOARD_MCP_KEY]: entry },
  };

  try {
    io.writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  } catch (e) {
    // J7: an unwritable directory surfaces cleanly. The caller keeps running —
    // provisioning is a convenience, not a precondition for serving /mcp.
    return {
      ok: false,
      state: "CONFIG_WRITE_FAILED",
      message: `${path}: ${(e as Error).message}`,
    };
  }

  return { ok: true, action: existing === undefined ? "created" : "updated" };
}

/** Minimum `pi-mcp-adapter` that speaks this revision (Decision 5). */
export const ADAPTER_VERSION_FLOOR = "2.20.0";

export type AdapterProbeResult =
  | { ok: true; version: string }
  | { ok: false; reason: "absent" | "below-floor" | "unparseable"; message: string };

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10));
  const pb = b.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Diagnose the installed adapter (X1, X2, X3).
 *
 * The point is the DIAGNOSTIC. Without this probe, an adapter below the floor
 * fails as a silent legacy-handshake hang, which is close to un-debuggable from
 * the client side. Naming both the required floor and the installed version
 * turns it into a one-line fix.
 */
export function probeAdapterVersion(installed: string | null): AdapterProbeResult {
  if (installed === null) {
    return {
      ok: false,
      reason: "absent",
      message: `pi-mcp-adapter is not installed. The dashboard MCP endpoint requires >= ${ADAPTER_VERSION_FLOOR}.`,
    };
  }
  if (!/^\d+\.\d+\.\d+/.test(installed)) {
    return {
      ok: false,
      reason: "unparseable",
      message: `Could not parse the installed pi-mcp-adapter version ("${installed}"). Required: >= ${ADAPTER_VERSION_FLOOR}.`,
    };
  }
  if (compareSemver(installed, ADAPTER_VERSION_FLOOR) < 0) {
    return {
      ok: false,
      reason: "below-floor",
      message: `pi-mcp-adapter ${installed} is below the required floor ${ADAPTER_VERSION_FLOOR}; protocol ${PROVISIONED_PROTOCOL_VERSION} would fall back to the legacy handshake. Upgrade with: pi ext update pi-mcp-adapter`,
    };
  }
  return { ok: true, version: installed };
}
