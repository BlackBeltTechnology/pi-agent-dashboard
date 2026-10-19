/**
 * Settings-section status card (design D6): per OBS service its state, auth
 * state, OBS version, exposure warning, `recovery-suspended`, and "Open OBS
 * panel" (→ `/obs/`, content area beside the sidebar). No OBS → provision hint
 * and no controls. Loaded lazily from the client barrel (cold-chunk cap).
 * See change: add-obs-studio-plugin.
 */
import { SettingsCopyButton, SettingsFacts, SettingsItem, SettingsNotice, SettingsStatusPill, type SettingsStatusTone, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { type MessageKey, tr } from "../messages.js";
import { API, ApiError, api, authState, type InstanceStatus } from "./api.js";

const muted = "text-xs text-[var(--text-secondary)]";
const secondaryBtn =
  "focus-ring inline-flex min-h-[32px] items-center gap-1 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]";
const codeCls = "rounded bg-[var(--bg-tertiary)] px-1 font-mono text-[12px] text-[var(--text-primary)]";

/** Placeholder the `{cmd}` variable is replaced with, then split around the `<code>` element. */
const CMD_MARK = "\u0001";

/** Renders `text` with its `CMD_MARK` swapped for a `<code>` element (no literal backticks reach the UI). */
function withCode(text: string, cmd: string): React.ReactNode {
  const [before, after = ""] = text.split(CMD_MARK);
  return (
    <>
      {before}
      <code className={codeCls}>{cmd}</code>
      {after}
    </>
  );
}

/** Instance lifecycle state → human word key + severity tone (raw state stays in `data-status`). */
const STATE_WORD: Record<string, { key: MessageKey; tone: SettingsStatusTone }> = {
  healthy: { key: "stateRunning", tone: "success" },
  stopped: { key: "stateStopped", tone: "neutral" },
  idle: { key: "stateIdle", tone: "neutral" },
  blocked: { key: "stateBlocked", tone: "warning" },
  failed: { key: "stateFailed", tone: "error" },
  "stop-failed": { key: "stateStopFailed", tone: "error" },
  unavailable: { key: "stateUnavailable", tone: "error" },
};

export function ObsSettingsCard(): React.ReactElement {
  const t = useT();
  const s = (k: MessageKey, v?: Record<string, string | number>) => tr(t, k, v);
  const [, navigate] = useLocation();
  const [instances, setInstances] = useState<InstanceStatus[] | null>(null);
  /** Raw failure text — only ever copied via "Copy details", never rendered. */
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<{ instances: InstanceStatus[] }>((p, i) => fetch(p, i), `${API}/instances`)
      .then((r) => setInstances(r.instances))
      .catch((e: unknown) => setError(e instanceof ApiError ? `${e.code} (HTTP ${e.status})` : String(e)));
  }, []);

  useEffect(load, [load]);

  const commandNotice = (tone: "warning" | "error", msg: MessageKey, cmd: string) => (
    <SettingsNotice tone={tone} actions={<SettingsCopyButton text={cmd} label={s("copyCommand")} />}>
      {withCode(s(msg, { cmd: CMD_MARK }), cmd)}
    </SettingsNotice>
  );

  return (
    <section data-testid="obs-settings" className="flex flex-col gap-3" aria-label={s("title")}>
      <p className={muted}>{s("intro")}</p>
      {error && (
        <SettingsNotice tone="error" testId="obs-settings-error" onRetry={load} details={error}>
          {s("loadError")}
        </SettingsNotice>
      )}
      {instances === null && !error && <p className={muted} aria-busy="true">{s("loading")}</p>}
      {instances?.length === 0 && (
        <div data-testid="obs-settings-none" className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-[var(--border-secondary)] p-4">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{s("none")}</p>
          <p className={muted}>{s("provisionHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className={codeCls}>pi-obs provision</code>
            <SettingsCopyButton text="pi-obs provision" label={s("copyCommand")} />
          </div>
        </div>
      )}
      {instances?.map((i) => {
        const auth = authState(i);
        const word = STATE_WORD[i.state] ?? { key: "stateUnknown" as const, tone: "neutral" as const };
        return (
          <SettingsItem
            key={i.id}
            testId={`obs-instance-${i.id}`}
            title={i.id}
            status={
              <>
                <SettingsStatusPill tone={word.tone} status={i.state}>
                  {s(word.key)}
                </SettingsStatusPill>
                {auth === "failed" && <SettingsStatusPill tone="error">{s("authRejected")}</SettingsStatusPill>}
              </>
            }
            actions={
              <button type="button" className={secondaryBtn} onClick={() => navigate("/obs/")}>
                {s("openPanel")}
              </button>
            }
          >
            <SettingsFacts
              rows={[
                [s("auth"), s(auth === "ok" ? "authOk" : auth === "failed" ? "authRejected" : "authUnknown")],
                ...(i.live?.obsVersion ? ([[s("version"), i.live.obsVersion]] as const) : []),
              ]}
            />
            {i.exposure === "all-interfaces" && <SettingsNotice tone="warning">{s("exposureWarning")}</SettingsNotice>}
            {auth === "failed" && commandNotice("error", "authFailed", "pi-obs provision --update")}
            {i.recoverySuspended && commandNotice("warning", "recoverySuspended", "pi-obs launch --reset-recovery")}
          </SettingsItem>
        );
      })}
    </section>
  );
}
