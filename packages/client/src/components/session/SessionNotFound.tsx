/**
 * Inline not-found / ambiguous state for a `/session/:id` URL whose id does not
 * resolve (design D3). Deliberately NOT a redirect with a toast: an agent that
 * observes the page through snapshots needs the evidence to stay on screen.
 * See change: add-session-ui-deep-links-for-agents.
 */
import { Link, useLocation } from "wouter";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { sessionUiPath } from "@blackbelt-technology/pi-dashboard-shared/session-ui-path.js";

interface Props {
  id: string;
  /** Held ids sharing an ambiguous prefix. */
  candidates?: string[];
  /** The lookup itself failed (network / 5xx): offer a retry. */
  lookupFailed?: boolean;
  onRetry?: () => void;
}

export function SessionNotFound({ id, candidates, lookupFailed, onRetry }: Props) {
  const [, navigate] = useLocation();
  return (
    <div
      data-testid="session-not-found"
      className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-[var(--text-secondary)]"
    >
      <h2 className="text-base font-semibold text-[var(--text-primary)]">
        {i18nT("session.notFound.title", undefined, "Session not found")}
      </h2>
      <code className="rounded bg-[var(--bg-secondary)] px-2 py-1 font-mono text-sm break-all">{id}</code>
      <p className="max-w-md text-sm">
        {i18nT(
          "session.notFound.hint",
          undefined,
          "Full session ids come from GET /api/sessions. Archived sessions open with the full id and ?archived=1.",
        )}
      </p>
      {candidates && candidates.length > 0 && (
        <div className="flex flex-col items-center gap-1 text-sm">
          <span>{i18nT("session.notFound.candidates", undefined, "Matching sessions:")}</span>
          <ul className="flex flex-col gap-1">
            {candidates.map((c) => (
              <li key={c}>
                <Link href={sessionUiPath(c)} className="font-mono text-[var(--accent-blue)] underline">
                  {c}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        {lookupFailed && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-[var(--border-primary)] px-3 py-1 text-sm hover:bg-[var(--bg-hover)]"
          >
            {i18nT("session.notFound.retry", undefined, "Retry")}
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate("/")}
          className="rounded border border-[var(--border-primary)] px-3 py-1 text-sm hover:bg-[var(--bg-hover)]"
        >
          {i18nT("session.notFound.back", undefined, "Back to sessions")}
        </button>
      </div>
    </div>
  );
}

/** Neutral placeholder while the route id is still resolving (never the landing page, never not-found). */
export function SessionResolving() {
  return (
    <div
      data-testid="session-resolving"
      className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--text-tertiary)]"
    >
      {i18nT("session.resolving", undefined, "Loading session…")}
    </div>
  );
}
