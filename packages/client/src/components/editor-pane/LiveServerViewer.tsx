/**
 * Live-server-preview tab — embeds a running LOOPBACK dev server or a local
 * static page (viewer kind `live-server`).
 *
 * Entry points:
 *   - the picker (`live:preview` / no payload): saved targets + a confirmed URL
 *     entry → `startLiveServer` (client + server both run the loopback SSRF
 *     check). An operator action: OPEN egress.
 *   - a `live:<loopback url>` preset (the agent's confirm-chip tap, a linkified
 *     URL click): `startLiveServer({addedBy:"preset"})` → in-memory, never
 *     persisted; egress follows the tab's provenance (agent → restricted).
 *   - a `static:<absolute file>` preset (canvas auto-open / card / chip, tree
 *     click): `POST /start-static` → a served document root.
 *
 * The framed half (policy, mint, address bar, Scripts ⇄ Static, exposure, egress
 * banner, Open, keepalive) lives in `live/LiveFrame`. The frame carries no cookie
 * (opaque origin), so it loads a per-preview capability path minted for this
 * viewer; the token is only ever the frame's `src` / the Open target — never shown.
 *
 * See change: improve-content-editor (live-server-preview §6.3);
 * retire-trusted-networks-bypass (D5); improve-canvas-html-and-url-ux (D1-D9).
 */
import type { LiveServerTarget } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePreviewFetch, usePreviewOpener } from "../../lib/access-grants/preview-provenance.js";
import { listLiveServers, removeLiveServer, startLiveServer, startStaticTarget } from "../../lib/api/live-server-api.js";
import { useActiveCanvasPort } from "../../lib/canvas/active-canvas-target.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { type Opener, parsePresetPath } from "../../lib/live-preview/preview-policy.js";
import { classifyResponse } from "../preview/denial-fetch.js";
import { useOptionalSplitWorkspace } from "../split/SplitWorkspaceContext.js";
import { type FramedTarget, LiveFrame } from "./live/LiveFrame.js";
import { TargetPicker } from "./live/TargetPicker.js";
import type { ViewerProps } from "./types.js";

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

/** The text for a refused/failed `start-static`: the server's own refusal wording when it gave one. */
async function refusalMessage(
  res: { error: string; response?: Response },
  optedOut: boolean,
  t: ReturnType<typeof useI18n>["t"],
): Promise<string> {
  const failure = res.response ? await classifyResponse(res.response, optedOut) : null;
  if (failure?.kind === "refused") return failure.error;
  if (failure?.kind === "denied") return t("live.static.denied", { subject: failure.subject }, "Access to {subject} was refused.");
  return res.error;
}

interface Framed {
  target: FramedTarget;
  deep: string;
  /** `picker` = an operator action (open egress); `preset` = the tab's provenance decides. */
  launchedBy: "picker" | "preset";
  /** Bumped per launch so a re-launch of the same target remounts its frame. */
  seq: number;
}

