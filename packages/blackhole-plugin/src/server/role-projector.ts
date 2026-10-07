/**
 * blackhole's `roles.bindings` projector (Kind B): keeps role-bound model slots
 * in `pi-blackhole-config.json` as CONCRETE `ModelRef`s that follow the role.
 * blackhole itself only reads literal models, so the file never holds `@role`.
 *
 * Writes go through `config-io` (merge into the existing entry, atomic rename,
 * fingerprint conflict → detached). The projector never takes a path from
 * input: the file is fixed by `resolveBlackholeConfigPath`.
 *
 * See change: add-role-aware-model-refs (D4).
 */
import { THINKING_LEVELS } from "../shared/blackhole-config.js";
import { projectModelField, readModelField } from "./config-io.js";

export const BLACKHOLE_OWNER = "blackhole";

/** The four primary model keys + the three fallback chains a binding may target. */
export const PRIMARY_FIELDS = ["model", "observerModel", "reflectorModel", "dropperModel"] as const;
export const CHAIN_KEYS = ["observerFallbackModels", "reflectorFallbackModels", "dropperFallbackModels"] as const;

const CHAIN_FIELD_RE = /^(observerFallbackModels|reflectorFallbackModels|dropperFallbackModels)\[(0|[1-9]\d*)\]$/;

/** Field allow-list: a primary key, or `<chain>[n]` for a non-negative integer n. */
export function acceptsField(field: string): boolean {
  return (PRIMARY_FIELDS as readonly string[]).includes(field) || CHAIN_FIELD_RE.test(field);
}

/** Structural subset of the roles-plugin service the blackhole plugin uses. */
export interface Concrete {
  provider: string;
  id: string;
  level?: string;
}
export interface RolesBindingsLike {
  version: number;
  resolve(ref: string): { unresolved?: string; provider?: string; id?: string; level?: string; model?: string };
  replaceBindings(owner: string, entries: Array<{ field: string; ref: string; projected: Concrete }>): void;
  getBindings(owner: string): Array<{ field: string; ref: string; status: string; projected: Concrete }>;
  reattach(owner: string, field: string): Promise<unknown>;
  withOwnerLock<T>(owner: string, fn: () => Promise<T> | T): Promise<T>;
  registerProjector(p: {
    owner: string;
    acceptsField(f: string): boolean;
    read(f: string): Concrete | undefined;
    write(f: string, r: Concrete): void;
  }): () => void;
}

export function createBlackholeProjector(filePath: () => string) {
  return {
    owner: BLACKHOLE_OWNER,
    acceptsField,
    read(field: string): Concrete | undefined {
      const m = readModelField(filePath(), field);
      return m ? { provider: m.provider, id: m.id, ...(m.thinking ? { level: m.thinking } : {}) } : undefined;
    },
    write(field: string, r: Concrete): void {
      if (r.level && !(THINKING_LEVELS as readonly string[]).includes(r.level)) {
        throw new Error(`thinking level "${r.level}" is not supported by blackhole`);
      }
      projectModelField(filePath(), field, {
        provider: r.provider,
        id: r.id,
        ...(r.level ? { thinking: r.level } : {}),
      });
    },
  };
}
