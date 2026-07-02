/**
 * Shared Monaco bootstrap (side-effect import).
 *
 * Bundles the editor / language workers locally via Vite `?worker` instead of
 * @monaco-editor/react's default CDN loader, and points `@monaco-editor/react`
 * at the bundled `monaco-editor` (`loader.config`). Both `MonacoBuffer.tsx`
 * (read-only code viewer) and `MarkdownEditor.tsx` (editable markdown) import
 * this for side-effects so worker wiring lives in one place. The
 * `MonacoEnvironment` assignment is idempotent — importing from both modules is
 * safe.
 *
 * NOTE: the TypeScript language worker (`ts.worker`, ~6 MB) is deliberately NOT
 * imported; ts/js fall back to `editor.worker`. See change:
 * add-internal-monaco-editor-pane / directory-settings-page-and-scoped-md-editing.
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

(self as unknown as { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });
