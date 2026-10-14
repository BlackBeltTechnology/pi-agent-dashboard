/**
 * Server-side `@fast` resolution (D5). No server-side role resolver exists (the
 * lookup lives in the extension), so this composes the shared pieces:
 * providers.json → `parseRoleConfig` → `resolveModelRef('@fast')` → registry
 * lookup. ANY failure to reach a concrete registry model is `unavailable`
 * (never a throw, never a model call): unbound role, unknown model, null
 * registry, unreadable/malformed providers.json, no stream function.
 * Pure over injected deps; production wiring is `brief-runtime.ts`.
 * See change: add-pending-question-stack.
 */
import { parseRoleConfig, resolveModelRef } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";

export type BriefModelResolution = { ok: true; model: unknown } | { ok: false; reason: string };

export interface BriefModelDeps {
  /** Raw providers.json text; `undefined` when the file does not exist. */
  readProviders: () => Promise<string | undefined>;
  getRegistry: () => Promise<{ find(provider: string, modelId: string): Promise<unknown | null> } | null>;
  hasStreamFn: () => boolean;
}

export function createBriefModelResolver(deps: BriefModelDeps): () => Promise<BriefModelResolution> {
  return async function resolveBriefModel(): Promise<BriefModelResolution> {
    let raw: string | undefined;
    try {
      raw = await deps.readProviders();
    } catch (err) {
      console.warn(`[questions] cannot read providers.json, brief generation unavailable: ${(err as Error).message}`);
      return { ok: false, reason: "providers.json unreadable" };
    }
    let parsed: unknown = {};
    if (raw !== undefined) {
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        console.warn(`[questions] providers.json is not valid JSON, brief generation unavailable: ${(err as Error).message}`);
        return { ok: false, reason: "providers.json malformed" };
      }
    }
    const ref = resolveModelRef("@fast", parseRoleConfig(parsed));
    if (ref.unresolved || !ref.provider || !ref.id) return { ok: false, reason: ref.unresolved ?? "@fast does not resolve" };
    if (!deps.hasStreamFn()) return { ok: false, reason: "model runtime not initialized" };
    try {
      const registry = await deps.getRegistry();
      if (!registry) return { ok: false, reason: "model registry unavailable" };
      const model = await registry.find(ref.provider, ref.id);
      if (!model) return { ok: false, reason: `model ${ref.provider}/${ref.id} not in registry` };
      return { ok: true, model };
    } catch (err) {
      console.warn(`[questions] model registry lookup failed, brief generation unavailable: ${(err as Error).message}`);
      return { ok: false, reason: "model registry error" };
    }
  };
}
