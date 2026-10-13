/**
 * ACP config options ↔ dashboard model / thinking-level state.
 * Only options with category `model` and `thought_level` are surfaced.
 * See change: add-acp-session-driver (D7, "Config options and commands bridging").
 */
import type { AcpConfigOption } from "@blackbelt-technology/pi-dashboard-shared/acp/update-model.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export function findOption(
  options: Iterable<AcpConfigOption>,
  category: "model" | "thought_level",
): AcpConfigOption | undefined {
  for (const o of options) if (o.category === category) return o;
  return undefined;
}

/** `models_list` entries: provider `acp:<agentId>`, id = option value. */
export function modelInfos(options: Iterable<AcpConfigOption>, agentId: string): ModelInfo[] {
  const opt = findOption(options, "model");
  if (!opt) return [];
  const provider = `acp:${agentId}`;
  const values = opt.options ?? [];
  const infos: ModelInfo[] = values.map((v) => ({ provider, id: v.value, name: v.name }));
  const current = typeof opt.currentValue === "string" ? opt.currentValue : undefined;
  if (current && !infos.some((m) => m.id === current)) infos.unshift({ provider, id: current, name: current });
  return infos;
}

/** `acp:<agentId>/<id>` for the current model, when advertised. */
export function currentModel(options: Iterable<AcpConfigOption>, agentId: string): string | undefined {
  const opt = findOption(options, "model");
  return typeof opt?.currentValue === "string" ? `acp:${agentId}/${opt.currentValue}` : undefined;
}
