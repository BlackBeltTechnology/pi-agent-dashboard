/**
 * Large-file cap gate wrapping the rich viewers (D7). Resolves the viewer from
 * the registry, then — for every rich (non-`monaco`) kind — obtains the file
 * `size` from `/api/file` metadata and mounts `TooLargePreview` instead of the
 * renderer when it exceeds the configured editor large-file limit
 * (`editor.largeFileLimitMb`, read via `resolveEditorLimitBytes()`; default
 * 10 MiB). Monaco text tabs bypass the size gate
 * (they keep their own large-file handling) and render immediately.
 *
 * The size is fetched here (not threaded from the open flow) because the pane
 * mounts viewers with `size = 0`; this single metadata read is cheap and also
 * serves as the existence probe. The probe runs for EVERY viewer kind (monaco
 * included, without delaying its first render): a 404 replaces the viewer with
 * a `File no longer exists: <path>` message (never a blank pane). Only a 404
 * counts — a refusal or a network failure still mounts the viewer.
 *
 * While the config mirror has not hydrated, the gate waits (so a raised limit
 * never flashes the too-large fallback) and falls back to the default after
 * `LIMIT_HYDRATION_WAIT_MS`. A later limit change re-gates live.
 *
 * See change: open-view-command-in-editor-pane (D7, test-plan P1),
 *             gate-changed-on-disk-by-content (D6),
 *             composer-dock-collapse-and-file-open (D6).
 */
import { useEffect, useState } from "react";
import { fetchWithoutGrantPrompt } from "../../lib/access-grants/grant-channel.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { useEditorLimits } from "../../lib/preview/editor-limits-config.js";
import { TooLargePreview } from "./TooLargePreview.js";
import type { ViewerProps } from "./types.js";
import type { OpenPathViewer } from "./viewer-kinds.js";
import { viewerRegistry } from "./viewer-registry.js";

/**
 * `viewer` is narrowed to `OpenPathViewer` (D3): the four pseudo-tab kinds are
 * dispatched by `EditorPane` straight to `pseudoTabRegistry` and never reach
 * this gate, whose `/api/file` size probe is meaningless for a virtual path.
 * Narrowing here is what makes a mis-routed kind a compile error.
 * See change: cleanup-import-cycles (D3).
 */
type Props = ViewerProps & { viewer: OpenPathViewer };

/** How long the gate waits for the `/api/config` mirror before using the default limit. */
const LIMIT_HYDRATION_WAIT_MS = 3000;

/** Result of the metadata read: not yet known, a size, or a 404. */
type Probe = { kind: "pending" } | { kind: "ok"; size: number } | { kind: "missing" };

export function CappedViewer({ viewer, ...props }: Props) {
  const { t } = useI18n();
  const Viewer = viewerRegistry[viewer];
  // Monaco keeps its own large-file handling; never size-gate it.
  const gated = viewer !== "monaco";
  const [probe, setProbe] = useState<Probe>(() => (props.size > 0 ? { kind: "ok", size: props.size } : { kind: "pending" }));
  const limits = useEditorLimits();
  const [limitWaitExpired, setLimitWaitExpired] = useState(false);

  useEffect(() => {
    if (!gated || limits.loaded) return;
    const timer = setTimeout(() => setLimitWaitExpired(true), LIMIT_HYDRATION_WAIT_MS);
    return () => clearTimeout(timer);
  }, [gated, limits.loaded]);

  const pending = probe.kind === "pending";
  useEffect(() => {
    if (!pending) return;
    let active = true;
    // ALWAYS opted out of the access-grant dialog, whatever the provenance:
    // this metadata read runs before the viewer mounts, and an Allow once spent
    // on it would leave the viewer's own content request refused. On a refusal
    // the size is 0 and the viewer mounts; its request is the one that asks.
    // See change: surface-denial-remedy-in-previews (D4).
    fetchWithoutGrantPrompt(`${getApiBase()}/api/file?cwd=${encodeURIComponent(props.cwd)}&path=${encodeURIComponent(props.path)}`)
      .then(async (res) => {
        if (!active) return;
        if (res.status === 404) {
          setProbe({ kind: "missing" });
          return;
        }
        const body = await res.json();
        if (active) setProbe({ kind: "ok", size: typeof body?.data?.size === "number" ? body.data.size : 0 });
      })
      .catch(() => active && setProbe({ kind: "ok", size: 0 }));
    return () => {
      active = false;
    };
    // Re-probe on target change only.
  }, [pending, props.cwd, props.path]);

  if (probe.kind === "missing") {
    return (
      <div
        role="status"
        data-testid="editor-file-missing"
        className="p-4 text-sm text-[var(--text-secondary)] [overflow-wrap:anywhere]"
      >
        {t("editor.fileMissing", { path: props.path }, "File no longer exists: {path}")}
      </div>
    );
  }
  if (!gated) return <Viewer {...props} />;
  if (probe.kind === "pending" || !(limits.loaded || limitWaitExpired)) {
    return (
      <div className="p-4 text-sm text-[var(--text-tertiary)]">
        {t("editor.loadingViewer", undefined, "Loading viewer…")}
      </div>
    );
  }
  if (probe.size > limits.bytes) {
    return <TooLargePreview cwd={props.cwd} path={props.path} size={probe.size} />;
  }
  return <Viewer {...props} size={probe.size} />;
}
