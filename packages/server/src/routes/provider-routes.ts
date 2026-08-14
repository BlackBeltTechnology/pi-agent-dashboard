/**
 * Provider REST API routes: read/write custom LLM providers (~/.pi/agent/providers.json).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
}

function readProvidersRaw(): Record<string, ProviderEntry> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return raw.providers ?? {};
  } catch {
    return {};
  }
}

function redactProviders(
  providers: Record<string, ProviderEntry>,
): Record<string, ProviderEntry> {
  const redacted: Record<string, ProviderEntry> = {};
  for (const [name, entry] of Object.entries(providers)) {
    redacted[name] = {
      ...entry,
      apiKey:
        entry.apiKey && entry.apiKey.startsWith("$")
          ? entry.apiKey
          : entry.apiKey
            ? REDACTED
            : "",
    };
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

      // Read raw file to preserve any non-providers fields
      let fileData: Record<string, any> = {};
      if (existsSync(CONFIG_PATH)) {
        try {
          fileData = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
        } catch {
          // start fresh
        }
      }
      fileData.providers = merged;

      const dir = dirname(CONFIG_PATH);
      mkdirSync(dir, { recursive: true });
      // Atomic tmp+rename so concurrent readers never observe a partial file
      // (Bug 7). See change: add-agent-role-model-tools.
      const tmp = `${CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(tmp, JSON.stringify(fileData, null, 2) + "\n", "utf-8");
      renameSync(tmp, CONFIG_PATH);

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
