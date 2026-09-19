/**
 * Provider REST API routes: read/write custom LLM providers (~/.pi/agent/providers.json).
 */

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import { collectDashboardOrigins, isSelfPointing } from "../model-proxy/recursion-guard.js";
import { refreshModelRegistry } from "../model-proxy/registry-singleton.js";
import { type ProbeApi, type ProbeResult, probeProvider, resolveProbeApiKey } from "../package/provider-probe.js";
import type { BrowserGateway } from "../pairing/browser-gateway.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import { getTunnelUrl } from "../tunnel/tunnel.js";
import { deleteProviderHealth, getAllProviderHealth, type ProviderHealth, retainProviderHealth, setProviderHealth } from "./provider-health-cache.js";
import type { NetworkGuard } from "./route-deps.js";

const REDACTED = "***";
const CONFIG_PATH = join(homedir(), ".pi", "agent", "providers.json");

function toHealth(result: ProbeResult): ProviderHealth {
  return result.ok
    ? { ok: true, status: result.status, modelCount: result.modelCount, testedAt: Date.now() }
    : { ok: false, status: result.status, error: result.error, testedAt: Date.now() };
}

// Run probeProvider for a just-saved provider and cache the result. Resolves the
// apiKey the same way the Test route does ($ENV / literal). Never throws.
async function probeAndCacheProvider(name: string, entry: ProviderEntry): Promise<void> {
  // An unprobeable config (blank baseUrl / no api type) must not leave a stale
  // health entry from a prior save. Drop it so the row reads "not tested".
  if (!entry.baseUrl || !entry.api) {
    deleteProviderHealth(name);
    return;
  }
  const resolved = resolveProbeApiKey({ apiKey: entry.apiKey, name, readProviders: readProvidersRaw });
  if (!resolved.ok) {
    setProviderHealth(name, { ok: false, error: resolved.error, testedAt: Date.now() });
    return;
  }
  const result = await probeProvider({ baseUrl: entry.baseUrl, apiKey: resolved.key, api: entry.api as ProbeApi });
  setProviderHealth(name, toHealth(result));
}

interface ProviderEntry {
  baseUrl: string;
  apiKey: string;
  api?: string;
  /**
   * Resolution state of a `$NAME` `apiKey` reference. Present ONLY when
   * `apiKey` is a `$NAME` reference; omitted for literal or empty keys.
   *
   * Resolution is a SERVER-side fact — the reference is resolved against this
   * process's environment, which a browser cannot read. Without this
   * annotation a resolved `$NAME` endpoint is indistinguishable from an
   * unresolved one on the client, and the connected list would hide a usable
   * endpoint (and, being `configured`, withhold it from the Add picker too).
   * See change: redesign-providers-settings-page (D1, E8).
   */
  apiKeyResolved?: boolean;
}

function readProvidersRaw(): Record<string, ProviderEntry> {
  return readProvidersFileDataChecked().fileData.providers ?? {};
}

/** Sha256 digests of corrupt-bytes backups made in THIS process (dedup, so a
 *  crash-loop of refused writes never stacks one backup per attempt). */
const quarantinedProviderBackups = new Set<string>();

/** `YYYYMMDDTHHMMSSsssZ` — sortable, millisecond precision, NTFS-safe (no `:`). */
function quarantineStamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(".", "");
}

/**
 * Copy a corrupt providers.json's bytes to `providers.json.corrupt-<stamp>`
 * before any write is refused, so a refusal never leaves the operator's role
 * configuration unrecoverable. Mirrors `auth.json`'s quarantine (see change:
 * fix-corrupt-auth-json-500).
 *
 * The bytes written are the exact bytes that were READ — never a fresh re-read
 * of the file, which can change in between — and a COPY, never a rename: pi and
 * the dashboard both replace the file atomically, so a read->rename is a TOCTOU
 * that can move away a file that became valid in the meantime.
 *
 * `wx` so two writers (or two dashboards on one `$HOME`) never overwrite an
 * existing backup; on EEXIST a `-N` suffix is appended. Mode 0600: a truncated
 * provider config can still hold API keys.
 *
 * Returns true on a DEDUP HIT too — it means "a backup of these exact bytes was
 * made earlier in this process", not "this call performed the copy".
 */
