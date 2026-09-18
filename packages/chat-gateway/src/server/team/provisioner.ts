/**
 * Channel provisioner + reconciler (D7).
 *
 * Converges the platform onto the configured mapping. Everything else in the
 * layer READS state; this is the only module that creates, renames or
 * re-permissions anything.
 *
 * Three properties are load-bearing and are why the code is shaped this way:
 *
 * 1. CREATE-WITH-OVERWRITES ONLY. The one call that makes a channel is
 *    `provisionChannel`, whose payload always carries the `@everyone` deny. No
 *    create-then-patch path exists, so no world-readable window can open.
 * 2. RECONCILE IS CONVERGENCE, NOT A DIFF EVENT. Each record stores the access
 *    signature and name actually applied. A reconcile compares desired vs
 *    applied and issues a platform call ONLY where they differ, which makes a
 *    collapsed/reordered workspace (or a replay of the same notification) a
 *    zero-call no-op. Signatures are persisted only AFTER a platform call
 *    succeeds, so a failed reconcile leaves the stored mapping consistent with
 *    the access the channel really has — and is retried on the next converge.
 * 3. DELETION NEVER PROPAGATES. A workspace deleted or unbound marks the binding
 *    inactive and keeps the channel; a channel deleted on the platform drops the
 *    binding and touches no session.
 *
 * See change: add-chat-gateway-team-controls (D7).
 */
import type { ChannelOverwrite, ProvisionChannelInput } from "../../adapters/base.js";
import type { ChannelBinding, ProvisioningStore } from "./provisioning-store.js";
import type { ValidatedBinding, ValidatedTeamConfig } from "./team-config.js";
import type { WorkspaceView } from "./workspace.js";

/**
 * The slice of `PlatformAdapter` provisioning needs. `PlatformAdapter`
 * satisfies it structurally; a test passes a plain object.
 */
export interface ChannelProvisioningPort {
  provisionChannel?: (input: ProvisionChannelInput) => Promise<{ channelId: string }>;
  setChannelOverwrites?: (
    channelId: string,
    overwrites: ChannelOverwrite[],
  ) => Promise<void>;
  renameChannel?: (channelId: string, name: string) => Promise<void>;
}

export interface ProvisionerDeps {
  /** Structurally a `PlatformAdapter`; only the provisioning slice is used. */
  adapter: ChannelProvisioningPort;
  store: ProvisioningStore;
  config: () => ValidatedTeamConfig;
  listWorkspaces: () => WorkspaceView[];
  /** Reported on the healthy→unhealthy edge, for `/api/health.plugins[]`. */
  onFailure?: (reason: string) => void;
}

export interface ReconcileSummary {
  ok: true;
  provisioned: number;
  reconciled: number;
  renamed: number;
  deactivated: number;
}

export type ReconcileResult = ReconcileSummary | { ok: false; reason: string };

export interface Provisioner {
  /** Make the platform match the config. Idempotent; safe to replay. */
  reconcile(): Promise<ReconcileResult>;
  /** The channel vanished on the platform: drop the binding, touch no session. */
  noteChannelGone(channelId: string): void;
  /** Active channelId → workspaceId, for the gateway's routing + authorization. */
  channelBindings(): Map<string, string>;
  /** The last failure reason, or null once converged. */
  lastFailure(): string | null;
}

/**
 * Stable signature of the state that decides channel VISIBILITY: WHICH
 * principals and roles are named — deliberately not their tiers, and not the
 * binding's ceiling or mirror level. A tier change or a mirror-level change
 * alters what a principal may DO, not who can READ the channel, so it must
 * cause no platform call at all.
 */
export function accessSignature(binding: ValidatedBinding): string {
  const ids = (record: Record<string, string>) => Object.keys(record).sort();
  return JSON.stringify({
    principals: ids(binding.principals),
    roles: ids(binding.roles),
  });
}

/** The access list a binding grants: its principals and its roles. */
export function grantsFor(binding: ValidatedBinding): ChannelOverwrite[] {
  return [
    ...Object.keys(binding.principals).map((targetId) => ({
      targetId,
      kind: "member" as const,
      viewChannel: true,
    })),
    ...Object.keys(binding.roles).map((targetId) => ({
      targetId,
      kind: "role" as const,
      viewChannel: true,
    })),
  ];
}

