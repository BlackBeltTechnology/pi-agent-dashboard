/**
 * Request policy shared by verbs, `call` and `serve` (design D11). Applied
 * BEFORE a request leaves the process, in this order:
 *   1. capability gating — a type missing from `GetVersion.availableRequests`
 *      → `unsupported-request`;
 *   2. `call` restrictions — removals, scene-collection / profile changes and
 *      stream settings are denied through `call` (dedicated verbs or the OBS UI
 *      cover them);
 *   3. secret-bearing requests over non-loopback `ws://` → `insecure-remote`
 *      unless `--allow-insecure-remote`;
 *   4. crash deny — `GetInputPropertiesListPropertyItems` on a `screen_capture`
 *      input; the target kind is resolved by name / UUID via `GetInputList`,
 *      and an unresolvable target is denied (fail closed).
 * Every refusal names the reason and the safe alternative.
 * See change: add-obs-studio-plugin.
 */
import { isLoopbackUrl, type ObsConn } from "./connection.js";
import { ObsError } from "./errors.js";

type EntryPoint = "verb" | "call" | "serve";

const CALL_DENIED = new Set([
  "CreateSceneCollection",
  "SetCurrentSceneCollection",
  "CreateProfile",
  "RemoveProfile",
  "SetCurrentProfile",
  "SetProfileParameter",
  "SetStreamServiceSettings",
]);

/** Requests whose body carries a secret (stream key). */
const SECRET_BEARING = new Set(["SetStreamServiceSettings"]);

const CRASH_REQUEST = "GetInputPropertiesListPropertyItems";
const SCREEN_CAPTURE = "screen_capture";

function callAlternative(type: string): string {
  if (type === "SetStreamServiceSettings") return "use `pi-obs stream target <url> --key-stdin`";
  if (/^Remove/.test(type)) return "remove it in the OBS UI";
  return "change scene collections and profiles in the OBS UI";
}

/** Throws when `call` may not send `type`. Pure; no I/O. */
function assertCallAllowed(type: string): void {
  if (/^Remove/.test(type) || CALL_DENIED.has(type)) {
    throw new ObsError("denied", `${type} is not allowed through pi-obs call; ${callAlternative(type)}`);
  }
}

export interface PolicyOptions {
  via: EntryPoint;
  allowInsecureRemote?: boolean;
}

/** Throws when a secret-bearing request would cross plain `ws://` to a non-loopback host. */
export function assertSecretTransport(url: string, type: string, allowInsecureRemote?: boolean): void {
  if (!SECRET_BEARING.has(type) || allowInsecureRemote) return;
  if (url.startsWith("ws://") && !isLoopbackUrl(url)) {
    throw new ObsError("insecure-remote", `${type} carries a secret and ${url} is plain ws:// to a remote host; pass --allow-insecure-remote to send it anyway`);
  }
}

interface InputRow {
  inputName?: string;
  inputUuid?: string;
  inputKind?: string;
  unversionedInputKind?: string;
}

async function assertNotCrashing(conn: ObsConn, data: Record<string, unknown>): Promise<void> {
  const name = typeof data.inputName === "string" ? data.inputName : undefined;
  const uuid = typeof data.inputUuid === "string" ? data.inputUuid : undefined;
  const { inputs = [] } = await conn.call<{ inputs?: InputRow[] }>("GetInputList");
  const hit = inputs.find((i) => (uuid !== undefined && i.inputUuid === uuid) || (uuid === undefined && name !== undefined && i.inputName === name));
  if (!hit) {
    throw new ObsError("unresolved-target", `${CRASH_REQUEST} target ${JSON.stringify(uuid ?? name ?? "")} matches no input; refused because the input kind cannot be checked`);
  }
  if (hit.inputKind === SCREEN_CAPTURE || hit.unversionedInputKind === SCREEN_CAPTURE) {
    throw new ObsError("denied", `${CRASH_REQUEST} on a screen_capture input can hang or crash OBS; use \`pi-obs devices list --kind display\` instead`);
  }
}

/** Apply the whole policy, then send. */
async function guardedCall<T = Record<string, unknown>>(
  conn: ObsConn,
  type: string,
  data: Record<string, unknown> | undefined,
  opts: PolicyOptions,
): Promise<T> {
  if (!conn.availableRequests.has(type)) {
    throw new ObsError("unsupported-request", `this OBS (${conn.obsVersion || "unknown version"}) does not offer ${type}`);
  }
  if (opts.via === "call") assertCallAllowed(type);
  assertSecretTransport(conn.url, type, opts.allowInsecureRemote);
  if (type === CRASH_REQUEST) await assertNotCrashing(conn, data ?? {});
  return conn.call<T>(type, data);
}

/** A connection whose every request goes through the policy. */
export interface GuardedObs {
  readonly conn: ObsConn;
  request<T = Record<string, unknown>>(type: string, data?: Record<string, unknown>): Promise<T>;
}

export function guard(conn: ObsConn, opts: PolicyOptions): GuardedObs {
  return { conn, request: (type, data) => guardedCall(conn, type, data, opts) };
}
