/**
 * Plugin-owned workspace↔channel store (D7).
 *
 * Deliberately SEPARATE from chat-gateway's `bindings.json`: that file maps a
 * channel to a session cwd (routing), while this one maps a *workspace* to the
 * channel the layer provisioned for it (provisioning). Keeping them apart means
 * a routing reset cannot orphan a live channel, and a provisioning change never
 * disturbs session routing.
 *
 * Records are retained after the binding goes inactive: the channel and its
 * history stay on the platform, and the operator can see what used to exist.
 * Deletion never propagates in either direction.
 *
 * Persisted to a plugin-owned JSON file (0600) via tmp-write + rename, so the
 * store is never observed half-written and a restart round-trips exactly.
 *
 * See change: add-chat-gateway-team-controls (D7).
 */
import fs from "node:fs";
import path from "node:path";

export interface ChannelBinding {
  workspaceId: string;
  channelId: string;
  /** The channel name we last applied, so a rename is detectable. */
  channelName: string;
  /**
   * Inactive = the workspace was deleted or unbound. The channel is kept and no
   * further mirroring or command occurs there.
   */
  active: boolean;
  /**
   * Signature of the principals/roles actually applied to the channel — the
   * convergence baseline. A reconcile issues a platform call only where the
   * desired signature differs, so an irrelevant workspace change is a no-op.
   * Advanced only AFTER a successful platform call, so a failure leaves this
   * consistent with the access the channel really has.
   */
  accessSignature: string;
}

export interface ProvisioningStoreDeps {
  /** Omit for an in-memory store (tests). */
  filePath?: string;
}

export interface ProvisioningStore {
  /** Read from disk (no-op in-memory). A missing/corrupt file yields empty. */
  load(): void;
  /** All records, active and inactive. */
  all(): ChannelBinding[];
  forWorkspace(workspaceId: string): ChannelBinding | undefined;
  forChannel(channelId: string): ChannelBinding | undefined;
  /** Active channelId → workspaceId. The gateway's routing/authorization input. */
  activeChannelMap(): Map<string, string>;
  upsert(binding: ChannelBinding): void;
  /** Mark inactive. The channel is NEVER deleted. */
  deactivate(workspaceId: string): void;
  /** Drop the record entirely (the channel is gone on the platform). */
  drop(channelId: string): void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse defensively: a hand-edited or truncated file must not crash startup. */
function parseBindings(raw: string): ChannelBinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = isRecord(parsed) && Array.isArray(parsed.bindings) ? parsed.bindings : [];
  const out: ChannelBinding[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const { workspaceId, channelId, channelName, active, accessSignature } = item;
    if (typeof workspaceId !== "string" || typeof channelId !== "string") continue;
    out.push({
      workspaceId,
      channelId,
      channelName: typeof channelName === "string" ? channelName : "",
      active: active !== false,
      accessSignature: typeof accessSignature === "string" ? accessSignature : "",
    });
  }
  return out;
}

export function createProvisioningStore(deps: ProvisioningStoreDeps = {}): ProvisioningStore {
  /** Keyed by workspaceId — one channel per bound workspace, by construction. */
  let records = new Map<string, ChannelBinding>();

  function persist(): void {
    const filePath = deps.filePath;
    if (!filePath) return; // in-memory
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // Best effort (e.g. a filesystem without POSIX modes).
    }
    const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify({ bindings: [...records.values()] }, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(tmp, filePath);
    fs.chmodSync(filePath, 0o600);
  }

  return {
    load() {
      if (!deps.filePath) return;
      let raw: string;
      try {
        raw = fs.readFileSync(deps.filePath, "utf8");
      } catch {
        return; // missing → empty
      }
      records = new Map(parseBindings(raw).map((b) => [b.workspaceId, b]));
    },
    all() {
      return [...records.values()].map((r) => ({ ...r }));
    },
    forWorkspace(workspaceId) {
      // A COPY: callers mutate their view and persist explicitly via `upsert`,
      // so the store can never hold state that differs from what is on disk.
      const record = records.get(workspaceId);
      return record ? { ...record } : undefined;
    },
    forChannel(channelId) {
      for (const record of records.values()) {
        if (record.channelId === channelId) return { ...record };
      }
      return undefined;
    },
    activeChannelMap() {
      const map = new Map<string, string>();
      for (const record of records.values()) {
        if (record.active) map.set(record.channelId, record.workspaceId);
      }
      return map;
    },
    upsert(binding) {
      records.set(binding.workspaceId, { ...binding });
      persist();
    },
    deactivate(workspaceId) {
      const existing = records.get(workspaceId);
      if (!existing?.active) return;
      records.set(workspaceId, { ...existing, active: false });
      persist();
    },
    drop(channelId) {
      let changed = false;
      for (const [workspaceId, record] of records) {
        if (record.channelId !== channelId) continue;
        records.delete(workspaceId);
        changed = true;
      }
      if (changed) persist();
    },
  };
}
