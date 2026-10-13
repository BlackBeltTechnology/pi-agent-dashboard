/**
 * Read-only scan of pi's agent dir for the provider id pi 1.0.3 renamed
 * (`azure-openai-responses` → `azure`). Sessions still using the old id fall
 * back to another model and lose their prompt cache, so the dashboard names
 * where it was found.
 *
 * Side-effect free: `tryReadJson` takes no lock, writes nothing and never
 * quarantines. Each file is read in its own try/catch, so a missing,
 * unreadable, torn or wrong-shaped file contributes nothing and cannot affect
 * the others. The result carries ids and location tokens only — never a value.
 *
 * Glob/fuzzy `enabledModels` patterns are not interpreted (documented gap).
 * `providers.json` is excluded: it only holds dashboard-created custom
 * providers, which never used the built-in id.
 *
 * See change: update-pi-core-1-1-adopt-apis (design D4).
 */
import os from "node:os";
import path from "node:path";
import type { LegacyProviderIdEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { tryReadJson } from "./locked-json-file.js";
import { getRuntimeAgentDir } from "./radius-override.js";

const LEGACY_ID = "azure-openai-responses";
const NEW_ID = "azure";

/** `id` itself, or `id/<model>` — the `/` boundary rejects `azure-openai-responses2`. */
const isLegacy = (value: unknown): boolean =>
  typeof value === "string" && (value === LEGACY_ID || value.startsWith(`${LEGACY_ID}/`));

function readObject(file: string): Record<string, unknown> | undefined {
  try {
    const read = tryReadJson(file);
    return read.ok ? read.data : undefined;
  } catch {
    return undefined; // unreadable (EACCES, EISDIR, …): skip until the next poll
  }
}

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

function resolveAgentDir(): string {
  return (
    getRuntimeAgentDir() ??
    process.env.PI_CODING_AGENT_DIR ??
    path.join(os.homedir(), ".pi", "agent")
  );
}

export function scanLegacyProviderIds(opts: { agentDir?: string } = {}): LegacyProviderIdEntry[] {
  const dir = opts.agentDir ?? resolveAgentDir();
  const locations: string[] = [];

  const auth = readObject(path.join(dir, "auth.json"));
  if (auth && Object.hasOwn(auth, LEGACY_ID)) locations.push("auth.json");

  const settings = readObject(path.join(dir, "settings.json"));
  if (settings) {
    if (isLegacy(settings.defaultProvider)) locations.push("settings.json:defaultProvider");
    if (Array.isArray(settings.enabledModels) && settings.enabledModels.some(isLegacy)) {
      locations.push("settings.json:enabledModels");
    }
    const levels = asObject(settings.modelThinkingLevels);
    if (levels && Object.keys(levels).some(isLegacy)) locations.push("settings.json:modelThinkingLevels");
  }

  const providers = asObject(readObject(path.join(dir, "models.json"))?.providers);
  if (providers && Object.hasOwn(providers, LEGACY_ID)) locations.push("models.json:providers");

  return locations.length > 0 ? [{ legacyId: LEGACY_ID, newId: NEW_ID, locations }] : [];
}
