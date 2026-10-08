/**
 * PUT-side role handling: turn role slots in a submitted config into concrete
 * `ModelRef`s (the file NEVER holds `@role`) and compute the owner's new
 * binding set. Pure — the route owns locking, the write and `replaceBindings`.
 *
 * See change: add-role-aware-model-refs (D5).
 */
import { roleSlotRef } from "../shared/blackhole-config.js";
import { CHAIN_KEYS, type Concrete, PRIMARY_FIELDS, type RolesBindingsLike } from "./role-projector.js";

export interface RoleSlotUse {
  field: string;
  ref: string;
}

export type ResolveSlotsResult =
  | { ok: true; concrete: Record<string, unknown>; slots: RoleSlotUse[]; touchedKeys: string[] }
  | { ok: false; status: 400; error: string };

const isModelKey = (k: string): boolean =>
  (PRIMARY_FIELDS as readonly string[]).includes(k) || (CHAIN_KEYS as readonly string[]).includes(k);

/**
 * Replace every role slot in `body` with its current concrete resolution.
 * `roles` is undefined when the roles plugin is absent → any role slot is rejected.
 */
export function resolveRoleSlots(
  body: Record<string, unknown>,
  roles: Pick<RolesBindingsLike, "resolve"> | undefined,
): ResolveSlotsResult {
  const concrete: Record<string, unknown> = { ...body };
  const slots: RoleSlotUse[] = [];
  const touchedKeys = Object.keys(body).filter(isModelKey);

  const toModel = (
    slot: unknown,
    field: string,
  ): { ok: true; model: Record<string, unknown> } | { ok: false; error: string } => {
    const ref = roleSlotRef(slot)!;
    if (!roles) return { ok: false, error: `role ref ${ref} requires the roles plugin (field ${field})` };
    const r = roles.resolve(ref);
    if (r.unresolved || !r.provider || !r.id) return { ok: false, error: `role ${ref} has no model assigned (field ${field})` };
    const extras =
      typeof slot === "object" && slot !== null
        ? {
            ...((slot as { cooldownHours?: number }).cooldownHours !== undefined
              ? { cooldownHours: (slot as { cooldownHours: number }).cooldownHours }
              : {}),
            ...((slot as { contextWindow?: number }).contextWindow !== undefined
              ? { contextWindow: (slot as { contextWindow: number }).contextWindow }
              : {}),
          }
        : {};
    slots.push({ field, ref });
    return { ok: true, model: { provider: r.provider, id: r.id, ...(r.level ? { thinking: r.level } : {}), ...extras } };
  };

  for (const key of touchedKeys) {
    const value = body[key];
    if ((PRIMARY_FIELDS as readonly string[]).includes(key)) {
      if (roleSlotRef(value) !== null) {
        const m = toModel(value, key);
        if (!m.ok) return { ok: false, status: 400, error: m.error };
        concrete[key] = m.model;
      }
    } else if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        if (roleSlotRef(value[i]) === null) {
          out.push(value[i]);
          continue;
        }
        const m = toModel(value[i], `${key}[${i}]`);
        if (!m.ok) return { ok: false, status: 400, error: m.error };
        out.push(m.model);
      }
      concrete[key] = out;
    }
  }
  return { ok: true, concrete, slots, touchedKeys };
}

const fieldKey = (f: string): string => f.replace(/\[\d+\]$/, "");

/**
 * The owner's complete next binding set after a save: bindings on untouched
 * keys are kept as-is; bindings on touched keys are replaced by this save's
 * slots (so reorder/remove make bindings follow entries by final position).
 */
export function nextBindingSet(
  existing: Array<{ field: string; ref: string; projected: Concrete; status?: string }>,
  touchedKeys: readonly string[],
  slots: readonly RoleSlotUse[],
  projectedOf: (field: string) => Concrete,
): Array<{ field: string; ref: string; projected: Concrete; status?: string }> {
  const touched = new Set(touchedKeys);
  const kept = existing.filter((b) => !touched.has(fieldKey(b.field)));
  return [...kept, ...slots.map((s) => ({ field: s.field, ref: s.ref, projected: projectedOf(s.field) }))];
}
