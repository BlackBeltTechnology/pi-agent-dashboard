/**
 * Wiring between the roles plugin and the host's `@role` default model.
 *
 * - `remirrorPiDefaults`: called on every role-watcher change; asks the host to
 *   re-mirror the role default into pi (the host writes only when the role
 *   default's resolution moved).
 * - `registerDefaultModelUsage`: lists the Settings default model under its
 *   role on the Model roles page, reading the ref lazily per request.
 *
 * Both host services are optional: absent → no-op.
 * See change: default-model-follows-role (design D4, D5).
 */

import type { UsageEntry } from "./role-bindings.js";

type Consume = <T>(key: string) => T | undefined;

export const DEFAULT_MODEL_USAGE_OWNER = "dashboard.defaultModel";
export const DEFAULT_MODEL_USAGE_LABEL = "Default model (new sessions)";

export function remirrorPiDefaults(consume: Consume, warn: (msg: string) => void = () => {}): void {
  const remirror = consume<() => Promise<void> | void>("host.remirrorPiDefaults");
  if (typeof remirror !== "function") return;
  try {
    void Promise.resolve(remirror()).catch((e: unknown) => warn(`[roles] re-mirror failed: ${e instanceof Error ? e.message : String(e)}`));
  } catch (e) {
    warn(`[roles] re-mirror failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function registerDefaultModelUsage(consume: Consume, service: { registerUsage(owner: string, fn: () => UsageEntry[]): () => void }): () => void {
  return service.registerUsage(DEFAULT_MODEL_USAGE_OWNER, () => {
    const getRef = consume<() => string | undefined>("host.defaultModelRef");
    const ref = typeof getRef === "function" ? getRef() : undefined;
    return ref ? [{ label: DEFAULT_MODEL_USAGE_LABEL, ref }] : [];
  });
}
