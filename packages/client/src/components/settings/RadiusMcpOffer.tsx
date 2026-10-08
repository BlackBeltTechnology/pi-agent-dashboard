/**
 * Post-sign-in "Configure Radius MCP" offer — the dashboard twin of pi 1.0.0's
 * `/login` follow-up. Rendered inline on the providers section (the Add-provider
 * dialog has already closed). Accept → `POST /api/provider-auth/radius/mcp`
 * (writes the Pi-global `mcp.json`, reloads sessions); decline → dismiss with no
 * request. A refusal renders translated beside the buttons and keeps the offer.
 *
 * Radius-specific on purpose; sign-in itself stays on the generic panes.
 * See change: add-radius-provider-login (D4).
 */
import { mdiConsoleNetwork } from "@mdi/js";
import { useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { InlineMessage } from "../primitives/InlineMessage.js";

export interface RadiusMcpOfferInfo {
  /** Entry name a configure writes (`radius`, `radius-mcp`, or the URL-matched entry). */
  name: string;
  /** Absolute global `mcp.json` path. */
  path: string;
}

/** `GET /api/provider-auth/radius/mcp` → an offer, or null when none should show. */
export async function fetchRadiusMcpOffer(): Promise<RadiusMcpOfferInfo | null> {
  const res = await fetch(`${getApiBase()}/api/provider-auth/radius/mcp`);
  if (!res.ok) return null;
  const body: unknown = await res.json().catch(() => null);
  const b = body as { configured?: unknown; name?: unknown; path?: unknown } | null;
  if (b?.configured !== false || typeof b.name !== "string" || typeof b.path !== "string") return null;
  return { name: b.name, path: b.path };
}

/** Translate a refusal body; unknown codes fall back to the server's `error` text. */
function radiusMcpErrorMessage(body: { code?: unknown; vars?: { reason?: unknown }; error?: unknown } | null): string {
  switch (body?.code) {
    case "provider_auth.radius_mcp_runtime_unavailable":
      return i18nT("err.provider_auth.radius_mcp_runtime_unavailable", undefined, "The pi runtime is not available, so Radius MCP cannot be configured.");
    case "provider_auth.radius_mcp_no_credential":
      return i18nT("err.provider_auth.radius_mcp_no_credential", undefined, "Sign in to Radius first.");
    case "provider_auth.radius_mcp_overridden":
      return i18nT("err.provider_auth.radius_mcp_overridden", undefined, "models.json configures a custom Radius gateway, so the default Radius MCP server does not apply.");
    case "provider_auth.radius_mcp_write_refused":
      return i18nT(
        "err.provider_auth.radius_mcp_write_refused",
        { reason: typeof body.vars?.reason === "string" ? body.vars.reason : "" },
        "mcp.json could not be updated ({reason}).",
      );
    default:
      return typeof body?.error === "string" && body.error
        ? body.error
        : i18nT("err.radiusMcpFailed", undefined, "Failed to configure Radius MCP.");
  }
}

export function RadiusMcpOffer({ info, onDone }: {
  info: RadiusMcpOfferInfo;
  /** Called on decline (no arg) or after a successful write (reloaded count). */
  onDone: (result?: { reloaded: number }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/provider-auth/radius/mcp`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        onDone({ reloaded: typeof body?.reloaded === "number" ? body.reloaded : 0 });
        return;
      }
      setError(radiusMcpErrorMessage(body));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : i18nT("err.radiusMcpFailed", undefined, "Failed to configure Radius MCP."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="radius-mcp-offer" role="group" aria-label={i18nT("providers.radiusMcpOfferTitle", undefined, "Configure Radius MCP?")}>
      <InlineMessage
        severity="info"
        icon={mdiConsoleNetwork}
        title={i18nT("providers.radiusMcpOfferTitle", undefined, "Configure Radius MCP?")}
        actions={
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void accept()}
              className="focus-ring px-2 py-1 text-[11px] rounded border border-current bg-transparent disabled:opacity-60"
            >
              {i18nT("providers.radiusMcpAccept", undefined, "Configure Radius MCP")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDone()}
              className="focus-ring px-2 py-1 text-[11px] rounded border border-current bg-transparent disabled:opacity-60"
            >
              {i18nT("providers.radiusMcpDecline", undefined, "Not now")}
            </button>
          </>
        }
      >
        {i18nT(
          "providers.radiusMcpOfferBody",
          { name: info.name, path: info.path },
          `Add the Radius MCP server "${info.name}" to ${info.path} so your sessions can use Radius tools. Running sessions reload afterwards.`,
        )}
        {error && (
          <div role="alert" data-testid="radius-mcp-error" className="mt-1">
            {error}
          </div>
        )}
      </InlineMessage>
    </div>
  );
}
