/**
 * Shared chrome for the two corrections panels ({@link GrammarPanel} list +
 * {@link GrammarRedlinePanel} inline). Keeps the shell class, the
 * error-code→message mapping, the close button, and the kind→colour map in one
 * place so the two presentations stay visually consistent.
 * See change: add-grammar-compact-view.
 */
import type { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type {
  GrammarErrorCode,
  GrammarIssueKind,
} from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import { mdiClose } from "@mdi/js";
import Icon from "@mdi/react";

export const PANEL_SHELL =
  "border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 px-3 py-2 flex flex-col gap-2 text-sm";

/** Issue kind → theme colour (CSS var reference), applied via inline style. */
export const KIND_COLOR_VAR: Record<GrammarIssueKind, string> = {
  spelling: "var(--accent-red)",
  grammar: "var(--accent-blue)",
  punctuation: "var(--accent-orange)",
  style: "var(--accent-purple)",
};

export function errorMessage(t: ReturnType<typeof useT>, code: GrammarErrorCode): string {
  switch (code) {
    case "backend_unreachable":
      return t("grammar.err.unreachable", undefined, "Grammar backend unreachable. Check the LanguageTool server or provider.");
    case "backend_timeout":
      return t("grammar.err.timeout", undefined, "Grammar check timed out.");
    case "backend_unconfigured":
      return t("grammar.err.unconfigured", undefined, "Grammar backend is not configured.");
    case "backend_bad_response":
      return t("grammar.err.badResponse", undefined, "Grammar backend returned an unexpected response.");
    default:
      return t("grammar.err.generic", undefined, "Grammar check failed.");
  }
}

export function PanelCloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="grammar-panel-close"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="focus-ring inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
    >
      <Icon path={mdiClose} size={0.7} />
    </button>
  );
}
