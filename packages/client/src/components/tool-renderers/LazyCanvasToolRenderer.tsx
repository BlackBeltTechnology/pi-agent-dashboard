/**
 * Registry entry for the `canvas` tool: the real card (`CanvasToolRenderer`) is a lazy chunk so its
 * icons, i18n fallbacks and opener hook stay off the cold landing. See change: improve-canvas-html-and-url-ux.
 */
import { lazy, Suspense } from "react";
import type { ToolRenderer } from "./types.js";

const Card = lazy(() => import("./CanvasToolRenderer.js").then((m) => ({ default: m.CanvasToolRenderer })));

export const LazyCanvasToolRenderer: ToolRenderer = (props) => (
  <Suspense fallback={null}>
    <Card {...props} />
  </Suspense>
);