export function createProvisioner(deps: ProvisionerDeps): Provisioner {
  const { store } = deps;
  let lastFailureReason: string | null = null;

  function fail(reason: string): { ok: false; reason: string } {
    // Edge-triggered: the health surface should not be rewritten on every
    // reconcile, but a NEW reason must always be reported.
    if (lastFailureReason !== reason) deps.onFailure?.(reason);
    lastFailureReason = reason;
    return { ok: false, reason };
  }

  interface Counters {
    provisioned: number;
    reconciled: number;
    renamed: number;
    deactivated: number;
  }

  async function provisionNew(
    workspaceId: string,
    workspace: WorkspaceView,
    binding: ValidatedBinding,
    guildId: string | undefined,
    counters: Counters,
  ): Promise<{ ok: false; reason: string } | null> {
    if (!guildId) {
      // Fail closed and loudly: a binding we cannot provision must NOT appear
      // to work, and must never be recorded as if a channel existed.
      return fail("provisioning_requires_guild_id");
    }
    if (!deps.adapter.provisionChannel) return fail("platform_cannot_provision");
    let channelId: string;
    try {
      // Called ON the adapter, never detached — these are prototype methods and
      // a bare reference would drop `this`.
      const created = await deps.adapter.provisionChannel({
        guildId,
        name: workspace.name,
        overwrites: grantsFor(binding),
      });
      channelId = created.channelId;
    } catch (err) {
      // No channel was created (or the platform rejected it): nothing to record,
      // so the next reconcile retries instead of leaving a phantom binding.
      return fail(`provision_failed: ${errText(err)}`);
    }
    store.upsert({
      workspaceId,
      channelId,
      channelName: workspace.name,
      accessSignature: accessSignature(binding),
      active: true,
    });
    counters.provisioned += 1;
    return null;
  }

  /** Rename a bound channel to match its (renamed) workspace. */
  async function applyRename(
    record: ChannelBinding,
    workspace: WorkspaceView,
  ): Promise<{ ok: false; reason: string } | null> {
    if (!deps.adapter.renameChannel) return fail("platform_cannot_rename");
    try {
      await deps.adapter.renameChannel(record.channelId, workspace.name);
    } catch (err) {
      return fail(`rename_failed: ${errText(err)}`);
    }
    return null;
  }

  /** Re-permission a bound channel to match its binding. */
  async function applyAccess(
    record: ChannelBinding,
    binding: ValidatedBinding,
  ): Promise<{ ok: false; reason: string } | null> {
    if (!deps.adapter.setChannelOverwrites) return fail("platform_cannot_reconcile");
    try {
      // AWAITED before the signature is persisted, and so before any caller can
      // report the config write as succeeded: there is no interval in which a
      // removed principal still has access.
      await deps.adapter.setChannelOverwrites(record.channelId, grantsFor(binding));
    } catch (err) {
      // Signature left untouched ⇒ the stored mapping still matches the access
      // the channel really has.
      return fail(`reconcile_failed: ${errText(err)}`);
    }
    return null;
  }

  /**
   * Converge an already-provisioned binding. An inactive record is reactivated
   * here only because its workspace is back AND its binding is still configured
   * — its channel is reused, never duplicated.
   */
  async function convergeExisting(
    record: ChannelBinding,
    workspace: WorkspaceView,
    binding: ValidatedBinding,
    counters: Counters,
  ): Promise<{ ok: false; reason: string } | null> {
    const desiredSignature = accessSignature(binding);
    const needsAccess = !record.active || record.accessSignature !== desiredSignature;
    const needsRename = record.channelName !== workspace.name;

    if (needsRename) {
      const failure = await applyRename(record, workspace);
      if (failure) return failure;
      record.channelName = workspace.name;
      counters.renamed += 1;
    }

    if (needsAccess) {
      const failure = await applyAccess(record, binding);
      if (failure) return failure;
      record.accessSignature = desiredSignature;
      counters.reconciled += 1;
    }

    // Persist the applied state as one record; `needsAccess` subsumes the
    // reactivation case. When nothing differs there is NO store write and NO
    // platform call — which is what makes a collapsed/reordered workspace a
    // no-op.
    if (needsRename || needsAccess) store.upsert({ ...record, active: true });
    return null;
  }

  /** Retained records the config no longer names: unbound. The channel stays. */
  function deactivateUnbound(configured: Record<string, unknown>, counters: Counters): void {
    for (const record of store.all()) {
      if (configured[record.workspaceId] || !record.active) continue;
      store.deactivate(record.workspaceId);
      counters.deactivated += 1;
    }
  }

  async function reconcile(): Promise<ReconcileResult> {
    const config = deps.config();
    const byId = new Map(deps.listWorkspaces().map((w) => [w.id, w] as const));
    const counters: Counters = { provisioned: 0, reconciled: 0, renamed: 0, deactivated: 0 };

    for (const [workspaceId, binding] of Object.entries(config.bindings)) {
      const workspace = byId.get(workspaceId);
      const record = store.forWorkspace(workspaceId);

      // Deleted (or never real): keep the channel, mark the binding inactive so
      // no further mirroring or command occurs there.
      if (!workspace) {
        if (record?.active) {
          store.deactivate(workspaceId);
          counters.deactivated += 1;
        }
        continue;
      }

      const failure = record
        ? await convergeExisting(record, workspace, binding, counters)
        : await provisionNew(workspaceId, workspace, binding, config.guildId, counters);
      if (failure) return failure;
    }

    deactivateUnbound(config.bindings, counters);
    lastFailureReason = null;
    return { ok: true, ...counters };
  }

  return {
    reconcile,
    noteChannelGone(channelId) {
      store.drop(channelId);
    },
    channelBindings: () => store.activeChannelMap(),
    lastFailure: () => lastFailureReason,
  };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
