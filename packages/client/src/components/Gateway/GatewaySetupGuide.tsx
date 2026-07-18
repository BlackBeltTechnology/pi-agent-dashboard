/**
 * Gateway setup guide — per-provider steps (D3 taxonomy). Install stays
 * copy-paste; auth-token/activate run a whitelisted server recipe via
 * `POST /api/tunnel/enroll` (validated param, never a free-form command);
 * browser-auth/external are links only.
 *
 * See change: add-tunnel-providers.
 */
import { mdiCheck, mdiContentCopy, mdiOpenInNew } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { runEnrollStep } from "../../lib/gateway/gateway-api.js";
import type { GatewayProviderId } from "../../lib/gateway/gateway-providers.js";
import { GATEWAY_SETUP_STEPS, type SetupStep } from "../../lib/gateway/gateway-setup.js";
import { useI18n } from "../../lib/i18n/i18n.js";

function InstallStep({ step }: { step: SetupStep }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex-1">
      <div className="mb-1 text-[12.5px] text-[var(--text-primary)]">
        {step.title}
        <span className="ml-1.5 rounded border border-[var(--border)] px-1.5 py-px text-[9.5px] text-[var(--text-muted)]">
          {t("gateway.setup.copy", undefined, "copy")}
        </span>
      </div>
      {step.command && (
        <div className="flex items-center justify-between gap-2 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-[11.5px] text-[var(--text-secondary)]">
          <span>{step.command}</span>
          <button
            type="button"
            data-testid="gateway-setup-copy"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(step.command ?? "");
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              } catch {
                /* ignore */
              }
            }}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.55} />
          </button>
        </div>
      )}
    </div>
  );
}

function RunStep({
  provider,
  step,
}: {
  provider: GatewayProviderId;
  step: SetupStep;
}) {
  const { t } = useI18n();
  const [param, setParam] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const needsParam = Boolean(step.paramPlaceholder);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    setOk(false);
    // runEnrollStep never throws — it maps transport/HTTP failures to
    // { ok:false, error }. Reset `ok` above so a prior success does not linger
    // when the operator edits the param and retries.
    const res = await runEnrollStep(provider, step.enrollStep ?? step.kind, param);
    setBusy(false);
    if (res.ok) {
      setOk(true);
      setParam("");
    } else {
      setMsg(res.error);
    }
  };

  return (
    <div className="flex-1">
      <div className="mb-1 text-[12.5px] text-[var(--text-primary)]">
        {step.title}
        <span className="ml-1.5 rounded border border-[var(--border)] px-1.5 py-px text-[9.5px] text-[var(--text-muted)]">
          {t("gateway.setup.runsServerSide", undefined, "runs server-side")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {needsParam && (
          <input
            type="password"
            placeholder={step.paramPlaceholder}
            data-testid="gateway-setup-param"
            className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-[11.5px] text-[var(--text-primary)]"
            value={param}
            onChange={(e) => setParam(e.target.value)}
          />
        )}
        <button
          type="button"
          data-testid="gateway-setup-run"
          disabled={busy || (needsParam && param.trim().length === 0)}
          onClick={() => void run()}
          className="rounded border border-[var(--accent,#3b82f6)] bg-[var(--accent-soft,#1d3a63)] px-3 py-1 text-[11.5px] font-semibold text-[var(--text-primary)] disabled:opacity-50"
        >
          {busy
            ? t("gateway.setup.running", undefined, "Running…")
            : ok
              ? t("gateway.setup.done", undefined, "Done ✓")
              : step.kind === "activate"
                ? t("gateway.setup.connect", undefined, "Connect")
                : t("gateway.setup.authenticate", undefined, "Authenticate")}
        </button>
      </div>
      {msg && (
        <p className="mt-1 text-[11px] text-[var(--danger,#ef4444)]" data-testid="gateway-setup-error">
          {msg}
        </p>
      )}
    </div>
  );
}

function LinkStep({ step }: { step: SetupStep }) {
  const { t } = useI18n();
  return (
    <div className="flex-1">
      <div className="mb-0.5 text-[12.5px] text-[var(--text-muted)]">{step.title}</div>
      {step.href && (
        <a
          href={step.href}
          target={step.href.startsWith("http") ? "_blank" : undefined}
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11.5px] text-[var(--accent,#3b82f6)] hover:underline"
        >
          {step.kind === "external"
            ? t("gateway.setup.openAdminConsole", undefined, "Open admin console")
            : t("gateway.setup.signInBrowser", undefined, "Sign in via browser")}
          <Icon path={mdiOpenInNew} size={0.5} />
        </a>
      )}
    </div>
  );
}

export function GatewaySetupGuide({ provider }: { provider: GatewayProviderId }) {
  const { t } = useI18n();
  const steps = GATEWAY_SETUP_STEPS[provider];
  return (
    <div data-testid="gateway-setup-guide">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {t("gateway.setup.title", undefined, "Setup")}
      </p>
      <div className="flex flex-col">
        {steps.map((step, i) => (
          <div
            key={`${step.kind}:${step.title}`}
            className="flex gap-2.5 border-b border-[var(--border)] py-2.5 last:border-none"
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] text-[10.5px] font-bold text-[var(--text-muted)]">
              {i + 1}
            </span>
            {step.kind === "install" ? (
              <InstallStep step={step} />
            ) : step.kind === "auth-token" || step.kind === "activate" ? (
              <RunStep provider={provider} step={step} />
            ) : (
              <LinkStep step={step} />
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10.5px] text-[var(--text-muted)]">
        <b className="text-[var(--text-secondary)]">{t("gateway.setup.securityLabel", undefined, "Security:")}</b>{" "}
        {t(
          "gateway.setup.securityNote",
          undefined,
          "auth/activate run a fixed whitelisted recipe keyed by (provider, step) — never a free-form command. Install stays copy-paste (needs elevation).",
        )}
      </p>
    </div>
  );
}
