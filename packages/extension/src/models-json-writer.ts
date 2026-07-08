/**
 * models-json-writer.ts — persist dashboard-managed custom providers into
 * pi-native `~/.pi/agent/models.json`.
 *
 * pi's canonical custom-model store is `models.json`, read by
 * `ModelRegistry.create(authStorage, models.json)` in every session, flow,
 * subagent, AND the dashboard server. The dashboard previously kept custom
 * providers only in its own `providers.json` + ephemeral runtime
 * `pi.registerProvider()`, so they were invisible cross-process (server
 * `GET /api/models` returned zero customs) and raced async discovery in
 * spawned sessions. Persisting discovered models here makes one registry
 * serve every consumer.
 *
 * Merge-not-clobber: only providers named in `managedNames` (tracked in the
 * dashboard's own `providers.json#managedProviders`) are upserted/removed;
 * hand-authored providers and all non-`providers` top-level keys are
 * preserved. Writes are atomic (tmp+rename). `models.json` stays pure pi
 * schema — no dashboard marker keys.
 *
 * See change: add-agent-role-model-tools (capability custom-provider-model-registry).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// -- Types ----------------------------------------------------------------

export interface ManagedModelDef {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow?: number;
  maxTokens?: number;
}

export interface ManagedProviderEntry {
  baseUrl: string;
  api?: string;
  apiKey?: string;
  models: ManagedModelDef[];
}

// -- Path -----------------------------------------------------------------

// Resolved lazily so HOME can be changed in tests.
function modelsJsonPath(): string {
  return join(homedir(), ".pi", "agent", "models.json");
}

// -- I/O ------------------------------------------------------------------

/**
 * Read `models.json`. Tolerant of a missing file and malformed JSON; both
 * return `{}`. Never throws.
 */
export function loadModelsJson(): Record<string, any> {
  const p = modelsJsonPath();
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, any>) : {};
  } catch (err: any) {
    console.warn(
      `[dashboard] models.json parse failed at ${p}: ${err?.message ?? String(err)}`,
    );
    return {};
  }
}

/** Atomic write (tmp+rename) so readers never observe a partial file. */
export function saveModelsJson(data: Record<string, unknown>): void {
  const p = modelsJsonPath();
  mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, p);
}

// -- Merge (pure) ---------------------------------------------------------

/**
 * Upsert dashboard-managed providers into a `models.json` object.
 *
 * - Providers named in `managedNames` are the dashboard's to own: present in
 *   `managed` → upserted; absent from `managed` (deleted in the UI) → removed.
 * - Providers NOT in `managedNames` (hand-authored) are preserved untouched.
 * - Non-`providers` top-level keys are preserved.
 *
 * Pure — no I/O. Exported for unit testing.
 */
export function mergeManagedProviders(
  current: Record<string, any>,
  managed: Record<string, ManagedProviderEntry>,
  managedNames: readonly string[],
): Record<string, any> {
  const out: Record<string, any> = { ...current };
  const providers: Record<string, any> = {
    ...(current.providers && typeof current.providers === "object" ? current.providers : {}),
  };
  const managedSet = new Set(managedNames);

  // Drop stale managed providers (owned by the dashboard but no longer present).
  for (const name of Object.keys(providers)) {
    if (managedSet.has(name) && !(name in managed)) delete providers[name];
  }

  // Upsert current managed providers in pi schema shape.
  for (const [name, entry] of Object.entries(managed)) {
    providers[name] = {
      baseUrl: entry.baseUrl,
      ...(entry.api ? { api: entry.api } : {}),
      ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
      models: entry.models,
    };
  }

  out.providers = providers;
  return out;
}

/** Read → merge → atomic write dashboard-managed providers into `models.json`. */
export function persistManagedProviders(
  managed: Record<string, ManagedProviderEntry>,
  managedNames: readonly string[],
): void {
  const merged = mergeManagedProviders(loadModelsJson(), managed, managedNames);
  saveModelsJson(merged);
}
