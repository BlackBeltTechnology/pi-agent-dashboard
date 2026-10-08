/**
 * `roles.bindings` service + projection engine.
 *
 * A plugin whose target config belongs to a third-party program registers a
 * projector; the engine keeps a central binding store, re-resolves bindings on
 * role/preset change and asks the projector to write the concrete model. The
 * engine NEVER writes a target itself — only through `projector.write`.
 *
 * Statuses: `ok`; `dangling` (role unresolved — last value kept, never
 * blanked); `detached` (target differs from last projected — no overwrite
 * until `reattach`). Passes run per-owner under `withOwnerLock` so a save
 * racing a pass never detaches itself.
 *
 * See change: add-role-aware-model-refs (D1, D4–D6).
 */
import { parseModelRef, type RoleConfig, resolveModelRef } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";
import {
  type BindingStatus,
  type Concrete,
  loadStore,
  type StoreData,
  saveStore,
} from "./binding-store.js";

export type { Concrete } from "./binding-store.js";

export interface Projector {
  owner: string;
  acceptsField(field: string): boolean;
  read(field: string): Concrete | undefined | Promise<Concrete | undefined>;
  /** Throw an error with `code: "PROJECTION_CONFLICT"` when the target changed mid-write → binding `detached`. */
  write(field: string, resolved: Concrete): void | Promise<void>;
}

export interface BindingView {
  field: string;
  ref: string;
  status: BindingStatus;
  projected: Concrete;
}

export interface UsageEntry {
  label: string;
  ref: string;
}

export interface UsedByEntry {
  kind: "binding" | "usage";
  owner: string;
  /** Binding field (kind "binding") or reporter label (kind "usage"). */
  label: string;
  status?: BindingStatus;
}

export interface PassSummary {
  trigger: string;
  evaluated: number;
  written: number;
  unchanged: number;
  dangling: number;
  detached: number;
  failed: number;
  skipped: number;
}

interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface RoleBindingsDeps {
  storePath: string;
  readRoleConfig: () => Pick<RoleConfig, "roles">;
  logger: Logger;
  now?: () => Date;
}

const same = (a: Concrete | undefined, b: Concrete): boolean =>
  !!a && a.provider === b.provider && a.id === b.id && (a.level ?? undefined) === (b.level ?? undefined);

