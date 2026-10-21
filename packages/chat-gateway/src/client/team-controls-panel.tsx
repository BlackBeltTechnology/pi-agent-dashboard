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
 * Presentation runs on the shared settings kit (status pills, items, facts,
 * table, notices): raw codes (`problem`, `configError`, a refusal `reason`)
 * never render — a sentence shows and the raw text is only copyable through
 * "Copy details".
 *
 * See change: add-chat-gateway-team-controls, retro-ux-plugin-settings-wave-2.
 */
import { SettingsFacts, SettingsGroup, SettingsItem, SettingsNotice, SettingsStatusPill, SettingsTable, usePluginConfig, usePluginMessage, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime";
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

const MIRROR_LABEL: Record<TeamSurfaceView["bindings"][number]["mirrorLevel"], string> = {
  "names-only": "Mirror: names only",
  "names-and-diffs": "Mirror: names and diffs",
  "full-transcript": "Mirror: full transcript",
};

const SMALL_BUTTON =
  "focus-ring inline-flex min-h-[32px] items-center gap-1 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]";

const SUBHEAD = "text-xs font-semibold text-[var(--text-primary)]";
const MUTED = "text-[12px] text-[var(--text-secondary)]";

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
        className="text-[var(--severity-error-fg)]"
      >
        Cannot list who can assign this — missing permission: {role.assigners.missingPermission}
      </span>
    );
  }
  if (role.assigners.members.length === 0) {
    return (
      <span data-testid={`delegation-none-${role.roleId}`} className="text-[var(--text-secondary)]">
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
  const id = binding.workspaceId;
  return (
    <SettingsItem
      testId={`team-binding-${id}`}
      title={<span data-testid={`team-binding-name-${id}`}>{binding.workspaceName ?? "(workspace missing)"}</span>}
      subtitle={
        binding.channelId ? (
          <>
            channel <code>{binding.channelId}</code>
          </>
        ) : (
          "No channel provisioned."
        )
      }
      status={
        <>
          <SettingsStatusPill tone="neutral" icon={null}>
            Level: {binding.ceiling}
          </SettingsStatusPill>
          <SettingsStatusPill tone="neutral" icon={null}>
            {MIRROR_LABEL[binding.mirrorLevel]}
          </SettingsStatusPill>
        </>
      }
    >
      {!binding.bound && (
        <SettingsNotice tone="warning" testId={`team-binding-unbound-${id}`}>
          This workspace no longer exists. The binding is retained but inert; its channel is kept.
        </SettingsNotice>
      )}

      {binding.problem && (
        <SettingsNotice tone="error" testId={`team-binding-problem-${id}`} details={binding.problem}>
          This binding could not be set up, so it stays inactive.
        </SettingsNotice>
      )}

      <div>
        <p className={SUBHEAD}>Principals</p>
        {binding.principals.length === 0 ? (
          <p className={MUTED}>None mapped.</p>
        ) : (
          <ul data-testid={`team-principals-${id}`} className="text-[12px]">
            {binding.principals.map((p) => (
              <li key={p.id}>
                <code>{p.id}</code> — {p.tier}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className={SUBHEAD}>Roles</p>
        {binding.roles.length === 0 ? (
          <p className={MUTED}>None mapped.</p>
        ) : (
          <ul data-testid={`team-roles-${id}`} className="space-y-0.5 text-[12px]">
            {binding.roles.map((role) => (
              <li key={role.roleId}>
                <code>{role.roleId}</code> — {role.tier}: <Delegation role={role} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className={SUBHEAD}>Folders</p>
        <ul data-testid={`team-folders-${id}`} className="text-[12px]">
          {binding.folders.map((f) => (
            <li key={f.path} data-inert={f.inert ? "true" : "false"} className="flex flex-wrap items-center gap-1">
              <code>{f.path}</code>
              {f.inert && (
                <SettingsStatusPill tone="warning" testId={`team-folder-inert-${id}-${f.path}`}>
                  Not used · outside the allowed folders
                </SettingsStatusPill>
              )}
            </li>
          ))}
        </ul>
      </div>
    </SettingsItem>
  );
}

export function TeamControlsPanel(): React.ReactElement {
  const config = usePluginConfig<ChatGatewayConfig>();
  const send = usePluginSend();
  const [surface, setSurface] = useState<TeamSurfaceView | null>(null);
  // `reason` is the raw refusal code: kept only for "Copy details".
  const [writeNotice, setWriteNotice] = useState<{ ok: true } | { ok: false; reason: string } | null>(null);

  // The surface answer and the write result both arrive on their own types.
  usePluginMessage<{ surface?: TeamSurfaceView }>(TEAM_SURFACE_MESSAGE, (msg) => {
    if (msg?.surface) setSurface(msg.surface);
  });
  usePluginMessage<{ ok?: boolean; reason?: string; surface?: TeamSurfaceView }>(
    TEAM_CONFIG_MESSAGE,
    (msg) => {
      if (msg?.surface) setSurface(msg.surface);
      if (msg?.ok === true) setWriteNotice({ ok: true });
      else if (msg?.reason) setWriteNotice({ ok: false, reason: msg.reason });
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
      <div data-testid="team-controls-panel" className="text-xs text-[var(--text-secondary)]">
        Loading team controls…
      </div>
    );
  }

  return (
    <div data-testid="team-controls-panel">
      <SettingsGroup title="Team controls" testId="team-controls-group">
        <div className="flex flex-wrap items-center gap-2">
          {surface.disarmed ? (
            <SettingsStatusPill tone="error" status="disarmed" testId="team-disarm-state">
              Disarmed · action requests are refused
            </SettingsStatusPill>
          ) : (
            <SettingsStatusPill tone="success" status="armed" testId="team-disarm-state">
              Armed
            </SettingsStatusPill>
          )}
          {surface.disarmed && (
            <button type="button" data-testid="team-rearm" onClick={rearm} className={SMALL_BUTTON}>
              Re-arm
            </button>
          )}
          {writeNotice?.ok === true && (
            <span data-testid="team-write-notice" className={MUTED}>
              Saved.
            </span>
          )}
        </div>

        {writeNotice?.ok === false && (
          <SettingsNotice tone="warning" testId="team-write-notice" details={writeNotice.reason}>
            Couldn't apply that change. Nothing was changed.
          </SettingsNotice>
        )}

        {surface.configError && (
          <SettingsNotice tone="error" testId="team-config-error" details={surface.configError}>
            The team-controls configuration was rejected, so the layer is running FAIL-CLOSED and refuses every
            action.
          </SettingsNotice>
        )}

        <SettingsFacts
          rows={[
            ["Highest level", surface.ceiling],
            ...(surface.allowedRoots.length > 0
              ? [
                  [
                    "Allowed folders",
                    surface.allowedRoots.map((r) => (
                      <code key={r} className="mr-2 break-all">
                        {r}
                      </code>
                    )),
                  ] as const,
                ]
              : []),
          ]}
        />

        {surface.bindings.length === 0 ? (
          <p data-testid="team-bindings-empty" className={MUTED}>
            No workspace bindings configured.
          </p>
        ) : (
          surface.bindings.map((b) => <Binding key={b.workspaceId} binding={b} />)
        )}

        <div className="space-y-1">
          <p className={SUBHEAD}>Command log</p>
          <p className={MUTED}>Newest first. The dashboard is the only place it is readable.</p>
          {surface.log.length === 0 ? (
            <p data-testid="team-log-empty" className={MUTED}>
              No activity recorded.
            </p>
          ) : (
            <SettingsTable
              testId="team-log"
              caption="Command log"
              columns={["When", "Who", "Command", "Result", "Reason"]}
              rows={surface.log.map((e, i) => ({
                key: `${e.at}-${i}`,
                testId: "team-log-row",
                cells: [
                  formatWhen(e.at),
                  <span key="p" className="break-all">
                    {e.principal}
                  </span>,
                  e.verb,
                  e.outcome === "permitted" ? (
                    <SettingsStatusPill key="o" tone="success" status={e.outcome}>
                      Done
                    </SettingsStatusPill>
                  ) : (
                    <SettingsStatusPill key="o" tone="error" status={e.outcome}>
                      Refused
                    </SettingsStatusPill>
                  ),
                  e.reason ?? "",
                ],
              }))}
            />
          )}
        </div>
      </SettingsGroup>
    </div>
  );
}
