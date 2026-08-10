/**
 * Large-file cap gate wrapping the rich viewers (D7). Resolves the viewer from
 * the registry, then — for every rich (non-`monaco`) kind — obtains the file
 * `size` from `/api/file` metadata and mounts `TooLargePreview` instead of the
 * renderer when it exceeds `MAX_PREVIEW_BYTES`. Monaco text tabs bypass the gate
 * (they keep their own large-file handling) and render immediately.
 *
 * The size is fetched here (not threaded from the open flow) because the pane
 * mounts viewers with `size = 0`; this single metadata read is cheap and also
 * serves as an existence probe.
 *
 * See change: open-view-command-in-editor-pane (D7, test-plan P1).
 */
import { MAX_PREVIEW_BYTES } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { useI18n } from "../../lib/i18n/i18n.js";
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

export function CappedViewer({ viewer, ...props }: Props) {
  const { t } = useI18n();
  const Viewer = viewerRegistry[viewer];
  // Monaco keeps its own large-file handling; never gate it.
  const gated = viewer !== "monaco";
  const [size, setSize] = useState<number | null>(props.size > 0 ? props.size : null);

  useEffect(() => {
    if (!gated || size !== null) return;
    let active = true;
    fetch(`${getApiBase()}/api/file?cwd=${encodeURIComponent(props.cwd)}&path=${encodeURIComponent(props.path)}`)
      .then((res) => res.json())
      .then((body) => {
        if (!active) return;
        setSize(typeof body?.data?.size === "number" ? body.data.size : 0);
      })
      .catch(() => active && setSize(0));
    return () => {
      active = false;
    };
    // Re-probe on target change only.
  }, [gated, props.cwd, props.path, size]);

  if (!gated) return <Viewer {...props} />;
  if (size === null) {
    return (
      <div className="p-4 text-sm text-[var(--text-tertiary)]">
        {t("editor.loadingViewer", undefined, "Loading viewer…")}
      </div>
    );
  }
  if (size > MAX_PREVIEW_BYTES) {
    return <TooLargePreview cwd={props.cwd} path={props.path} size={size} />;
  }
  return <Viewer {...props} size={size} />;
}
