/**
 * `acpAgents` registry + `acp` settings parse (pure; wired into `loadConfig()`).
 *
 * Malformed agent entries are dropped, duplicate ids keep the first, numeric
 * settings are clamped — each with a logged warning (never a throw: a bad ACP
 * block must not break config loading for everything else).
 *
 * See change: add-acp-session-driver (acp-agent-sessions, "ACP agent registry and configuration").
 */

export interface AcpAgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** `false` (default) → in-process host; `true` → out-of-process adapter under the keeper. */
  durable: boolean;
}

export interface AcpSettings {
  protocolV2: boolean;
  spawnTimeoutMs: number;
  requestTimeoutMs: number;
  maxLineBytes: number;
  eventLogMaxBytes: number;
}

export const DEFAULT_ACP_SETTINGS: AcpSettings = {
  protocolV2: false,
  spawnTimeoutMs: 30_000,
  requestTimeoutMs: 30_000,
  maxLineBytes: 4 * 1024 * 1024,
  eventLogMaxBytes: 64 * 1024 * 1024,
};

const RANGES: Record<Exclude<keyof AcpSettings, "protocolV2">, [number, number]> = {
  spawnTimeoutMs: [5_000, 120_000],
  requestTimeoutMs: [1_000, 300_000],
  maxLineBytes: [65_536, 67_108_864],
  eventLogMaxBytes: [1_048_576, 1_073_741_824],
};

type Warn = (msg: string) => void;
const defaultWarn: Warn = (msg) => console.warn(`[config] ${msg}`);

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseEnv(raw: unknown): Record<string, string> | undefined {
  if (raw === undefined) return {};
  if (!isRec(raw)) return undefined;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string") return undefined;
    env[k] = v;
  }
  return env;
}

function parseAgent(raw: unknown): AcpAgentConfig | string {
  if (!isRec(raw)) return "entry is not an object";
  if (typeof raw.id !== "string" || raw.id === "") return "missing id";
  if (typeof raw.command !== "string" || raw.command === "") return `agent "${raw.id}": missing command`;
  const args = raw.args === undefined ? [] : raw.args;
  if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) return `agent "${raw.id}": args must be a string array`;
  const env = parseEnv(raw.env);
  if (!env) return `agent "${raw.id}": env must be a string map`;
  if (raw.durable !== undefined && typeof raw.durable !== "boolean") return `agent "${raw.id}": durable must be boolean`;
  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name !== "" ? raw.name : raw.id,
    command: raw.command,
    args: args as string[],
    env,
    durable: raw.durable === true,
  };
}

export function parseAcpAgents(raw: unknown, warn: Warn = defaultWarn): AcpAgentConfig[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warn("acpAgents must be an array; ignoring");
    return [];
  }
  const out: AcpAgentConfig[] = [];
  for (const entry of raw) {
    const parsed = parseAgent(entry);
    if (typeof parsed === "string") {
      warn(`acpAgents: dropped entry (${parsed})`);
    } else if (out.some((a) => a.id === parsed.id)) {
      warn(`acpAgents: dropped duplicate id "${parsed.id}" (first entry wins)`);
    } else out.push(parsed);
  }
  return out;
}

function clamp(key: keyof typeof RANGES, raw: unknown, warn: Warn): number {
  const fallback = DEFAULT_ACP_SETTINGS[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    warn(`acp.${key} must be a number; using default ${fallback}`);
    return fallback;
  }
  const [min, max] = RANGES[key];
  const v = Math.min(max, Math.max(min, Math.trunc(raw)));
  if (v !== raw) warn(`acp.${key}=${raw} out of range [${min}, ${max}]; using ${v}`);
  return v;
}

export function parseAcpSettings(raw: unknown, warn: Warn = defaultWarn): AcpSettings {
  if (raw !== undefined && !isRec(raw)) {
    warn("acp must be an object; using defaults");
    return { ...DEFAULT_ACP_SETTINGS };
  }
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    protocolV2: r.protocolV2 === true,
    spawnTimeoutMs: clamp("spawnTimeoutMs", r.spawnTimeoutMs, warn),
    requestTimeoutMs: clamp("requestTimeoutMs", r.requestTimeoutMs, warn),
    maxLineBytes: clamp("maxLineBytes", r.maxLineBytes, warn),
    eventLogMaxBytes: clamp("eventLogMaxBytes", r.eventLogMaxBytes, warn),
  };
}
