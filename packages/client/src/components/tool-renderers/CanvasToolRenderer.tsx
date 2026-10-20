/**
 * Renders the `canvas` declare-tool (change: improve-canvas-html-and-url-ux, D8).
 *
 * Shows the declared title, a kind icon and the target (file path, URL, or
 * `:port`) instead of the `{"ok":true}` acknowledgement; an `{ok:false,error}`
 * acknowledgement renders as an error line. ONLY the card for the `canvas` call
 * that owns the session's current canvas target (`context.canvas.sourceCallId`)
 * or server chip (`chipDeclarationId`) is a link; every other card, including an
 * earlier declare of the same target, is plain text.
 *
 * The click is an operator open: a file → foreground open; a server or loopback
 * URL → exactly the confirm-chip tap (probe 127.0.0.1, then a restricted preset
 * at the declared path). Nothing is fetched until that click.
 */
import { isLoopbackUrl } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiAlertCircleOutline, mdiFileDocumentOutline, mdiHelpCircleOutline, mdiHistory, mdiOpenInNew, mdiServerNetwork, mdiWeb } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { useOpenCanvasTarget } from "../canvas/useOpenCanvasTarget.js";
import { useOptionalSplitWorkspace } from "../split/SplitWorkspaceContext.js";
import type { ToolContext, ToolRendererProps } from "./types.js";

type Declared =
  | { kind: "file"; path: string }
  | { kind: "url"; url: string }
  | { kind: "server"; port: number };

function declaredOf(args: Record<string, unknown> | undefined): Declared | null {
  const t = args?.target as Record<string, unknown> | undefined;
  if (!t || typeof t !== "object") return null;
  if (t.kind === "file" && typeof t.path === "string") return { kind: "file", path: t.path };
  if (t.kind === "url" && typeof t.url === "string") return { kind: "url", url: t.url };
  if (t.kind === "server" && typeof t.port === "number") return { kind: "server", port: t.port };
  return null;
}

/** The acknowledgement error, from `{ok:false,error}` JSON or a plain error result. */
function errorOf(status: ToolRendererProps["status"], result: string | undefined): string | null {
  if (!result) return null;
  try {
    const body = JSON.parse(result) as { ok?: unknown; error?: unknown };
    if (body && body.ok === false) return typeof body.error === "string" && body.error ? body.error : "canvas declare rejected";
    if (body && body.ok === true) return null;
  } catch {
    // not JSON → fall through
  }
  return status === "error" ? result : null;
}

function loopbackParts(url: string): { port: number; path: string } | null {
  try {
    const u = new URL(url);
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    return { port, path: `${u.pathname}${u.search}${u.hash}` };
  } catch {
    return null;
  }
}

const KIND_ICON = { file: mdiFileDocumentOutline, url: mdiWeb, server: mdiServerNetwork } as const;

const PILL =
  "inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--severity-neutral-border)] bg-[var(--severity-neutral-bg)] px-2 py-0.5 text-xs text-[var(--severity-neutral-fg)]";
const BTN =
  "inline-flex shrink-0 items-center gap-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50";

/** What a declared target shows: its text and whether activating it is the confirm-chip flow. */
function describe(declared: Declared): { display: string; serverLike: boolean } {
  if (declared.kind === "file") return { display: declared.path, serverLike: false };
  if (declared.kind === "server") return { display: `:${declared.port}`, serverLike: true };
  return { display: declared.url, serverLike: isLoopbackUrl(declared.url) };
}

type Activation =
  | { kind: "server"; port: number; path?: string }
  | { kind: "open"; target: ViewTarget }
  | { kind: "none" };

/** What activating an active card does: confirm-chip flow for a server / loopback URL, else an operator open. */
function activationOf(declared: Declared, serverLike: boolean, cwd: string | undefined): Activation {
  if (declared.kind === "server") return { kind: "server", port: declared.port };
  if (declared.kind === "url") {
    if (!serverLike) return { kind: "open", target: { kind: "url", url: declared.url } };
    const parts = loopbackParts(declared.url);
    return parts ? { kind: "server", port: parts.port, path: parts.path } : { kind: "none" };
  }
  return cwd ? { kind: "open", target: { kind: "file", cwd, path: declared.path } } : { kind: "none" };
}

