/**
 * Settings-section status card (design D6): per OBS service its state, auth
 * state, OBS version, exposure warning, `recovery-suspended`, and "Open OBS
 * panel" (→ `/obs/`, content area beside the sidebar). No OBS → provision hint
 * and no controls. Loaded lazily from the client barrel (cold-chunk cap).
 * See change: add-obs-studio-plugin.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { type MessageKey, tr } from "../messages.js";
import { API, ApiError, api, authState, type InstanceStatus } from "./api.js";

const muted = "text-xs text-[var(--text-secondary)]";
const warnText = "text-xs text-[var(--severity-warning-fg)]";
const errorText = "text-xs text-[var(--severity-error-fg)]";
const primaryBtn = "focus-ring tap-target self-start rounded-md bg-[var(--accent-solid)] px-3 text-xs font-semibold text-white";

export function ObsSettingsCard(): React.ReactElement {
  const t = useT();
  const s = (k: MessageKey, v?: Record<string, string | number>) => tr(t, k, v);
  const [, navigate] = useLocation();
  const [instances, setInstances] = useState<InstanceStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ instances: InstanceStatus[] }>((p, i) => fetch(p, i), `${API}/instances`)
      .then((r) => setInstances(r.instances))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.code : String(e)));
  }, []);

  return (
    <section data-testid="obs-settings" className="flex flex-col gap-3" aria-label={s("title")}>
      <p className={muted}>{s("intro")}</p>
      {error && <p role="alert" className={errorText}>{s("error", { error })}</p>}
      {instances === null && !error && <p className={muted} aria-busy="true">{s("loading")}</p>}
      {instances?.length === 0 && (
        <div data-testid="obs-settings-none" className="flex flex-col gap-1">
          <p className="text-sm text-[var(--text-primary)]">{s("none")}</p>
          <p className={muted}>{s("provisionHint")}</p>
        </div>
      )}
      {instances?.map((i) => {
        const auth = authState(i);
        return (
          <div key={i.id} data-testid={`obs-instance-${i.id}`} className="flex flex-col gap-1 rounded-md border border-[var(--border-secondary)] p-3">
            <div className="text-sm font-semibold text-[var(--text-primary)]">{i.id}</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              <dt className="text-[var(--text-secondary)]">{s("state")}</dt>
              <dd className="text-[var(--text-primary)]">{i.state}</dd>
              <dt className="text-[var(--text-secondary)]">{s("auth")}</dt>
              <dd className={auth === "failed" ? "text-[var(--severity-error-fg)]" : "text-[var(--text-primary)]"}>
                {s(auth === "ok" ? "authOk" : auth === "failed" ? "authFailed" : "authUnknown")}
              </dd>
              {i.live?.obsVersion && (
                <>
                  <dt className="text-[var(--text-secondary)]">{s("version")}</dt>
                  <dd className="text-[var(--text-primary)]">{i.live.obsVersion}</dd>
                </>
              )}
            </dl>
            {i.exposure === "all-interfaces" && <p className={warnText}>{s("exposureWarning")}</p>}
            {i.recoverySuspended && <p className={warnText}>{s("recoverySuspended")}</p>}
          </div>
        );
      })}
      {instances && instances.length > 0 && (
        <button type="button" className={primaryBtn} onClick={() => navigate("/obs/")}>
          {s("openPanel")}
        </button>
      )}
    </section>
  );
}
