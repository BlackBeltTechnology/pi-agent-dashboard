/**
 * Access page YOLO card (change: add-access-grant-dialog, tasks 8b.7 surface
 * 3, 8b.7a entry point 1, 8b.7b; mockups S6).
 *
 * Active: undismissable status naming the affected planes, EVERY root (with
 * its add time) or "everywhere" for an unscoped session, the remaining time
 * ("until the server stops" for an environment session), and End now.
 * Below it the shared activation form: full control (durations, the
 * session-cwd ladder, the explicit unscoped choice) or, while a session is
 * live, "add this folder" with the timer unchanged.
 */
import { useState } from "react";
import { endYolo } from "../../lib/access-grants/access-prompts-api.js";
import type { YoloView } from "../../lib/access-grants/access-prompts-types.js";
import { type YoloStatusStore, yoloStatus } from "../../lib/access-grants/yolo-status.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { YoloActivationForm } from "./YoloActivation.js";
import { useLiveYoloSession, yoloRemainingLabel, yoloTone } from "./YoloIndicators.js";

const when = (at: number) => new Date(at).toLocaleString();

export function YoloAccessCard({
  yolo,
  base,
  store = yoloStatus,
  onChanged,
}: {
  yolo: YoloView;
  /** The selected session's working directory: the default scope. */
  base: string | undefined;
  store?: YoloStatusStore;
  onChanged?(): void;
}) {
  const { session, now } = useLiveYoloSession(store);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await endYolo();
      if (!res.ok) setError(res.error ?? `HTTP ${res.status}`);
      await store.refresh();
      onChanged?.();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="yolo-access-card" className="border border-[var(--border-primary)] rounded bg-[var(--bg-secondary)] p-3 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {i18nT("yolo.cardTitle", undefined, "Stop asking for a while (YOLO)")}
        </h3>
        <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
          {i18nT(
            "yolo.cardBody",
            undefined,
            "Auto-answers file and working-directory prompts with Allow once for a fixed time, inside the chosen folders. Nothing is persisted; network, CORS and pairing are never touched; every auto-allow is listed below.",
          )}
        </p>
      </div>

      {session && (
        <div
          data-testid="yolo-access-active"
          data-scope={session.unscoped ? "unscoped" : "scoped"}
          role="status"
          className={`rounded border px-3 py-2 text-xs space-y-1 ${yoloTone(session.unscoped)}`}
        >
          <div className="flex items-center gap-2">
            <b className="flex-1">
              {session.unscoped
                ? i18nT("yolo.activeUnscoped", undefined, "YOLO is on EVERYWHERE (unscoped)")
                : i18nT("yolo.activeScoped", undefined, "YOLO is on")}
              {" · "}
              <span data-testid="yolo-access-remaining" className="tabular-nums">
                {yoloRemainingLabel(session, now)}
              </span>
            </b>
            <button
              type="button"
              data-testid="yolo-end"
              disabled={busy}
              onClick={() => void end()}
              className="shrink-0 px-2 py-1 rounded border border-current disabled:opacity-50 cursor-pointer"
            >
              {i18nT("yolo.endNow", undefined, "End now")}
            </button>
          </div>
          <div data-testid="yolo-access-planes">
            {i18nT(
              "yolo.planes",
              { planes: `${i18nT("grantPrompt.plane.filesystem", undefined, "filesystem")}, ${i18nT("grantPrompt.plane.cwd", undefined, "working directory")}` },
              "Planes: {planes}",
            )}
          </div>
          {session.source === "env" && (
            <div>{i18nT("yolo.envSource", { env: "PI_DASHBOARD_GRANT_YOLO" }, "Activated by {env}.")}</div>
          )}
          {session.unscoped ? (
            <div data-testid="yolo-access-unscoped">
              {i18nT("yolo.everyFolder", undefined, "Folders: every folder on this machine")}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {session.roots.map((r) => (
                <li key={r.path} data-testid="yolo-access-root" className="flex gap-2">
                  <span className="font-mono break-all flex-1">{r.path}</span>
                  <span className="shrink-0 opacity-80">
                    {i18nT("yolo.rootAdded", { at: when(r.addedAt) }, "added {at}")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p data-testid="yolo-end-error" role="alert" className="text-xs text-[var(--severity-error-fg)]">
          {i18nT("yolo.failed", { error }, "YOLO request failed: {error}")}
        </p>
      )}

      <YoloActivationForm yolo={yolo} base={base} allowUnscoped store={store} onChanged={onChanged} />
    </div>
  );
}