function quarantineCorruptProvidersFile(bytes: Buffer): boolean {
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (quarantinedProviderBackups.has(digest)) return true;

  const base = `${CONFIG_PATH}.corrupt-${quarantineStamp()}`;
  let target = base;
  for (let n = 1; ; n++) {
    try {
      writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
    } catch (err: any) {
      if (err?.code === "EEXIST") {
        target = `${base}-${n}`;
        continue;
      }
      // A failed exclusive create can leave a partial file behind; remove it so
      // a retry reuses the same name instead of stacking -N suffixes.
      try {
        unlinkSync(target);
      } catch {
        /* best-effort cleanup */
      }
      console.warn(
        `[providers] could not quarantine corrupt providers.json: write ${target} failed:`,
        err?.message ?? err,
      );
      return false;
    }
    quarantinedProviderBackups.add(digest);
    console.warn(
      `[providers] providers.json is corrupt (unparseable content); quarantined a byte-exact copy to ${target}`,
    );
    return true;
  }
}

interface CheckedProvidersRead {
  fileData: Record<string, any>;
  corrupt: boolean;
  quarantined: boolean;
}

/**
 * Checked read of the FULL providers.json — every top-level key, not just
 * `providers`. Single-provider and whole-map writes must preserve `roles` /
 * `rolePresets` / `activePreset`, so they mutate this object rather than
 * rebuilding one.
 *
 * Content failures (truncated / non-object) never throw: the bytes are
 * quarantined and the caller gets `{}` plus `corrupt: true`. Read failures
 * (EACCES, EISDIR, ...) still throw — an unreadable file is a deployment bug,
 * not corruption. ENOENT keeps its meaning: `{}`, not corrupt.
 *
 * Two duties consume this and they differ: the GET path TOLERATES corruption
 * (an unparseable file must not 5xx the read), while every WRITE path REFUSES
 * it — rebuilding the document from `{}` would silently destroy the operator's
 * role configuration, the endpoint's highest-consequence invariant (D3).
 */
function readProvidersFileDataChecked(): CheckedProvidersRead {
  if (!existsSync(CONFIG_PATH)) return { fileData: {}, corrupt: false, quarantined: false };
  let bytes: Buffer;
  try {
    bytes = readFileSync(CONFIG_PATH);
  } catch (err: any) {
    if (err?.code === "ENOENT") return { fileData: {}, corrupt: false, quarantined: false };
    throw err;
  }
  try {
    const text = bytes.toString("utf-8");
    const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const parsed: unknown = JSON.parse(stripped);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SyntaxError("providers.json content is not a JSON object");
    }
    // The `providers` VALUE needs the same check as the document: every route
    // does `fileData.providers ?? {}` and then writes through it. An ARRAY
    // accepts `existing[name] = entry` but `JSON.stringify` serialises it
    // positionally and DROPS the named key, so the write is acknowledged and
    // silently lost; a STRING throws on that same assignment (strict mode) and
    // 500s. `null`/absent keeps its established "no providers yet" meaning.
    const providers = (parsed as Record<string, any>).providers;
    if (
      providers !== undefined &&
      providers !== null &&
      (typeof providers !== "object" || Array.isArray(providers))
    ) {
      throw new SyntaxError("providers.json `providers` is not a JSON object");
    }
    return { fileData: parsed as Record<string, any>, corrupt: false, quarantined: false };
  } catch (err: any) {
    if (!(err instanceof SyntaxError)) throw err;
    const quarantined = quarantineCorruptProvidersFile(bytes);
    return { fileData: {}, corrupt: true, quarantined };
  }
}

/**
 * Refusal payload for a corrupt providers.json on a WRITE path. Names the file
 * and whether the bytes were safely quarantined, never any credential material.
 *
 * 409 rather than `auth.json`'s 500: this is a state conflict the operator can
 * fix (and provider-routes already uses 409 for its other refusal), not a
 * server fault — and it must be distinguishable from a real crash.
 */
function corruptProvidersRefusal(quarantined: boolean): { success: false; error: string } {
  return {
    success: false,
    error: quarantined
      ? `Refusing to write providers: ${CONFIG_PATH} is corrupt. A byte-exact copy was quarantined beside it. Fix or remove the file manually, then try again.`
      : `Refusing to write providers: ${CONFIG_PATH} is corrupt and could not be backed up. Fix or remove the file manually, then try again.`,
  };
}

/**
 * Atomic tmp+rename write of the full file. The single-provider routes MUST
 * perform their read and this write with NO `await` in between (D3): the
 * read-modify-write is then one synchronous stretch, so two requests handled
 * by the same process cannot lose-update each other.
 */
