/**
 * Client registry view: which OAuth client a browser may use for a NEW sign-in (design D2/D5) and which
 * client a stored account refreshes with. Pure over the store + the built-in constants + the live
 * switches. See change: add-google-connect.
 */
import type { ClientType } from "../shared/client-json.js";
import type { BuiltInClient, BuiltInClients, Switches } from "../shared/default-clients.js";
import { isEmail, normalizeEmail } from "../shared/setup.js";
import type { ClientRef, ClientSummary, GoogleStore, OwnClient } from "./store.js";

export type Browser = "local" | "remote";

/** A concrete client ready for an OAuth request. */
export interface ResolvedClient {
  ref: ClientRef;
  type: ClientType;
  clientId: string;
  clientSecret: string;
  label: string;
}

export interface ClientDeps {
  store: GoogleStore;
  builtIn: BuiltInClients;
  switches: () => Switches;
}

const BUILTIN_LABEL = "pi-dashboard.dev";

function fromBuiltIn(ref: "builtin" | "builtin-remote", c: BuiltInClient): ResolvedClient {
  return {
    ref,
    type: ref === "builtin" ? "installed" : "web",
    clientId: c.clientId,
    clientSecret: c.clientSecret,
    label: BUILTIN_LABEL,
  };
}

function fromOwn(c: OwnClient): ResolvedClient {
  return { ref: `own:${c.id}`, type: c.type, clientId: c.clientId, clientSecret: c.clientSecret, label: c.label };
}

/** The built-in app available for `browser` (design D2), or `null`. */
export function builtinFor(deps: Pick<ClientDeps, "builtIn" | "switches">, browser: Browser): ResolvedClient | null {
  const sw = deps.switches();
  if (!sw.defaultClients) return null;
  if (browser === "local") return deps.builtIn.local ? fromBuiltIn("builtin", deps.builtIn.local) : null;
  if (!sw.remoteReturn) return null;
  return deps.builtIn.remote ? fromBuiltIn("builtin-remote", deps.builtIn.remote) : null;
}

type SelectFailure = { ok: false; status: 400 | 404; error: "client_required" | "client_not_found" | "default_client_unavailable"; clients: ClientSummary[] };
export type SelectResult = { ok: true; client: ResolvedClient } | SelectFailure;

async function failure(deps: ClientDeps, status: 400 | 404, error: SelectFailure["error"]): Promise<SelectFailure> {
  return { ok: false, status, error, clients: await deps.store.summarizeClients() };
}

async function selectExplicit(deps: ClientDeps, client: string, browser: Browser): Promise<SelectResult> {
  if (client === "builtin" || client === "builtin-remote") {
    const b = builtinFor(deps, client === "builtin-remote" ? "remote" : browser);
    if (!b || (client === "builtin-remote" && b.ref !== "builtin-remote")) return failure(deps, 400, "default_client_unavailable");
    return { ok: true, client: b };
  }
  const own = await deps.store.getClient(client.startsWith("own:") ? client.slice(4) : client);
  return own ? { ok: true, client: fromOwn(own) } : failure(deps, 404, "client_not_found");
}

/**
 * Selection order (design D5): explicit `client` → own client whose `domains` contains the email's
 * domain (exact) → the built-in app available for this browser → `client_required` (no silent fallback
 * to an unrelated own client; the reply carries the clients the dialog lists).
 */
export async function selectClient(
  deps: ClientDeps,
  input: { client?: string; email?: string; browser: Browser },
): Promise<SelectResult> {
  if (input.client) return selectExplicit(deps, input.client, input.browser);
  const email = input.email ? normalizeEmail(input.email) : "";
  const own = email && isEmail(email) ? await deps.store.clientForDomain(email.slice(email.indexOf("@") + 1)) : undefined;
  if (own) return { ok: true, client: fromOwn(own) };
  const b = builtinFor(deps, input.browser);
  return b ? { ok: true, client: b } : failure(deps, 400, "client_required");
}

export type RefClientResult =
  | { ok: true; client: ResolvedClient }
  | { ok: false; error: "default_client_unavailable" | "no_client" };

/**
 * The client an existing grant refreshes with: by the account's recorded ref, verified against the
 * recorded Google client id. `PI_GOOGLE_DEFAULT_CLIENTS=off` is the operator's hard stop for both
 * built-in refs; `PI_GOOGLE_REMOTE_RETURN=off` gates new sign-ins only. A shipped client id that no longer
 * matches the recorded one counts as unavailable.
 */
export async function clientForGrant(
  deps: ClientDeps,
  ref: ClientRef,
  recordedClientId: string,
): Promise<RefClientResult> {
  if (ref === "builtin" || ref === "builtin-remote") {
    if (!deps.switches().defaultClients) return { ok: false, error: "default_client_unavailable" };
    const c = ref === "builtin" ? deps.builtIn.local : deps.builtIn.remote;
    if (!c || c.clientId !== recordedClientId) return { ok: false, error: "default_client_unavailable" };
    return { ok: true, client: fromBuiltIn(ref, c) };
  }
  const own = await deps.store.getClient(ref.slice(4));
  if (!own || own.clientId !== recordedClientId) return { ok: false, error: "no_client" };
  return { ok: true, client: fromOwn(own) };
}

/** What the dialog needs per browser: is the built-in app offered (+ its public client id, shown for a Workspace block), and which own clients exist. */
export async function availability(deps: ClientDeps, browser: Browser) {
  const b = builtinFor(deps, browser);
  return {
    browser,
    builtin: b ? { ref: b.ref, available: true as const, clientId: b.clientId } : { available: false as const },
    clients: await deps.store.summarizeClients(),
  };
}
