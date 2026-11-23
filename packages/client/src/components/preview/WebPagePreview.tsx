/**
 * Web page renderer for an http(s) URL target. The dashboard never frames a
 * remote page on its own: the frame-policy probe runs only after an operator
 * action, and only an `allowed` verdict (or an explicit "Try to embed" on
 * `undetermined`) creates the iframe.
 *
 * - `opener === "operator-click"` (set only by the split workspace on a click):
 *   runs the client pre-check, then `POST /api/web/frame-policy` with the target
 *   ORIGIN only.
 * - any other opener (agent canvas, `?url=` route, `/pi-view`, a restored tab):
 *   a card with "Check and embed" and no request.
 *
 * The frame has an opaque origin: `sandbox="allow-scripts allow-forms"` — no
 * same-origin, no popups, no top navigation — and sends no referrer. The shell
 * (DocumentBar / overlay header) carries the "Open in browser" escape and the
 * `EmbeddedFromLabel`; this renderer has no chrome of its own.
 *
 * See change: rich-chat-links (D11, D12; tasks 8.6–8.7).
 */
import { canonicalHttpsOrigin, isUngrantableEgressOrigin } from "@blackbelt-technology/pi-dashboard-shared/preview-egress.js";
import { mdiWeb } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import type { UrlOpener } from "../../lib/layout/editor-pane-state.js";
import { openExternalUrl } from "../../lib/nav/safe-navigation.js";

type FrameVerdict = "allowed" | "refused" | "undetermined" | "ineligible";
type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "verdict"; verdict: Exclude<FrameVerdict, "allowed"> }
  | { kind: "error" }
  | { kind: "framed" };

const VERDICTS: ReadonlySet<string> = new Set<FrameVerdict>(["allowed", "refused", "undetermined", "ineligible"]);

/** A literal IP host (bracketed v6, dotted-quad / numeric v4 forms). */
function isIpLiteral(host: string): boolean {
  return host.startsWith("[") || /^\d+(\.\d+){0,3}$/.test(host) || /^0x/i.test(host);
}

/**
 * Client eligibility pre-check: `https:`, default port, a public-looking DNS
 * name (not an IP literal, single-label, internal suffix, or IPv4-embedding
 * host). Returns the canonical origin to probe, or `null` when ineligible.
 * Mirrors the server's own refusal rules so no request is made for a target
 * the server would refuse.
 */
export function frameEligibleOrigin(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.port !== "") return null;
  const origin = canonicalHttpsOrigin(u.origin);
  if (!origin) return null;
  if (isIpLiteral(new URL(origin).hostname)) return null;
  return isUngrantableEgressOrigin(origin) ? null : origin;
}

function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return rawUrl;
  }
}

async function probeFramePolicy(origin: string, signal: AbortSignal): Promise<FrameVerdict | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/web/frame-policy`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin }),
      signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { verdict?: unknown } | null;
    const v = body?.verdict;
    return typeof v === "string" && VERDICTS.has(v) ? (v as FrameVerdict) : null;
  } catch {
    return null;
  }
}

/** Shell label: the page is embedded from the opened URL's host. */
export function EmbeddedFromLabel({ url }: { url: string }) {
  const { t } = useI18n();
  const host = hostOf(url);
  return (
    <span className="shrink-0 text-xs text-[var(--text-tertiary)]" data-testid="embedded-from">
      {t("preview.webpage.embeddedFrom", { host }, "embedded from {host}")}
    </span>
  );
}

interface Props {
  target: { kind: "url"; url: string };
  opener?: UrlOpener;
  /** Bumped by the split workspace on an operator re-click; re-runs the check. */
  reloadNonce?: number;
}

export function WebPagePreview({ target, opener, reloadNonce }: Props) {
  const { t } = useI18n();
  const { url } = target;
  const host = hostOf(url);
  const origin = frameEligibleOrigin(url);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const check = useCallback(() => {
    abortRef.current?.abort();
    if (!origin) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setPhase({ kind: "checking" });
    void probeFramePolicy(origin, ctl.signal).then((verdict) => {
      if (ctl.signal.aborted) return;
      if (verdict === null) setPhase({ kind: "error" });
      else if (verdict === "allowed") setPhase({ kind: "framed" });
      else setPhase({ kind: "verdict", verdict });
    });
  }, [origin]);

  // A different target, an opener change, or an operator re-click (reloadNonce)
  // resets to the card; only an operator-click opener runs the check by itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloadNonce` is a re-run trigger, not a value read here
  useEffect(() => {
    setPhase({ kind: "idle" });
    if (opener === "operator-click") check();
    return () => abortRef.current?.abort();
  }, [url, opener, reloadNonce, check]);

  if (phase.kind === "framed") {
    return (
      <iframe
        src={url}
        title={t("preview.webpage.frameTitle", { host }, "Embedded page from {host}")}
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        className="h-full min-h-[60vh] w-full border-0 bg-[var(--bg-primary)]"
        data-testid="webpage-frame"
      />
    );
  }

  const btn =
    "rounded border border-[var(--border-primary)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-blue-text)]";
  let message: string;
  let primary: { label: string; testId: string } | null = null;
  if (!origin) {
    message = t("preview.webpage.cannotEmbed", { host }, "{host} can't be embedded here.");
  } else if (phase.kind === "checking") {
    message = t("preview.webpage.checking", { host }, "Checking whether {host} allows embedding…");
  } else if (phase.kind === "error") {
    message = t("preview.webpage.checkFailed", { host }, "Couldn't check whether {host} allows embedding.");
  } else if (phase.kind === "verdict" && phase.verdict === "refused") {
    message = t("preview.webpage.refused", { host }, "{host} doesn't allow embedding.");
  } else if (phase.kind === "verdict" && phase.verdict === "ineligible") {
    message = t("preview.webpage.cannotEmbed", { host }, "{host} can't be embedded here.");
  } else if (phase.kind === "verdict") {
    message = t("preview.webpage.undetermined", { host }, "Couldn't tell whether {host} allows embedding.");
    primary = { label: t("preview.webpage.tryEmbed", undefined, "Try to embed"), testId: "webpage-try-embed" };
  } else {
    message = t("preview.webpage.idle", { host }, "{host} is checked before it is embedded. Nothing is sent until you choose.");
    primary = { label: t("preview.webpage.checkEmbed", undefined, "Check and embed"), testId: "webpage-check-embed" };
  }

  return (
    <div className="flex flex-col items-start gap-2 p-4 text-sm text-[var(--text-secondary)]" data-testid="webpage-card">
      <div className="flex items-center gap-2">
        <Icon path={mdiWeb} size={0.8} aria-hidden="true" />
        <span className="break-all font-mono text-xs">{url}</span>
      </div>
      <p role="status">{message}</p>
      <div className="flex gap-2">
        {primary && (
          <button
            type="button"
            className={btn}
            data-testid={primary.testId}
            onClick={phase.kind === "verdict" ? () => setPhase({ kind: "framed" }) : check}
          >
            {primary.label}
          </button>
        )}
        <button type="button" className={btn} data-testid="webpage-open-in-browser" onClick={() => openExternalUrl(url)}>
          {t("preview.webpage.openInBrowser", undefined, "Open in browser")}
        </button>
      </div>
    </div>
  );
}