function writeProvidersFileData(fileData: Record<string, any>): void {
  const dir = dirname(CONFIG_PATH);
  mkdirSync(dir, { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
  // 0600: this file stores API keys, and `renameSync` REPLACES the destination
  // with the tmp inode — the live file inherits the tmp's mode, not its own
  // previous one. Without this a permissive umask publishes the credentials
  // group/world-readable. Mirrors auth.json (provider-auth-storage.ts).
  writeFileSync(tmp, JSON.stringify(fileData, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  // `mode` applies only at CREATION, so a tmp left by a crashed earlier write
  // would carry its old (possibly 0644) mode through the rename.
  chmodSync(tmp, 0o600);
  renameSync(tmp, CONFIG_PATH);
}

function redactProviders(
  providers: Record<string, ProviderEntry>,
): Record<string, ProviderEntry> {
  const redacted: Record<string, ProviderEntry> = {};
  for (const [name, entry] of Object.entries(providers)) {
    const isEnvRef = !!(entry.apiKey && entry.apiKey.startsWith("$"));
    redacted[name] = {
      ...entry,
      apiKey: isEnvRef ? entry.apiKey : entry.apiKey ? REDACTED : "",
    };
    if (isEnvRef) {
      // Annotate resolution against THIS process's env, so the browser client
      // can tell a usable `$NAME` endpoint from a dead one without needing an
      // environment oracle it cannot have. Matches the `$NAME is set` semantics
      // the client uses when the annotation is absent (an older server).
      const varName = entry.apiKey.slice(1);
      const value = varName ? process.env[varName] : undefined;
      redacted[name].apiKeyResolved = value !== undefined && value !== "";
    }
  }
  return redacted;
}

export function registerProviderRoutes(fastify: FastifyInstance, deps: { networkGuard: NetworkGuard; piGateway?: PiGateway; browserGateway?: BrowserGateway; port?: number }): void {
  const { networkGuard, piGateway } = deps;
  fastify.get(
    "/api/providers",
    { preHandler: networkGuard },
    async () => {
      const providers = readProvidersRaw();
      // Cached health only — never re-probes on read. See change:
      // surface-provider-health-in-settings.
      return { success: true, providers: redactProviders(providers), health: getAllProviderHealth() };
    },
  );

  fastify.put(
    "/api/providers",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body as Record<string, any> | null;
      if (!body || typeof body !== "object" || !body.providers || typeof body.providers !== "object") {
        return reply.code(400).send({ success: false, error: "Invalid body" });
      }

      const incoming = body.providers as Record<string, ProviderEntry>;

      // Blank-name guard: the client preflights this, but a direct PUT can
      // still smuggle "" / whitespace-only provider names. Reject them at the
      // API boundary so they never reach providers.json. See change:
      // fix-custom-provider-save-and-auth.
      for (const name of Object.keys(incoming)) {
        if (name.trim() === "") {
          return reply.code(400).send({
            success: false,
            error: "Provider name is required",
          });
        }
      }

      // Recursion guard: reject providers pointing back at the dashboard
      const dashboardPort = deps.port ?? 8000;
      const tunnelUrl = getTunnelUrl();
      const tunnelHostname = tunnelUrl ? new URL(tunnelUrl).hostname : undefined;
      const origins = collectDashboardOrigins(dashboardPort, { tunnelHostname });
      for (const [name, entry] of Object.entries(incoming)) {
        if (entry.baseUrl && isSelfPointing(entry.baseUrl, origins)) {
          return reply.code(400).send({
            success: false,
            code: "RECURSIVE_PROXY",
            message: `Provider "${name}" baseUrl points back at this dashboard`,
            offendingBaseUrl: entry.baseUrl,
          });
        }
      }

      const existing = readProvidersRaw();

      // Masked-sentinel guard: `***` means "keep the existing key" and is only
      // valid when the named provider already exists. Persisting `***` as a
      // literal apiKey would corrupt the credential, so reject it when there is
      // no existing entry to preserve. See change: fix-custom-provider-save-and-auth.
      for (const [name, entry] of Object.entries(incoming)) {
        if (entry.apiKey === REDACTED && !existing[name]) {
          return reply.code(400).send({
            success: false,
            error: `Provider "${name}" has no saved API key to preserve; enter the API key before saving.`,
          });
        }
      }

      // Merge: preserve redacted apiKey values from existing file
      const merged: Record<string, ProviderEntry> = {};
      for (const [name, entry] of Object.entries(incoming)) {
        merged[name] = {
          baseUrl: entry.baseUrl,
          apiKey:
            entry.apiKey === REDACTED && existing[name]
              ? existing[name].apiKey
              : entry.apiKey,
          api: entry.api,
        };
      }

      // Read the full file to preserve any non-providers fields. A CORRUPT file
      // REFUSES the write rather than "starting fresh": rebuilding the document
      // from `{}` would silently destroy `roles` / `rolePresets` /
      // `activePreset` — the endpoint's highest-consequence invariant (D3).
      const putRead = readProvidersFileDataChecked();
      if (putRead.corrupt) {
        return reply.code(409).send(corruptProvidersRefusal(putRead.quarantined));
      }
      const fileData = putRead.fileData;
      fileData.providers = merged;

      // Atomic tmp+rename so concurrent readers never observe a partial file
      // (Bug 7). See change: add-agent-role-model-tools. Shares the
      // single-provider helper so the 0600 credential-file mode cannot drift
      // between the whole-map and single-provider write paths.
      writeProvidersFileData(fileData);

      // Broadcast credentials_updated so each bridge re-reads providers.json
      // and pushes a fresh per-session models_list. Browsers receive those
      // pushes via the existing per-session broadcast — no global wipe.
      // See change: simplify-model-selection-channels.
      if (piGateway) {
        piGateway.broadcast({ type: "credentials_updated" });
      }

      // Eager-refresh model proxy registry so /v1/models reflects the change.
      refreshModelRegistry().catch(() => {});

      // Probe each saved provider and cache its health so Settings → Providers
      // renders the pill without a manual Test. Awaited (default) so the pill is
      // correct on the next read. See change: surface-provider-health-in-settings.
      retainProviderHealth(Object.keys(merged));
      await Promise.all(Object.entries(merged).map(([name, entry]) => probeAndCacheProvider(name, entry)));

      return { success: true };
    },
  );

  // Single-provider upsert (D3): create-if-absent, explicit field semantics —
  // an omitted baseUrl/api/apiKey preserves the stored value, the `***`
  // sentinel preserves the stored key, only an explicit non-sentinel value
  // replaces one. Mutates the PARSED file object so every top-level key other
  // than `providers` (roles, rolePresets, activePreset) survives. The name is
  // the URL segment (percent-encoded; keys may contain `/`), decoded once by
  // the router and used verbatim as the JSON key. Renaming is NOT supported
  // here — the health cache is keyed by name; a rename is DELETE + PATCH.
  fastify.patch<{ Params: { name: string } }>(
    "/api/providers/:name",
    { preHandler: networkGuard },
    async (request, reply) => {
      const name = request.params.name;
      // Unlike PUT, the name arrives as a URL segment — PUT's body-key guard
      // does not cover it, so the blank-name rejection lives here.
      if (typeof name !== "string" || name.trim() === "") {
        return reply.code(400).send({ success: false, error: "Provider name is required" });
      }
      const body = request.body as Record<string, any> | null;
      if (!body || typeof body !== "object") {
        return reply.code(400).send({ success: false, error: "Invalid body" });
      }
      for (const field of ["baseUrl", "apiKey", "api"] as const) {
        if (body[field] !== undefined && typeof body[field] !== "string") {
          return reply.code(400).send({ success: false, error: `Invalid ${field}` });
        }
      }

      // Read → validate → write with NO await in between (D3, X10). The
      // corruption refusal is the only early return, and it precedes mutation.
      const patchRead = readProvidersFileDataChecked();
      if (patchRead.corrupt) {
        return reply.code(409).send(corruptProvidersRefusal(patchRead.quarantined));
      }
      const fileData = patchRead.fileData;
      const existing: Record<string, ProviderEntry> = fileData.providers ?? {};
      const prev = existing[name];

      // Masked-sentinel guard (inherited from PUT): persisting `***` as a
      // literal apiKey would corrupt the credential.
      if (body.apiKey === REDACTED && !prev) {
        return reply.code(400).send({
          success: false,
          error: `Provider "${name}" has no saved API key to preserve; enter the API key before saving.`,
        });
      }

      const entry: ProviderEntry = {
        baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : prev?.baseUrl ?? "",
        apiKey:
          body.apiKey === REDACTED
            ? prev.apiKey
            : typeof body.apiKey === "string" ? body.apiKey : prev?.apiKey ?? "",
        api: typeof body.api === "string" ? body.api : prev?.api,
      };

      // Recursion guard (inherited from PUT, X12): reject a baseUrl pointing
      // back at the dashboard's own proxy endpoint.
      const dashboardPort = deps.port ?? 8000;
      const tunnelUrl = getTunnelUrl();
      const tunnelHostname = tunnelUrl ? new URL(tunnelUrl).hostname : undefined;
      const origins = collectDashboardOrigins(dashboardPort, { tunnelHostname });
      if (entry.baseUrl && isSelfPointing(entry.baseUrl, origins)) {
        return reply.code(400).send({
          success: false,
          code: "RECURSIVE_PROXY",
          message: `Provider "${name}" baseUrl points back at this dashboard`,
          offendingBaseUrl: entry.baseUrl,
        });
      }

      existing[name] = entry;
      fileData.providers = existing;
      writeProvidersFileData(fileData);

      // Same terms as the whole-map write: bridges reload providers.json and
      // push fresh per-session models_list (D3/task 4.7).
      if (piGateway) {
        piGateway.broadcast({ type: "credentials_updated" });
      }
      refreshModelRegistry().catch(() => {});

      // Health retention PRUNES to the set it is given — pass the FULL
      // remaining key list, or every other provider's pill would be wiped
      // (D3/task 4.4). The probe is fully DETACHED from the response (P1/P2):
      // an upstream that never answers must not delay the write.
      retainProviderHealth(Object.keys(existing));
      void probeAndCacheProvider(name, entry).catch(() => {});

      return { success: true };
    },
  );

  // Single-provider delete (D3): removes only the named entry, drops only its
  // own cached health. Deleting an absent name succeeds — the post-condition
  // (name absent) already holds — and rewrites nothing.
  fastify.delete<{ Params: { name: string } }>(
    "/api/providers/:name",
    { preHandler: networkGuard },
    async (request, reply) => {
      const name = request.params.name;
      if (typeof name !== "string" || name.trim() === "") {
        return reply.code(400).send({ success: false, error: "Provider name is required" });
      }

      const deleteRead = readProvidersFileDataChecked();
      if (deleteRead.corrupt) {
        return reply.code(409).send(corruptProvidersRefusal(deleteRead.quarantined));
      }
      const fileData = deleteRead.fileData;
      const existing: Record<string, ProviderEntry> = fileData.providers ?? {};
      if (!(name in existing)) {
        return { success: true };
      }
      delete existing[name];
      fileData.providers = existing;
      writeProvidersFileData(fileData);

      if (piGateway) {
        piGateway.broadcast({ type: "credentials_updated" });
      }
      refreshModelRegistry().catch(() => {});

      // Drop ONLY the deleted provider's pill; the cache is keyed by name, so
      // every other provider's cached health must survive (D3/task 4.4).
      deleteProviderHealth(name);

      return { success: true };
    },
  );

  // Test a provider configuration without saving it. Accepts literal api keys,
  // $ENV_VAR references, or the REDACTED sentinel (***) for already-saved entries.
  fastify.post(
    "/api/providers/test",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body as Record<string, any> | null;
      if (!body || typeof body !== "object") {
        return reply.code(400).send({ ok: false, error: "Invalid body" });
      }
      const name = typeof body.name === "string" ? body.name : undefined;
      const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
      const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
      const api = typeof body.api === "string" ? (body.api as ProbeApi) : undefined;
      if (!baseUrl) {
        return reply.code(400).send({ ok: false, error: "baseUrl is required" });
      }
      if (!apiKey) {
        return reply.code(400).send({ ok: false, error: "apiKey is required" });
      }
      if (!api) {
        return reply.code(400).send({ ok: false, error: "api type is required" });
      }

      const resolved = resolveProbeApiKey({
        apiKey,
        name,
        readProviders: readProvidersRaw,
      });
      if (!resolved.ok) {
        // A key-resolution failure is still a Test result: cache it so a prior
        // green pill does not survive a now-failing config. See change:
        // surface-provider-health-in-settings.
        if (name) setProviderHealth(name, { ok: false, error: resolved.error, testedAt: Date.now() });
        return { ok: false, error: resolved.error };
      }

      const result = await probeProvider({
        baseUrl,
        apiKey: resolved.key,
        api,
      });
      // Cache the Test result so the panel's pill reflects it. See change:
      // surface-provider-health-in-settings.
      if (name) setProviderHealth(name, toHealth(result));
      return result;
    },
  );
}
