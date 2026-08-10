/**
 * Live-server-preview tab — embeds a running LOOPBACK dev server / mockup.
 *
 * Flow: pick a saved allowlist target OR enter a URL (confirmed, never auto-
 * fetched) → `startLiveServer` (client + server both run the loopback SSRF
 * check) → iframe the proxied `/live/<id>/` path on the MAIN origin with
 * `sandbox="allow-scripts"` and NO `allow-same-origin` (opaque origin, D7):
 * the app's scripts run but it cannot read the dashboard token or call its
 * APIs. Remote/free-form hosts are refused by `validateLiveTarget`.
 *
 * See change: improve-content-editor (live-server-preview §6.3).
 */
import { isLoopbackUrl, type LiveServerTarget } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import { mdiOpenInNew, mdiPlay } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { listLiveServers, startLiveServer } from "../../lib/api/live-server-api.js";
import type { ViewerProps } from "./types.js";

/**
 * Parse a `live:<url>` preset sentinel into a launch target + deep path.
 * `live:preview` / empty / non-loopback payloads return null (→ picker).
 */
function parsePreset(
  viewerPath: string | undefined,
): { host: string; port: number; deep: string } | null {
  if (!viewerPath?.startsWith("live:")) return null;
  const target = viewerPath.slice("live:".length);
  if (!isLoopbackUrl(target)) return null;
  try {
    const u = new URL(target);
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    // Strip IPv6 brackets so the host matches the server allowlist.
    const host = u.hostname.replace(/^\[|\]$/g, "");
    // Deep link (path + query) to append onto the `/live/<id>/` mount.
    const deep = `${u.pathname}${u.search}`.replace(/^\//, "");
    return { host, port, deep };
  } catch {
    return null;
  }
}

/** Parse a user-entered URL into `{ host, port }`; null when unparseable. */
function parseTarget(input: string): { host: string; port: number } | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const u = new URL(withScheme);
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    return { host: u.hostname, port };
  } catch {
    return null;
  }
}

export default function LiveServerViewer({ path: viewerPath }: Partial<ViewerProps> = {}) {
  const { t } = useI18n();
  const [servers, setServers] = useState<LiveServerTarget[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [deep, setDeep] = useState("");
  const [url, setUrl] = useState("http://localhost:5173");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listLiveServers()
      .then(setServers)
      .catch(() => setError(t("editor.couldntLoadSavedTargets", undefined, "Couldn't load saved targets.")));
  }, []);

  // Auto-launch a preset `live:<url>` target instead of showing the picker.
  // biome-ignore lint/correctness/useExhaustiveDependencies: launch closes over stable setters; launch once per preset path.
  useEffect(() => {
    const preset = parsePreset(viewerPath);
    if (!preset) return;
    void launch({ host: preset.host, port: preset.port, deep: preset.deep });
  }, [viewerPath]);

  // `deep` is threaded through `launch` so it is set ATOMICALLY with `path`;
  // a manual/saved-target launch (no `deep`) resets it, never reusing a prior
  // preset's deep segment.
  const launch = async (input: { host: string; port: number; label?: string; deep?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await startLiveServer(input);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPath(res.target.path);
      setDeep(input.deep ?? "");
      setServers((prev) => (prev.some((s) => s.id === res.target.id) ? prev : [...prev, res.target]));
    } finally {
      // Always clear busy — an unexpected throw must not leave Preview disabled.
      setBusy(false);
    }
  };

  const onConfirm = () => {
    const parsed = parseTarget(url);
    if (!parsed) {
      setError(t("editor.enterValidUrl", undefined, "Enter a valid URL, e.g. http://localhost:5173"));
      return;
    }
    void launch({ ...parsed, label: label.trim() || undefined });
  };

  if (path) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] px-2 py-1 text-xs">
          <button
            type="button"
            data-testid="live-back"
            onClick={() => setPath(null)}
            className="rounded px-2 py-0.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
          >
            {t("editor.backToTargets", undefined, "← Targets")}
          </button>
          <span className="truncate font-mono text-[var(--text-secondary)]">{path}</span>
          <span className="flex-1" />
          <a
            href={`${getApiBase()}${path}${deep}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
          >
            <Icon path={mdiOpenInNew} size={0.55} />
            <span>{t("editor.openExternal", undefined, "Open")}</span>
          </a>
        </div>
        <iframe
          data-testid="live-iframe"
          // D7: opaque origin — scripts run, but NO allow-same-origin, so the
          // embedded app cannot read the dashboard token or call /api/*.
          sandbox="allow-scripts allow-forms allow-popups"
          src={`${getApiBase()}${path}${deep}`}
          title={t("editor.liveServerPreview", undefined, "Live server preview")}
          className="min-h-0 flex-1 border-0 bg-white"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4 text-sm">
      <div>
        <h3 className="mb-1 font-medium text-[var(--text-primary)]">{t("editor.previewLocalDevServer", undefined, "Preview a local dev server")}</h3>
        <p className="text-xs text-[var(--text-tertiary)]">
          {t("editor.loopbackOnlyHint", undefined, "Loopback only (localhost / 127.0.0.1). Runs sandboxed — the app can't reach the dashboard.")}
        </p>
      </div>

      {/* Add / confirm a target */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          data-testid="live-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:5173"
          className="min-w-0 flex-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-xs"
        />
        <input
          data-testid="live-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("editor.labelOptional", undefined, "label (optional)")}
          className="w-32 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
        />
        <button
          type="button"
          data-testid="live-confirm"
          onClick={onConfirm}
          disabled={busy}
          className="flex items-center gap-1 rounded bg-[var(--accent-blue)] px-3 py-1 text-white disabled:opacity-40"
        >
          <Icon path={mdiPlay} size={0.6} />
          <span>{t("editor.preview", undefined, "Preview")}</span>
        </button>
      </div>

      {error && <div data-testid="live-error" className="text-xs text-[var(--accent-red)]">{error}</div>}

      {/* Saved allowlist */}
      {servers.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-[var(--text-secondary)]">{t("editor.savedTargets", undefined, "Saved targets")}</div>
          <ul className="flex flex-col gap-1">
            {servers.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => void launch({ host: s.host, port: s.port, label: s.label })}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-[var(--bg-hover)]"
                >
                  <Icon path={mdiPlay} size={0.55} className="text-[var(--accent-green)]" />
                  <span className="font-medium">{s.label}</span>
                  <span className="font-mono text-xs text-[var(--text-tertiary)]">
                    {s.host}:{s.port}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