/** Mounted only for an ACTIVE card under a split-workspace provider (the hook needs it). */
function ActiveTarget({ declared, cwd }: { declared: Declared; cwd: string | undefined }) {
  const { t } = useI18n();
  const { open, openServer, serverStatus } = useOpenCanvasTarget();
  const busy = serverStatus === "probing";
  const { display, serverLike } = describe(declared);

  const activate = () => {
    if (busy) return;
    const action = activationOf(declared, serverLike, cwd);
    if (action.kind === "server") void openServer(action.port, action.path);
    else if (action.kind === "open") open(action.target, { opener: "operator", background: false });
  };

  const status =
    serverStatus === "not-running"
      ? t("canvas.serverNotRunning", undefined, "Server not running")
      : serverStatus === "not-responding"
        ? t("canvas.serverNotResponding", undefined, "Server not responding")
        : null;

  return (
    <>
      <button
        type="button"
        data-testid="canvas-tool-target"
        aria-label={serverLike ? t("canvas.tool.openServerAria", { target: display }, "Open {target} in canvas") : undefined}
        onClick={activate}
        className="text-code min-w-0 truncate bg-transparent p-0 font-mono text-[var(--link)] underline-offset-2 hover:underline"
      >
        {display}
      </button>
      <button type="button" data-testid={serverLike ? "canvas-tool-confirm" : "canvas-tool-open"} disabled={busy} onClick={activate} className={BTN}>
        <Icon path={serverLike ? mdiServerNetwork : mdiOpenInNew} size={0.55} />
        {serverLike ? t("canvas.tool.confirmAndOpen", undefined, "Confirm and open") : t("canvas.tool.openInCanvas", undefined, "Open in canvas")}
      </button>
      {status && (
        <span role="status" data-testid="canvas-tool-status" className="text-xs text-[var(--severity-error-fg)]">
          {status}
        </span>
      )}
    </>
  );
}

function kindLabel(t: ReturnType<typeof useI18n>["t"], kind: Declared["kind"]): string {
  if (kind === "file") return t("canvas.tool.fileTarget", undefined, "File target");
  if (kind === "url") return t("canvas.tool.urlTarget", undefined, "URL target");
  return t("canvas.tool.serverTarget", undefined, "Server target");
}

/** Is `toolCallId` the call that owns the session's current canvas target or server chip? */
function isActiveCall(canvas: ToolContext["canvas"], toolCallId: string | undefined): boolean {
  return !!toolCallId && (toolCallId === canvas?.sourceCallId || toolCallId === canvas?.chipDeclarationId);
}

export function CanvasToolRenderer({ args, status, result, context, toolCallId }: ToolRendererProps) {
  const { t } = useI18n();
  const split = useOptionalSplitWorkspace();
  const declared = declaredOf(args);
  const title = typeof args?.title === "string" && args.title ? args.title : null;
  const error = errorOf(status, result);

  const canvas = context.canvas;
  const active = !error && isActiveCall(canvas, toolCallId);
  // "Superseded" only when the session HAS a canvas and this call lost it (after a
  // server restart the canvas is empty and every card is just plain).
  const superseded = !error && !active && declared != null && canvas?.key != null && status !== "running";
  const info = declared ? describe(declared) : null;
  // A loopback URL / server declare is only a pending confirm until its card or chip is tapped.
  const unconfirmed = active && info?.serverLike === true;

  return (
    <div data-testid="canvas-tool-card" data-active={active} className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {declared && (
          <span role="img" aria-label={kindLabel(t, declared.kind)} className="inline-flex shrink-0 text-[var(--text-tertiary)]">
            <Icon path={KIND_ICON[declared.kind]} size={0.7} />
          </span>
        )}
        {title && <span className="min-w-0 truncate font-medium text-[var(--text-primary)]">{title}</span>}
        {declared && active && split && <ActiveTarget declared={declared} cwd={context.cwd} />}
        {info && !(active && split) && (
          <span data-testid="canvas-tool-target" className="text-code min-w-0 truncate font-mono text-[var(--text-secondary)]">
            {info.display}
          </span>
        )}
        {unconfirmed && (
          <span className={PILL} data-testid="canvas-tool-unconfirmed" title={t("canvas.tool.notOpenedHint", undefined, "Nothing is fetched until you confirm")}>
            <Icon path={mdiHelpCircleOutline} size={0.55} />
            {t("canvas.tool.notOpened", undefined, "Not opened yet")}
          </span>
        )}
        {superseded && (
          <span className={PILL} data-testid="canvas-tool-superseded" title={t("canvas.tool.supersededHint", undefined, "A newer canvas declare replaced this one")}>
            <Icon path={mdiHistory} size={0.55} />
            {t("canvas.tool.superseded", undefined, "Superseded")}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" data-testid="canvas-tool-error" className="flex items-start gap-1 text-xs text-[var(--severity-error-fg)]">
          <Icon path={mdiAlertCircleOutline} size={0.6} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )}
    </div>
  );
}
