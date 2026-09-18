/**
 * Channel provisioner / reconciler (change: add-chat-gateway-team-controls).
 *
 * Scenarios: the workspace-binding capability's provisioning + lifecycle
 * requirements, and test-plan X1, X3–X9 (X2 is the adapter/payload layer).
 *
 * The adapter is the recording fixture, so every assertion is made on the
 * sequence of platform calls the layer actually made — including the calls it
 * deliberately did NOT make.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RecordingAdapter } from "../../../adapters/__tests__/recording-adapter.js";
import { createProvisioner, type Provisioner } from "../provisioner.js";
import { createProvisioningStore, type ProvisioningStore } from "../provisioning-store.js";
import type { ValidatedBinding, ValidatedTeamConfig } from "../team-config.js";
import type { WorkspaceView } from "../workspace.js";

const GUILD = "g1";

function binding(over: Partial<ValidatedBinding> = {}): ValidatedBinding {
  return {
    principals: {},
    roles: {},
    mirrorLevel: "names-only",
    ceiling: "observe",
    ...over,
  };
}

function config(
  bindings: Record<string, ValidatedBinding>,
  over: { guildId?: string | undefined } = {},
): ValidatedTeamConfig {
  const guildId = "guildId" in over ? over.guildId : GUILD;
  return {
    ceiling: "observe",
    disarmed: false,
    auditRetention: 100,
    bindings,
    ...(guildId ? { guildId } : {}),
  };
}

function ws(id: string, name: string, folders: string[] = ["/srv/ok/p"]): WorkspaceView {
  return { id, name, folders };
}

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cg-provision-"));
  tmpDirs.push(dir);
  return path.join(dir, "channels.json");
}

interface Harness {
  adapter: RecordingAdapter;
  store: ProvisioningStore;
  provisioner: Provisioner;
  failures: string[];
  setConfig: (c: ValidatedTeamConfig) => void;
  setWorkspaces: (w: WorkspaceView[]) => void;
}

function setup(opts: {
  config: ValidatedTeamConfig;
  workspaces: WorkspaceView[];
  storePath?: string;
  store?: ProvisioningStore;
}): Harness {
  const adapter = new RecordingAdapter();
  const store = opts.store ?? createProvisioningStore(
    opts.storePath ? { filePath: opts.storePath } : {},
  );
  let config_ = opts.config;
  let workspaces = opts.workspaces;
  const failures: string[] = [];
  const provisioner = createProvisioner({
    adapter,
    store,
    config: () => config_,
    listWorkspaces: () => workspaces,
    onFailure: (reason) => failures.push(reason),
  });
  return {
    adapter,
    store,
    provisioner,
    failures,
    setConfig: (c) => {
      config_ = c;
    },
    setWorkspaces: (w) => {
      workspaces = w;
    },
  };
}

describe("provisioner", () => {
  it("provisions one channel for a newly bound workspace with an @everyone deny", async () => {
    const h = setup({
      config: config({ ws_1: binding({ principals: { u1: "control" } }) }),
      workspaces: [ws("ws_1", "Platform Team")],
    });

    const result = await h.provisioner.reconcile();

    expect(result).toEqual({ ok: true, provisioned: 1, reconciled: 0, renamed: 0, deactivated: 0 });
    const create = h.adapter.provisionCallsOfKind("create-channel");
    expect(create).toHaveLength(1);
    expect(create[0].guildId).toBe(GUILD);
    expect(create[0].name).toBe("Platform Team");
    expect(create[0].overwrites).toEqual([
      { targetId: "u1", kind: "member", viewChannel: true },
    ]);
    // The binding is live and routable.
    expect(h.provisioner.channelBindings().get("c1")).toBe("ws_1");
  });

  it("does nothing at all when no binding is configured", async () => {
    const h = setup({ config: config({}), workspaces: [ws("ws_1", "A")] });
    expect(await h.provisioner.reconcile()).toEqual({
      ok: true,
      provisioned: 0,
      reconciled: 0,
      renamed: 0,
      deactivated: 0,
    });
    expect(h.adapter.provisionCalls).toEqual([]);
  });

  it("2.5: a restart reattaches to the same channel instead of provisioning a duplicate", async () => {
    const storePath = tempStorePath();
    const cfg = config({ ws_1: binding({ principals: { u1: "control" } }) });

    const first = setup({ config: cfg, workspaces: [ws("ws_1", "Platform Team")], storePath });
    await first.provisioner.reconcile();
    expect(first.adapter.provisionCallsOfKind("create-channel")).toHaveLength(1);

    // Restart: a fresh store + provisioner over the same file.
    const reloaded = createProvisioningStore({ filePath: storePath });
    reloaded.load();
    expect(reloaded.forWorkspace("ws_1")?.channelId).toBe("c1");

    const second = setup({
      config: cfg,
      workspaces: [ws("ws_1", "Platform Team")],
      store: reloaded,
    });
    await second.provisioner.reconcile();

    expect(second.adapter.provisionCalls).toEqual([]); // converged, zero calls
    expect(second.provisioner.channelBindings().get("c1")).toBe("ws_1");
  });

  it("X1: a binding with no guild id provisions nothing and reports why", async () => {
    const h = setup({
      config: config({ ws_1: binding() }, { guildId: undefined }),
      workspaces: [ws("ws_1", "A")],
    });

    const result = await h.provisioner.reconcile();

    expect(result).toEqual({ ok: false, reason: "provisioning_requires_guild_id" });
    expect(h.adapter.provisionCalls).toEqual([]);
    expect(h.failures).toEqual(["provisioning_requires_guild_id"]);
    // Nothing recorded ⇒ a later reconcile retries rather than adopting a phantom.
    expect(h.store.all()).toEqual([]);
  });

  it("X1: when the platform rejects create-with-overwrites no channel is recorded and health names the reason", async () => {
    const h = setup({
      config: config({ ws_1: binding() }),
      workspaces: [ws("ws_1", "A")],
    });
    h.adapter.failProvision = "Missing Permissions";

    const result = await h.provisioner.reconcile();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/^provision_failed: Missing Permissions/);
    expect(h.failures[0]).toMatch(/Missing Permissions/);
    expect(h.store.all()).toEqual([]);
    expect(h.provisioner.channelBindings().size).toBe(0);
  });

  it("reports a provisioning failure on the edge only, not once per reconcile", async () => {
    const h = setup({
      config: config({ ws_1: binding() }),
      workspaces: [ws("ws_1", "A")],
    });
    h.adapter.failProvision = "nope";
    await h.provisioner.reconcile();
    await h.provisioner.reconcile();
    expect(h.failures).toEqual(["provision_failed: nope"]);
  });

  it("X3: a reconcile is not reported successful until the platform has applied the revocation", async () => {
    const h = setup({
      config: config({ ws_1: binding({ principals: { u1: "control", u2: "observe" } }) }),
      workspaces: [ws("ws_1", "A")],
    });
    await h.provisioner.reconcile(); // provision with u1 + u2

    // u1 is removed; the platform is slow to apply the overwrite.
    h.setConfig(config({ ws_1: binding({ principals: { u2: "observe" } }) }));
    h.adapter.overwriteDelayMs = 40;

    let settled = false;
    const pending = h.provisioner.reconcile().then((r) => {
      settled = true;
      return r;
    });
    await new Promise((resolve) => setTimeout(resolve, 8));
    // Still in flight ⇒ no success has been reported yet.
    expect(settled).toBe(false);

    const result = await pending;
    expect(result).toEqual({ ok: true, provisioned: 0, reconciled: 1, renamed: 0, deactivated: 0 });

    const reconcileCall = h.adapter.provisionCallsOfKind("set-overwrites")[0];
    // u1 is gone from the access list, and u1's revocation is already applied.
    expect(reconcileCall.overwrites).toEqual([
      { targetId: "u2", kind: "member", viewChannel: true },
    ]);
    expect(settled).toBe(true);
  });

  it("X4: a failed reconciliation reports the reason and leaves mapping and access consistent", async () => {
    const h = setup({
      config: config({ ws_1: binding({ principals: { u1: "control" } }) }),
      workspaces: [ws("ws_1", "A")],
    });
    await h.provisioner.reconcile();
    const appliedBefore = h.store.forWorkspace("ws_1")?.accessSignature;

    h.adapter.failOverwrites = "500 Internal Server Error";
    h.setConfig(config({ ws_1: binding({ principals: { u2: "control" } }) }));

    const result = await h.provisioner.reconcile();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/^reconcile_failed: 500/);
    // The stored signature is untouched, so it still describes the access the
    // channel really has — the two remain consistent.
    expect(h.store.forWorkspace("ws_1")?.accessSignature).toBe(appliedBefore);
    expect(h.failures).toEqual(["reconcile_failed: 500 Internal Server Error"]);
  });

  it("a replayed reconcile after a failure converges once the platform recovers", async () => {
    const h = setup({
      config: config({ ws_1: binding({ principals: { u1: "control" } }) }),
      workspaces: [ws("ws_1", "A")],
    });
    await h.provisioner.reconcile();
    h.adapter.failOverwrites = "boom";
    h.setConfig(config({ ws_1: binding({ principals: { u2: "control" } }) }));
    expect((await h.provisioner.reconcile()).ok).toBe(false);

    h.adapter.failOverwrites = null;
    const result = await h.provisioner.reconcile();
    expect(result).toEqual({ ok: true, provisioned: 0, reconciled: 1, renamed: 0, deactivated: 0 });
    expect(h.provisioner.lastFailure()).toBeNull();
  });

  it("adds a principal without recreating the channel", async () => {
    const h = setup({
      config: config({ ws_1: binding({ principals: { u1: "control" } }) }),
      workspaces: [ws("ws_1", "A")],
    });
    await h.provisioner.reconcile();
    h.setConfig(config({ ws_1: binding({ principals: { u1: "control", u2: "observe" } }) }));

    await h.provisioner.reconcile();

    expect(h.adapter.provisionCallsOfKind("create-channel")).toHaveLength(1); // still one
    expect(h.adapter.provisionCallsOfKind("set-overwrites")).toHaveLength(1);
    expect(h.adapter.provisionCallsOfKind("set-overwrites")[0].overwrites).toEqual([
      { targetId: "u1", kind: "member", viewChannel: true },
      { targetId: "u2", kind: "member", viewChannel: true },
    ]);
  });

  it("role mappings become role overwrites", async () => {
    const h = setup({
      config: config({ ws_1: binding({ roles: { r1: "control" } }) }),
      workspaces: [ws("ws_1", "A")],
    });
    await h.provisioner.reconcile();
    expect(h.adapter.provisionCallsOfKind("create-channel")[0].overwrites).toEqual([
      { targetId: "r1", kind: "role", viewChannel: true },
    ]);
  });

  it("X5: a mapping changed while the dashboard was down is reconciled at activation", async () => {
    const storePath = tempStorePath();
    const first = setup({
      config: config({ ws_1: binding({ principals: { u1: "control" } }) }),
      workspaces: [ws("ws_1", "A")],
      storePath,
    });
    await first.provisioner.reconcile();

    // While "down", the operator replaced u1 with u2 (persisted config only).
    const reloaded = createProvisioningStore({ filePath: storePath });
    reloaded.load();
    const second = setup({
      config: config({ ws_1: binding({ principals: { u2: "control" } }) }),
      workspaces: [ws("ws_1", "A")],
      store: reloaded,
    });

    const result = await second.provisioner.reconcile();

    expect(result).toEqual({ ok: true, provisioned: 0, reconciled: 1, renamed: 0, deactivated: 0 });
    expect(second.adapter.provisionCallsOfKind("create-channel")).toHaveLength(0);
    expect(second.adapter.provisionCallsOfKind("set-overwrites")[0].overwrites).toEqual([
      { targetId: "u2", kind: "member", viewChannel: true },
    ]);
  });

  it("4.7: renames the bound channel when the workspace is renamed", async () => {
    const h = setup({
      config: config({ ws_1: binding() }),
      workspaces: [ws("ws_1", "Old Name")],
    });
    await h.provisioner.reconcile();
    h.setWorkspaces([ws("ws_1", "New Name")]);

    const result = await h.provisioner.reconcile();

    expect(result).toEqual({ ok: true, provisioned: 0, reconciled: 0, renamed: 1, deactivated: 0 });
    const rename = h.adapter.provisionCallsOfKind("rename-channel");
    expect(rename).toHaveLength(1);
    expect(rename[0]).toMatchObject({ channelId: "c1", name: "New Name" });
    // Never a recreate.
    expect(h.adapter.provisionCallsOfKind("create-channel")).toHaveLength(1);
  });

  it("X6: a deleted workspace marks the binding inactive and deletes nothing", async () => {
    const h = setup({
      config: config({ ws_1: binding() }),
      workspaces: [ws("ws_1", "A")],
    });
    await h.provisioner.reconcile();
    h.setWorkspaces([]); // workspace deleted
    const callsAfterProvision = h.adapter.provisionCalls.length;

    const result = await h.provisioner.reconcile();

    expect(result).toEqual({ ok: true, provisioned: 0, reconciled: 0, renamed: 0, deactivated: 1 });
    expect(h.store.forWorkspace("ws_1")?.active).toBe(false);
    // The channel and its history stay; the binding is simply not routable.
    expect(h.provisioner.channelBindings().size).toBe(0);
    // No FURTHER platform call of any kind — in particular, no channel delete.
    expect(h.adapter.provisionCalls).toHaveLength(callsAfterProvision);
    expect(h.adapter.deleted).toEqual([]);
  });

  it("an unbound workspace (binding removed from config) goes inactive, keeping the channel", async () => {
    const h = setup({
      config: config({ ws_1: binding() }),
      workspaces: [ws("ws_1", "A")],
    });
    await h.provisioner.reconcile();
    h.setConfig(config({}));
    const callsAfterProvision = h.adapter.provisionCalls.length;

    const result = await h.provisioner.reconcile();

    expect(result).toEqual({ ok: true, provisioned: 0, reconciled: 0, renamed: 0, deactivated: 1 });
    expect(h.store.forWorkspace("ws_1")?.active).toBe(false);
    // Unbinding makes no platform call: the channel is retained untouched.
    expect(h.adapter.provisionCalls).toHaveLength(callsAfterProvision);
  });

  it("reactivates a retained channel when the workspace and binding come back", async () => {
    const h = setup({
      config: config({ ws_1: binding() }),
      workspaces: [ws("ws_1", "A")],
    });
    await h.provisioner.reconcile();
    h.setWorkspaces([]);
    await h.provisioner.reconcile();

    h.setWorkspaces([ws("ws_1", "A")]);
    await h.provisioner.reconcile();

    // Reuses the original channel — never a second one.
    expect(h.adapter.provisionCallsOfKind("create-channel")).toHaveLength(1);
    expect(h.provisioner.channelBindings().get("c1")).toBe("ws_1");
  });

  it("X8: a workspace-irrelevant change causes no platform call", async () => {
    const h = setup({
      config: config({ ws_1: binding({ principals: { u1: "control" } }) }),
      workspaces: [ws("ws_1", "A", ["/srv/ok/p"])],
    });
    await h.provisioner.reconcile(); // provision
    expect(h.adapter.provisionCalls).toHaveLength(1);

    // A collapse fire and a folder reorder both deliver a notification.
    await h.provisioner.reconcile();
    await h.provisioner.reconcile();

    expect(h.adapter.provisionCalls).toHaveLength(1); // unchanged
  });

  it("X8: a tier-ceiling or mirror-level change alone causes no platform call", async () => {
    const h = setup({
      config: config({ ws_1: binding({ principals: { u1: "control" } }) }),
      workspaces: [ws("ws_1", "A")],
    });
    await h.provisioner.reconcile();

    // Same visibility, different policy.
    h.setConfig(config({ ws_1: binding({ principals: { u1: "observe" }, mirrorLevel: "full-transcript" }) }));
    await h.provisioner.reconcile();

    expect(h.adapter.provisionCallsOfKind("set-overwrites")).toHaveLength(0);
  });

  it("X9: coalesced rename + add + rename converges to the final state and is idempotent", async () => {
    const h = setup({
      config: config({ ws_1: binding({ principals: { u1: "control" } }) }),
      workspaces: [ws("ws_1", "A")],
    });
    await h.provisioner.reconcile();

    // One notification carrying several mutations: rename, folder add, rename.
    h.setWorkspaces([ws("ws_1", "Final", ["/srv/ok/p", "/srv/ok/q"])]);
    h.setConfig(config({ ws_1: binding({ principals: { u1: "control", u2: "control" } }) }));

    const first = await h.provisioner.reconcile();
    expect(first).toEqual({ ok: true, provisioned: 0, reconciled: 1, renamed: 1, deactivated: 0 });
    expect(h.store.forWorkspace("ws_1")?.channelName).toBe("Final");

    const callsAfter = h.adapter.provisionCalls.length;
    // Replaying the same notification changes nothing.
    await h.provisioner.reconcile();
    expect(h.adapter.provisionCalls).toHaveLength(callsAfter);
  });

  it("X7: a channel deleted on the platform drops the binding and touches no session", async () => {
    const h = setup({
      config: config({ ws_1: binding() }),
      workspaces: [ws("ws_1", "A")],
    });
    await h.provisioner.reconcile();

    h.provisioner.noteChannelGone("c1");

    expect(h.store.forWorkspace("ws_1")).toBeUndefined();
    expect(h.provisioner.channelBindings().size).toBe(0);
    // Sessions are the gateway's concern and must be untouched: nothing aborted,
    // nothing deleted, no further platform call.
    expect(h.adapter.deleted).toEqual([]);
    expect(h.adapter.provisionCalls).toHaveLength(1);
  });

  it("drops the binding when the channel is gone, then re-provisions on the next converge", async () => {
    const h = setup({
      config: config({ ws_1: binding() }),
      workspaces: [ws("ws_1", "A")],
    });
    await h.provisioner.reconcile();
    h.provisioner.noteChannelGone("c1");

    const result = await h.provisioner.reconcile();

    // A fresh channel, because the old one no longer exists.
    expect(result).toEqual({ ok: true, provisioned: 1, reconciled: 0, renamed: 0, deactivated: 0 });
    expect(h.adapter.provisionCallsOfKind("create-channel")).toHaveLength(2);
  });

  it("only provisions channels for workspaces that exist", async () => {
    const h = setup({
      config: config({ ws_missing: binding(), ws_1: binding() }),
      workspaces: [ws("ws_1", "A")],
    });
    const result = await h.provisioner.reconcile();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.provisioned).toBe(1);
    expect(h.adapter.provisionCallsOfKind("create-channel")).toHaveLength(1);
  });
});
