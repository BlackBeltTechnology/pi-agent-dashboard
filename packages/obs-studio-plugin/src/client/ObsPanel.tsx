/**
 * The OBS panel (design D6): instance picker, scene list + switch, virtual
 * camera and record toggles, program preview. Lifecycle: not healthy and not
 * `blocked` → state + reason + Start/Retry through `/api/services/:id/{start,retry}`;
 * `blocked` → "waiting for input on the host", no actions; auth failure →
 * re-provision hint. Never offers Stop. Opening it as an operator requests the
 * screenshot, which opens the bridge; observe-only viewers see managed state.
 * See change: add-obs-studio-plugin.
 */
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type MessageKey, tr } from "../i18n.js";
import { API, ApiError, api, authState, type Fetcher, type InstanceStatus, lifecycleAction } from "./api.js";
import { usePreview } from "./usePreview.js";

export type TFn = (key: string, vars?: Record<string, string | number>, fallback?: string) => string;

const btn =
  "focus-ring tap-target rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50";
const activeBtn = "focus-ring tap-target rounded-md bg-[var(--accent-solid)] px-2.5 text-xs font-semibold text-white disabled:opacity-50";
const muted = "text-xs text-[var(--text-secondary)]";
const warnText = "text-xs text-[var(--severity-warning-fg)]";
const errorText = "text-xs text-[var(--severity-error-fg)]";

const STATUS_POLL_MS = 5000;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one render over the panel states (none, blocked, not healthy, healthy); splitting scatters the state table
export function ObsPanel({ fetcher, t }: { fetcher: Fetcher; t: TFn }): React.ReactElement {
  const s = (k: MessageKey, v?: Record<string, string | number>) => tr(t, k, v);
  const [instances, setInstances] = useState<InstanceStatus[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [status, setStatus] = useState<InstanceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ instances: InstanceStatus[] }>(fetcher, `${API}/instances`)
      .then((r) => {
        setInstances(r.instances);
        setSelected((cur) => cur || r.instances[0]?.id || "");
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.code : String(e)));
  }, [fetcher]);

  const refresh = useCallback(async () => {
    if (!selected) return;
    try {
      setStatus(await api<InstanceStatus>(fetcher, `${API}/${encodeURIComponent(selected)}/status`));
    } catch (e) {
      setError(e instanceof ApiError ? e.code : String(e));
    }
  }, [fetcher, selected]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const healthy = status?.state === "healthy";
  const fetchFrame = useMemo(
    () =>
      healthy && !denied && selected
        ? async () => {
            try {
              const r = await api<{ result: { imageData: string } }>(fetcher, `${API}/${encodeURIComponent(selected)}/screenshot`);
              return r.result.imageData;
            } catch (e) {
              if (e instanceof ApiError && e.status === 403) setDenied(true);
              throw e;
            }
          }
        : null,
    [fetcher, selected, healthy, denied],
  );
  const preview = usePreview(fetchFrame);

  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api(fetcher, path, { method: "POST", body: JSON.stringify(body) });
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setDenied(true);
      else setError(e instanceof ApiError ? e.code : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (instances === null) return <p className={muted} aria-busy="true">{s("loading")}</p>;
  if (instances.length === 0) {
    return (
      <div data-testid="obs-none" className="flex flex-col gap-2 p-4">
        <p className="text-sm text-[var(--text-primary)]">{s("none")}</p>
        <p className={muted}>{s("provisionHint")}</p>
      </div>
    );
  }

  const live = status?.live;
  const scenes = live?.scenes ?? [];
  const current = live?.current ?? live?.currentScene ?? null;
  const action = status ? lifecycleAction(status.state) : null;
  const svc = encodeURIComponent(selected);

  return (
    <div data-testid="obs-panel" className="flex flex-col gap-3 p-4">
      {instances.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          {s("instance")}
          <select
            className="focus-ring rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-primary)]"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setStatus(null);
              setDenied(false);
            }}
          >
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.id}
              </option>
            ))}
          </select>
        </label>
      )}

      {status?.state === "blocked" && (
        <p role="status" data-testid="obs-blocked" className={warnText}>
          {s("blocked")}
        </p>
      )}
      {status && !healthy && status.state !== "blocked" && (
        <div data-testid="obs-not-healthy" className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--text-primary)]">{s("notHealthy", { state: status.state })}</span>
          {status.reason && <span className={muted}>{s("reason", { reason: status.reason })}</span>}
          {action && (
            <button type="button" className={btn} disabled={busy} onClick={() => act(`/api/services/${svc}/${action}`, {})}>
              {s(action)}
            </button>
          )}
        </div>
      )}
      {status && authState(status) === "failed" && <p className={errorText}>{s("authFailed")}</p>}
      {status?.recoverySuspended && <p className={warnText}>{s("recoverySuspended")}</p>}
      {denied && <p className={muted}>{s("operateRequired")}</p>}
      {healthy && !live && !denied && <p className={muted}>{s("liveUnavailable")}</p>}

      {healthy && !denied && (
        <>
          <figure className="flex flex-col gap-1">
            <figcaption className={muted}>{current ? s("programScene", { scene: current }) : s("preview")}</figcaption>
            {preview.src ? (
              <img data-testid="obs-preview" src={preview.src} alt={s("preview")} className="max-w-full rounded border border-[var(--border-secondary)]" width={640} />
            ) : (
              <div className={`${muted} flex h-24 items-center justify-center rounded border border-dashed border-[var(--border-secondary)]`}>{s("previewUnavailable")}</div>
            )}
          </figure>

          {scenes.length > 0 && (
            <section aria-label={s("scenes")} className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">{s("scenes")}</h3>
              <ul className="flex flex-wrap gap-2" data-testid="obs-scenes">
                {scenes.map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      className={name === current ? activeBtn : btn}
                      aria-pressed={name === current}
                      aria-label={s("switchTo", { scene: name })}
                      disabled={busy}
                      onClick={() => act(`${API}/${svc}/scene`, { sceneName: name })}
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {live && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={live.virtualCam ? activeBtn : btn} aria-pressed={live.virtualCam === true} disabled={busy} onClick={() => act(`${API}/${svc}/virtualcam`, { on: !live.virtualCam })}>
                {s("virtualCam")}: {live.virtualCam ? s("on") : s("off")}
              </button>
              <button type="button" className={live.recording ? activeBtn : btn} aria-pressed={live.recording === true} disabled={busy} onClick={() => act(`${API}/${svc}/record`, { on: !live.recording })}>
                {s("recording")}: {live.recording ? s("on") : s("off")}
              </button>
            </div>
          )}
          {live?.virtualCam && <p className={muted}>{s("vcamRestart")}</p>}
        </>
      )}
      {error && <p role="alert" className={errorText}>{s("error", { error })}</p>}
    </div>
  );
}