export default function LiveServerViewer({ path: viewerPath, cwd, reloadNonce, updatedByAgent }: Partial<ViewerProps> = {}) {
  const { t } = useI18n();
  const split = useOptionalSplitWorkspace();
  const sessionId = split?.sessionId;
  const tabOpener = usePreviewOpener();
  const { fetch: previewFetch } = usePreviewFetch();
  const activePort = useActiveCanvasPort(sessionId);

  const [servers, setServers] = useState<LiveServerTarget[]>([]);
  const [framed, setFramed] = useState<Framed | null>(null);
  const [url, setUrl] = useState("http://localhost:5173");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const refreshList = useCallback(() => {
    listLiveServers()
      .then(setServers)
      .catch(() => setError(t("editor.couldntLoadSavedTargets", undefined, "Couldn't load saved targets.")));
  }, [t]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: load the saved list once on mount
  useEffect(() => refreshList(), []);

  const launchPort = useCallback(
    async (
      input: { host: string; port: number; label?: string; deep?: string; addedBy: "user" | "preset" },
      launchedBy: Framed["launchedBy"],
    ): Promise<string | null> => {
      setBusy(true);
      setError(null);
      try {
        const res = await startLiveServer({
          host: input.host,
          port: input.port,
          label: input.label,
          addedBy: input.addedBy,
          sessionId: input.addedBy === "preset" ? sessionId : undefined,
        });
        if (!res.ok) {
          setError(res.error);
          return res.error;
        }
        seq.current += 1;
        setFramed({
          target: { kind: "port", id: res.target.id, host: res.target.host, port: res.target.port, addedBy: res.target.addedBy ?? input.addedBy },
          deep: input.deep ?? "",
          launchedBy,
          seq: seq.current,
        });
        setServers((prev) => (prev.some((s) => s.id === res.target.id) ? prev : [...prev, res.target]));
        return null;
      } finally {
        // Always clear busy — an unexpected throw must not leave Preview disabled.
        setBusy(false);
      }
    },
    [sessionId],
  );

  const launchStatic = useCallback(
    async (file: string) => {
      if (!cwd) {
        setError(t("live.static.noCwd", undefined, "Cannot open this file: no working directory."));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await startStaticTarget(cwd, file, previewFetch);
        if (!res.ok) {
          setError(await refusalMessage(res, tabOpener !== "operator", t));
          return;
        }
        seq.current += 1;
        setFramed({ target: { kind: "static", id: res.id, root: res.root }, deep: res.entry, launchedBy: "preset", seq: seq.current });
      } finally {
        setBusy(false);
      }
    },
    [cwd, previewFetch, tabOpener, t],
  );

  // Auto-launch a preset (`live:<url>` / `static:<file>`) instead of showing the picker.
  // biome-ignore lint/correctness/useExhaustiveDependencies: launch once per preset path
  useEffect(() => {
    const preset = parsePresetPath(viewerPath);
    if (!preset) return;
    if (preset.kind === "invalid-path") {
      setFramed(null);
      setError(t("live.address.invalidPath", undefined, "Invalid path. Use a path inside this preview (no empty, . or .. segments)."));
      return;
    }
    if (preset.kind === "static") {
      void launchStatic(preset.file);
      return;
    }
    void launchPort({ host: preset.host, port: preset.port, deep: preset.deep, addedBy: "preset" }, "preset");
  }, [viewerPath]);

  const onConfirm = () => {
    const parsed = parseTarget(url);
    if (!parsed) {
      setError(t("editor.enterValidUrl", undefined, "Enter a valid URL, e.g. http://localhost:5173"));
      return;
    }
    void launchPort({ ...parsed, label: label.trim() || undefined, addedBy: "user" }, "picker");
  };

  const onRemove = async (ids: string[]) => {
    await Promise.all(ids.map((id) => removeLiveServer(id)));
    setServers((prev) => prev.filter((s) => !ids.includes(s.id)));
  };

  if (framed) {
    const opener: Opener = framed.launchedBy === "picker" ? "operator" : tabOpener;
    return (
      <LiveFrame
        key={`${framed.target.id}:${framed.seq}`}
        target={framed.target}
        initialDeep={framed.deep}
        opener={opener}
        title={t("editor.liveServerPreview", undefined, "Live server preview")}
        onBack={() => setFramed(null)}
        onLaunchPort={(i) => launchPort({ host: i.host, port: i.port, deep: i.deep, addedBy: "user" }, "picker")}
        reloadNonce={reloadNonce}
        updatedByAgent={updatedByAgent}
        onAckUpdate={() => viewerPath && split?.dispatch({ type: "ackUpdate", path: viewerPath })}
      />
    );
  }

  return (
    <TargetPicker
      servers={servers}
      activePort={activePort}
      url={url}
      label={label}
      error={error}
      busy={busy}
      onUrlChange={setUrl}
      onLabelChange={setLabel}
      onConfirm={onConfirm}
      onLaunch={(s) => void launchPort({ host: s.host, port: s.port, label: s.label, addedBy: s.addedBy === "preset" ? "preset" : "user" }, "picker")}
      onRemove={(ids) => void onRemove(ids)}
    />
  );
}