export function createRoleBindings(deps: RoleBindingsDeps) {
  const { logger } = deps;
  const now = deps.now ?? (() => new Date());
  const store: StoreData = loadStore(deps.storePath, (reason) =>
    logger.warn(`[roles.bindings] ignoring unreadable store ${deps.storePath}: ${reason}`),
  );
  const projectors = new Map<string, Projector>();
  const usage = new Map<symbol, { owner: string; fn: () => UsageEntry[] }>();
  const locks = new Map<string, Promise<unknown>>();
  const inflight = new Set<Promise<unknown>>();
  const persist = () => saveStore(deps.storePath, store);

  function withOwnerLock<T>(owner: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = locks.get(owner) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    locks.set(owner, tail);
    return run;
  }

  const toConcrete = (ref: string): Concrete | { unresolved: string } => {
    const r = resolveModelRef(ref, deps.readRoleConfig());
    if (r.unresolved || !r.provider || !r.id) return { unresolved: r.unresolved ?? `cannot resolve "${ref}"` };
    return r.level ? { provider: r.provider, id: r.id, level: r.level } : { provider: r.provider, id: r.id };
  };

  async function passForOwner(owner: string, s: PassSummary): Promise<void> {
    const fields = store.owners[owner];
    if (!fields) return;
    const names = Object.keys(fields);
    s.evaluated += names.length;
    const projector = projectors.get(owner);
    if (!projector) {
      s.skipped += names.length;
      return;
    }
    let dirty = false;
    for (const field of names) {
      const b = fields[field];
      if (!b) continue;
      try {
        if (b.status === "detached") {
          s.detached++;
          continue;
        }
        const target = toConcrete(b.ref);
        if ("unresolved" in target) {
          if (b.status !== "dangling") {
            b.status = "dangling";
            dirty = true;
          }
          s.dangling++;
          continue;
        }
        const current = await projector.read(field);
        if (!same(current, b.projected)) {
          b.status = "detached";
          dirty = true;
          s.detached++;
          continue;
        }
        if (same(b.projected, target)) {
          if (b.status !== "ok") {
            b.status = "ok";
            dirty = true;
          }
          s.unchanged++;
          continue;
        }
        await projector.write(field, target);
        b.projected = target;
        b.status = "ok";
        b.updatedAt = now().toISOString();
        dirty = true;
        s.written++;
      } catch (e) {
        // A projector signals "the target changed under me" with code
        // PROJECTION_CONFLICT → detached (never overwrite), not a retry loop.
        if ((e as { code?: string })?.code === "PROJECTION_CONFLICT") {
          b.status = "detached";
          dirty = true;
          s.detached++;
          continue;
        }
        s.failed++;
        logger.error(
          `[roles.bindings] projector write failed owner=${owner} field=${field}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (dirty) persist();
  }

  /** Run one pass (all owners, or one). Per-owner locked; per-binding failures isolated. */
  async function runPass(trigger: string, owner?: string): Promise<PassSummary> {
    const s: PassSummary = { trigger, evaluated: 0, written: 0, unchanged: 0, dangling: 0, detached: 0, failed: 0, skipped: 0 };
    const owners = owner ? [owner] : Object.keys(store.owners);
    await Promise.all(owners.map((o) => withOwnerLock(o, () => passForOwner(o, s))));
    logger.info(
      `[roles.bindings] pass trigger=${trigger} evaluated=${s.evaluated} written=${s.written} unchanged=${s.unchanged} dangling=${s.dangling} detached=${s.detached} failed=${s.failed} skipped=${s.skipped}`,
    );
    return s;
  }

  function track(p: Promise<unknown>): void {
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
  }

  const service = {
    version: 1 as const,

    resolve(ref: string) {
      return resolveModelRef(ref, deps.readRoleConfig());
    },

    listRoles() {
      const cfg = deps.readRoleConfig();
      return Object.keys(cfg.roles).map((role) => {
        const r = resolveModelRef(`@${role}`, cfg);
        return {
          role,
          resolved: r.unresolved ? undefined : { provider: r.provider!, id: r.id!, ...(r.level ? { level: r.level } : {}) },
        };
      });
    },

    registerProjector(p: Projector): () => void {
      projectors.set(p.owner, p);
      track(runPass("register", p.owner));
      return () => {
        if (projectors.get(p.owner) === p) projectors.delete(p.owner);
      };
    },

    /**
     * Record-only: caller already wrote the file. Replaces the owner's set. Entries are `ok`
     * (just written) unless the caller KEEPS an untouched binding and passes its current
     * `detached`/`dangling` status through — a save must not reset what it did not write.
     */
    replaceBindings(
      owner: string,
      entries: Array<{ field: string; ref: string; projected: Concrete; status?: BindingStatus }>,
    ): void {
      const projector = projectors.get(owner);
      if (!projector) throw new Error(`no projector registered for owner "${owner}"`);
      const next: Record<string, StoredBindingLike> = {};
      for (const e of entries) {
        if (!projector.acceptsField(e.field)) throw new Error(`field "${e.field}" rejected by owner "${owner}"`);
        if (parseModelRef(e.ref).kind !== "role") throw new Error(`binding ref "${e.ref}" is not a role ref`);
        next[e.field] = { ref: e.ref, projected: e.projected, status: carriedStatus(e.status), updatedAt: now().toISOString() };
      }
      if (Object.keys(next).length) store.owners[owner] = next;
      else delete store.owners[owner];
      persist();
    },

    getBindings(owner: string): BindingView[] {
      return Object.entries(store.owners[owner] ?? {}).map(([field, b]) => ({
        field,
        ref: b.ref,
        status: b.status,
        projected: b.projected,
      }));
    },

    /** Re-attach a detached binding: project the current resolution, status → ok. */
    reattach(owner: string, field: string): Promise<BindingView | undefined> {
      return withOwnerLock(owner, async () => {
        const b = store.owners[owner]?.[field];
        const projector = projectors.get(owner);
        if (!b || !projector) return undefined;
        const target = toConcrete(b.ref);
        if ("unresolved" in target) {
          b.status = "dangling";
        } else {
          await projector.write(field, target);
          b.projected = target;
          b.status = "ok";
          b.updatedAt = now().toISOString();
        }
        persist();
        return { field, ref: b.ref, status: b.status, projected: b.projected };
      });
    },

    registerUsage(owner: string, fn: () => UsageEntry[]): () => void {
      const key = Symbol(owner);
      usage.set(key, { owner, fn });
      return () => {
        usage.delete(key);
      };
    },

    /** role name → everything that follows it (bindings + Kind A reporters). */
    getUsedBy(): Record<string, UsedByEntry[]> {
      const out: Record<string, UsedByEntry[]> = {};
      const add = (ref: string, e: UsedByEntry) => {
        const p = parseModelRef(ref);
        if (p.kind === "role") (out[p.role] ??= []).push(e);
      };
      for (const [owner, fields] of Object.entries(store.owners)) {
        for (const [field, b] of Object.entries(fields)) add(b.ref, { kind: "binding", owner, label: field, status: b.status });
      }
      for (const { owner, fn } of usage.values()) {
        let entries: UsageEntry[] = [];
        try {
          entries = fn();
        } catch (e) {
          logger.warn(`[roles.bindings] usage reporter "${owner}" threw: ${e instanceof Error ? e.message : String(e)}`);
        }
        for (const u of entries) add(u.ref, { kind: "usage", owner, label: u.label });
      }
      return out;
    },

    withOwnerLock,
  };

  return {
    service,
    runPass,
    /** Resolves when every scheduled (register-triggered) pass has settled. For tests/shutdown. */
    async idle(): Promise<void> {
      while (inflight.size) await Promise.allSettled([...inflight]);
    },
  };
}

/** A caller-carried status survives only when it is a known non-ok state; anything else is a fresh write → `ok`. */
function carriedStatus(s: string | undefined): BindingStatus {
  return s === "detached" || s === "dangling" ? s : "ok";
}

type StoredBindingLike = StoreData["owners"][string][string];
