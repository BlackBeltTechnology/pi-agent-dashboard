/**
 * Team-controls configuration surface (tasks 8.1-8.4) — the dashboard panel.
 *
 * A PURE RENDERER of `TeamSurfaceView`. It decides nothing: whether a folder is
 * inert, who can assign a role, whether delegation is unknown, and the log's
 * order all arrive already decided, because the server is the only thing that
 * knows what the layer will actually do.
 *
 * Reads and writes ride the plugin's own browser-handler lane (no new HTTP
 * route). The write goes through `TEAM_CONFIG_MESSAGE` rather than the generic
 * `plugin_config_write` because only that lane can await the platform before
 * reporting success — see `shared/types.ts`.
 *
 * See change: add-chat-gateway-team-controls.
 */
import { usePluginConfig, usePluginMessage, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import {
  type ChatGatewayConfig,
  type SurfaceRoleMapping,
  TEAM_CONFIG_MESSAGE,
  TEAM_SURFACE_MESSAGE,
  type TeamSurfaceView,
} from "../shared/types.js";

/** `at` is epoch ms; a locale string is the least surprising rendering. */
function formatWhen(at: number): string {
  return new Date(at).toLocaleString();
}

/**
 * The delegation disclosure for one role mapping.
 *
 * `unavailable` must read as "unknown", never as "nobody" — collapsing the two
 * would make a role look safe to hand out precisely when the platform declined
 * to say who already holds it.
 */
function Delegation({ role }: { role: SurfaceRoleMapping }): React.ReactElement {
  if (role.assigners.kind === "unavailable") {
    return (
      <span
        data-testid={`delegation-unavailable-${role.roleId}`}
        className="text-[var(--danger-text,var(--text-secondary))]"
      >
        Cannot list who can assign this — missing permission: {role.assigners.missingPermission}
      </span>
    );
  }
  if (role.assigners.members.length === 0) {
    return (
      <span data-testid={`delegation-none-${role.roleId}`} className="text-[var(--text-tertiary)]">
        Nobody can assign this role.
      </span>
    );
  }
  return (
    <span data-testid={`delegation-members-${role.roleId}`}>
      Assignable by{" "}
      {role.assigners.members.map((m) => m.name ?? m.id).join(", ")}
    </span>
  );
}

function Binding({ binding }: { binding: TeamSurfaceView["bindings"][number] }): React.ReactElement {
  return (
    <div
      data-testid={`team-binding-${binding.workspaceId}`}
      className="rounded border border-[var(--border-secondary)] p-2 space-y-1"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium" data-testid={`team-binding-name-${binding.workspaceId}`}>
          {binding.workspaceName ?? "(workspace missing)"}
        </span>
        <span className="text-[11px] text-[var(--text-tertiary)]">
          ceiling {binding.ceiling} · mirror {binding.mirrorLevel}
        </span>
      </div>

      {!binding.bound && (
        <p
          data-testid={`team-binding-unbound-${binding.workspaceId}`}
          className="text-[11px] text-[var(--danger-text,var(--text-secondary))]"
        >
          This workspace no longer exists. The binding is retained but inert; its channel is kept.
        </p>
      )}

      {binding.problem && (
        <p
          data-testid={`team-binding-problem-${binding.workspaceId}`}
          className="text-[11px] text-[var(--danger-text,var(--text-secondary))]"
        >
          Provisioning problem: {binding.problem}
        </p>
      )}

      {binding.channelId ? (
        <p className="text-[11px] text-[var(--text-tertiary)]">
          channel <code>{binding.channelId}</code>
        </p>
      ) : (
        <p className="text-[11px] text-[var(--text-tertiary)]">No channel provisioned.</p>
      )}

      <div>
        <span className="block text-[11px] text-[var(--text-secondary)]">Principals</span>
        {binding.principals.length === 0 ? (
          <span className="text-[11px] text-[var(--text-tertiary)]">None mapped.</span>
        ) : (
          <ul data-testid={`team-principals-${binding.workspaceId}`} className="text-[11px]">
            {binding.principals.map((p) => (
              <li key={p.id}>
                <code>{p.id}</code> — {p.tier}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <span className="block text-[11px] text-[var(--text-secondary)]">Roles</span>
        {binding.roles.length === 0 ? (
          <span className="text-[11px] text-[var(--text-tertiary)]">None mapped.</span>
        ) : (
          <ul data-testid={`team-roles-${binding.workspaceId}`} className="text-[11px] space-y-0.5">
            {binding.roles.map((role) => (
              <li key={role.roleId}>
                <code>{role.roleId}</code> — {role.tier}: <Delegation role={role} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <span className="block text-[11px] text-[var(--text-secondary)]">Folders</span>
        <ul data-testid={`team-folders-${binding.workspaceId}`} className="text-[11px]">
          {binding.folders.map((f) => (
            <li key={f.path} data-inert={f.inert ? "true" : "false"}>
              <code>{f.path}</code>
              {f.inert && (
                <span
                  data-testid={`team-folder-inert-${binding.workspaceId}-${f.path}`}
                  className="ml-1 text-[var(--danger-text,var(--text-secondary))]"
                >
                  inert — outside allowedRoots
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function TeamControlsPanel(): React.ReactElement {
  const config = usePluginConfig<ChatGatewayConfig>();
  const send = usePluginSend();
  const [surface, setSurface] = useState<TeamSurfaceView | null>(null);
  const [writeNotice, setWriteNotice] = useState<string | null>(null);

  // The surface answer and the write result both arrive on their own types.
  usePluginMessage<{ surface?: TeamSurfaceView }>(TEAM_SURFACE_MESSAGE, (msg) => {
    if (msg?.surface) setSurface(msg.surface);
  });
  usePluginMessage<{ ok?: boolean; reason?: string; surface?: TeamSurfaceView }>(
    TEAM_CONFIG_MESSAGE,
    (msg) => {
      if (msg?.surface) setSurface(msg.surface);
      if (msg?.ok === true) setWriteNotice("Saved.");
      else if (msg?.reason) setWriteNotice(`Refused: ${msg.reason}`);
    },
  );

  useEffect(() => {
    void send({ type: TEAM_SURFACE_MESSAGE });
  }, [send]);

  // Re-arm is a DASHBOARD action, so it writes config rather than calling a
  // chat verb — that is precisely the asymmetry the spec requires.
  const rearm = useCallback(() => {
    setWriteNotice(null);
    void send({
      type: TEAM_CONFIG_MESSAGE,
      teamControls: { ...(config?.teamControls ?? {}), disarmed: false },
    });
  }, [send, config]);

  if (!surface) {
    return (
      <div data-testid="team-controls-panel" className="text-[11px] text-[var(--text-tertiary)]">
        Loading team controls…
      </div>
    );
  }

  return (
    <div data-testid="team-controls-panel" className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">Team controls</span>
        <span
          data-testid="team-disarm-state"
          className={
            surface.disarmed
              ? "text-[11px] text-[var(--danger-text,var(--text-secondary))]"
              : "text-[11px] text-[var(--text-tertiary)]"
          }
        >
          {surface.disarmed ? "DISARMED — action requests are refused" : "armed"}
        </span>
        {surface.disarmed && (
          <button
            type="button"
            data-testid="team-rearm"
            onClick={rearm}
            className="px-2 py-0.5 rounded border border-[var(--border-secondary)] text-[11px] hover:bg-[var(--bg-secondary)]"
          >
            Re-arm
          </button>
        )}
        {writeNotice && (
          <span data-testid="team-write-notice" className="text-[11px] text-[var(--text-tertiary)]">
            {writeNotice}
          </span>
        )}
      </div>

      {surface.configError && (
        <p
          data-testid="team-config-error"
          className="text-[11px] text-[var(--danger-text,var(--text-secondary))]"
        >
          Configuration rejected — the layer is running FAIL-CLOSED: {surface.configError}
        </p>
      )}

      <p className="text-[11px] text-[var(--text-tertiary)]">
        ceiling {surface.ceiling}
        {surface.allowedRoots.length > 0 && <> · allowedRoots {surface.allowedRoots.join(", ")}</>}
      </p>

      {surface.bindings.length === 0 ? (
        <span data-testid="team-bindings-empty" className="text-[11px] text-[var(--text-tertiary)]">
          No workspace bindings configured.
        </span>
      ) : (
        surface.bindings.map((b) => <Binding key={b.workspaceId} binding={b} />)
      )}

      <div>
        <span className="block text-[11px] text-[var(--text-secondary)]">
          Command log (newest first — the dashboard is the only place it is readable)
        </span>
        {surface.log.length === 0 ? (
          <span data-testid="team-log-empty" className="text-[11px] text-[var(--text-tertiary)]">
            No activity recorded.
          </span>
        ) : (
          <table data-testid="team-log" className="w-full text-[11px]">
            <thead>
              <tr className="text-[var(--text-tertiary)] text-left">
                <th className="font-normal">when</th>
                <th className="font-normal">principal</th>
                <th className="font-normal">verb</th>
                <th className="font-normal">outcome</th>
                <th className="font-normal">reason</th>
              </tr>
            </thead>
            <tbody>
              {surface.log.map((e, i) => (
                <tr key={`${e.at}-${i}`} data-testid="team-log-row">
                  <td>{formatWhen(e.at)}</td>
                  <td className="truncate max-w-[8rem]">{e.principal}</td>
                  <td>{e.verb}</td>
                  <td>{e.outcome}</td>
                  <td className="truncate max-w-[12rem]">{e.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
