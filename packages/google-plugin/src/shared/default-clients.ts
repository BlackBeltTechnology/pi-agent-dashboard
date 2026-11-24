/**
 * Built-in pi-dashboard.dev app (design D2) and the operator switches.
 * `BUILT_IN` ships EMPTY until Google verification completes; a follow-up change sets
 * `BUILT_IN.local` / `BUILT_IN.remote`. See change: add-google-connect.
 */

export interface BuiltInClient {
  clientId: string;
  clientSecret: string;
}

export interface BuiltInClients {
  /** Desktop client of the verified "pi-dashboard" project (loopback; every product scope). */
  local: BuiltInClient | null;
  /** Web client of "pi-dashboard remote" (only through the return page; no restricted scopes). */
  remote: BuiltInClient | null;
}

export const BUILT_IN: BuiltInClients = { local: null, remote: null };

/** Bump to show the data-use disclosure again (design D8). */
export const DISCLOSURE_VERSION = 1;

/** The static return page every remote built-in sign-in goes through (design D12b). */
export const RETURN_PAGE_URL = "https://pi-dashboard.dev/oauth/return.html";

export interface Switches {
  /** `PI_GOOGLE_DEFAULT_CLIENTS` — false = no built-in app at all (also stops refresh of its grants). */
  defaultClients: boolean;
  /** `PI_GOOGLE_REMOTE_RETURN` — false = no return-page sign-in (new sign-ins only). */
  remoteReturn: boolean;
}

const OFF = new Set(["off", "0", "false"]);
const KNOWN_ON = new Set(["", "on", "1", "true"]);

/**
 * Switch reader over a live `env` (read on every call). `off`, `0`, `false` (case-insensitive) disable;
 * any other value is on, and a value that is neither a known on-spelling nor an off-spelling is warned
 * about once per (name, value) — scenario-gate A1.
 */
export function createSwitchReader(
  env: Record<string, string | undefined> = process.env,
  warn: (msg: string) => void = () => {},
): () => Switches {
  const warned = new Set<string>();
  const read = (name: string): boolean => {
    const raw = env[name];
    if (raw === undefined) return true;
    const v = raw.trim().toLowerCase();
    if (OFF.has(v)) return false;
    if (!KNOWN_ON.has(v) && !warned.has(`${name}=${v}`)) {
      warned.add(`${name}=${v}`);
      warn(`[google] ${name} has an unrecognised value; treating it as on (use off, 0 or false to disable)`);
    }
    return true;
  };
  return () => ({ defaultClients: read("PI_GOOGLE_DEFAULT_CLIENTS"), remoteReturn: read("PI_GOOGLE_REMOTE_RETURN") });
}
