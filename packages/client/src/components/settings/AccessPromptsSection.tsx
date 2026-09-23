/**
 * Settings → Access prompt surfaces (change: add-access-grant-dialog, tasks
 * 8.1-8.3; mockups S3/S4/S5).
 *
 * - S4 banners: why no dialog would be raised (`prompting.blockers`), plus
 *   "this browser will not receive prompts" when it holds no capability.
 *   Degradation is announced, never silent.
 * - S5 toggle: `accessGrants.promptEnabled` via `PUT /api/config` (instant
 *   apply). Rendered INERT (disabled, with the reason) - never hidden - when
 *   report mode or the kill switch blocks prompting; the kill switch reads off.
 * - S3: pending requests, each answerable here (the prompt-free path; works
 *   with prompting disabled), and recent verdicts - operator answers vs YOLO
 *   auto-answers, the store an allow-always wrote, and `widenedFrom`.
 * - Remembered refusals, each clearable.
 *
 * Rendered as a sibling of `AccessSection` (not inside it): that section's
 * contract pins "revoke controls only" for arbitrary stored grants, whereas
 * every answer here settles an actual recorded denial.
 *
 * Refreshes on mount, whenever the prompt queue changes (a `grant_request` /
 * `grant_dismiss` frame bumps `store.getVersion()`), and on a slow poll so
 * unprompted denials (no frame is sent for them) still appear.
 */
import type {
  AccessPlaneId,
  GrantVerdict,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import {
  answerPendingPrompt,
  clearRefusal,
  fetchAccessPrompts,
  setPromptEnabled,
} from "../../lib/access-grants/access-prompts-api.js";
import type {
  AccessPromptsView,
  PendingPromptView,
  PromptingBlocker,
  RefusalView,
  VerdictView,
} from "../../lib/access-grants/access-prompts-types.js";
import { useHasGrantChannel } from "../../lib/access-grants/grant-channel.js";
import { type GrantPromptStore, grantPromptStore } from "../../lib/access-grants/grant-prompt-store.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/** Background refresh while the page is open (unprompted denials send no frame). */
const POLL_MS = 10_000;

const PLANE_EN: Record<AccessPlaneId, string> = {
  filesystem: "filesystem",
  cwd: "working directory",
  network: "network",
  cors: "CORS origin",
};

const OUTCOME_EN: Record<VerdictView["outcome"], string> = {
  "allow-once": "Allowed once",
  "allow-always": "Allowed always",
  deny: "Denied",
  expired: "Expired — nothing written",
  aborted: "Aborted — nothing written",
  failed: "Failed — nothing written",
  "auto-allowed": "Auto-allowed by YOLO",
  "refused-by-prior-refusal": "Refused by a remembered refusal",
};

const planeLabel = (plane: AccessPlaneId) => i18nT(`grantPrompt.plane.${plane}`, undefined, PLANE_EN[plane]);
const when = (at: number) => new Date(at).toLocaleString();

const CARD = "border border-[var(--border-primary)] rounded bg-[var(--bg-secondary)]";
const ROW = "flex items-start gap-3 px-3 py-2";
const SUBJECT = "font-mono text-sm break-all text-[var(--text-primary)]";
const META = "text-xs text-[var(--text-tertiary)] mt-0.5";
const BTN =
  "shrink-0 px-2 py-1 rounded text-xs border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 cursor-pointer";
const WARN_BANNER =
  "px-3 py-2 rounded text-xs border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]";

export function AccessPromptsSection({ store = grantPromptStore }: { store?: GrantPromptStore }) {
  const version = useSyncExternalStore(store.subscribe, store.getVersion);
  const hasChannel = useHasGrantChannel();
  const [, navigate] = useLocation();
  const [view, setView] = useState<AccessPromptsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchAccessPrompts();
      if (res.ok && res.data) {
        setView(res.data);
        setError(null);
      } else {
        setError(res.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the refetch trigger
  useEffect(() => {
    void load();
  }, [load, version]);

  useEffect(() => {
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  /** Run one mutation, surface its failure, then refetch. */
  const mutate = useCallback(
    async (key: string, action: () => Promise<{ ok: boolean; status: number; error?: string }>) => {
      setBusy(key);
      try {
        const res = await action();
        if (!res.ok) setError(res.error ?? `HTTP ${res.status}`);
        await load();
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const answer = (p: PendingPromptView, verdict: GrantVerdict) =>
    void mutate(p.promptId, () => answerPendingPrompt(p.promptId, { plane: p.plane, subject: p.subject, verdict }));

  const blockers: PromptingBlocker[] = view?.prompting.blockers ?? [];

  return (
    <section data-testid="access-prompts-section" className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {i18nT("accessPrompts.title", undefined, "Access prompts")}
        </h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          {i18nT(
            "accessPrompts.description",
            undefined,
            "Denied requests waiting for a verdict, and the verdicts given. Every pending request can be answered here, with or without prompting.",
          )}
        </p>
      </div>

      {error && (
        <div data-testid="access-prompts-error" role="alert" className="text-sm text-[var(--severity-error-fg)]">
          {i18nT("accessPrompts.failed", { error }, "Access prompts request failed: {error}")}
        </div>
      )}

      <PromptingBanners
        blockers={blockers}
        hasChannel={hasChannel}
        onOpenHostGate={() => navigate("/settings/security")}
      />

      {view && (
        <PromptToggle
          prompting={view.prompting}
          busy={busy === "toggle"}
          onToggle={() => void mutate("toggle", () => setPromptEnabled(!view.prompting.enabled))}
        />
      )}

      {view && (
        <PendingList pending={view.pending} busy={busy} onAnswer={answer} />
      )}

      {view && <VerdictList verdicts={view.verdicts} />}

      {view && (
        <RefusalList
          refusals={view.refusals}
          busy={busy}
          onClear={(r) => void mutate(`refusal:${r.plane}:${r.subject}`, () => clearRefusal(r.plane, r.subject))}
        />
      )}
    </section>
  );
}

function PendingList({
  pending,
  busy,
  onAnswer,
}: {
  pending: PendingPromptView[];
  busy: string | null;
  onAnswer(p: PendingPromptView, verdict: GrantVerdict): void;
}) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text-tertiary)] mb-1">
        {i18nT("accessPrompts.pending", { count: pending.length }, "Pending requests ({count})")}
      </h3>
      <div className={`${CARD} divide-y divide-[var(--border-primary)]`}>
        {pending.length === 0 && (
          <p data-testid="access-pending-empty" className="px-3 py-2 text-xs text-[var(--text-tertiary)]">
            {i18nT("accessPrompts.pendingEmpty", undefined, "No request is waiting for a verdict.")}
          </p>
        )}
        {pending.map((p) => {
          const held = p.copy.mode === "held";
          return (
            <div key={p.promptId} data-testid="access-pending-row" className={ROW}>
              <div className="min-w-0 flex-1">
                <div className={SUBJECT}>{p.subject}</div>
                <div className={META}>
                  {planeLabel(p.plane)} ·{" "}
                  {held
                    ? i18nT("accessPrompts.modeHeld", undefined, "request waiting")
                    : i18nT("accessPrompts.modeDeferred", undefined, "applies to the next attempt")}{" "}
                  · {i18nT("accessPrompts.store", { store: p.copy.store }, "Allow always writes {store}")}
                  {!p.prompted && (
                    <>
                      {" · "}
                      {i18nT(
                        "accessPrompts.notPrompted",
                        { reason: p.suppressedBy ?? "-" },
                        "not prompted ({reason})",
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  type="button"
                  data-testid="access-pending-deny"
                  disabled={busy === p.promptId}
                  onClick={() => onAnswer(p, "deny")}
                  className={BTN}
                >
                  {i18nT("grantPrompt.deny", undefined, "Deny")}
                </button>
                {held && (
                  <button
                    type="button"
                    data-testid="access-pending-allow-once"
                    disabled={busy === p.promptId}
                    onClick={() => onAnswer(p, "allow-once")}
                    className={BTN}
                  >
                    {i18nT("grantPrompt.allowOnce", undefined, "Allow once")}
                  </button>
                )}
                <button
                  type="button"
                  data-testid="access-pending-allow-always"
                  disabled={busy === p.promptId}
                  onClick={() => onAnswer(p, "allow-always")}
                  className={BTN}
                >
                  {i18nT("grantPrompt.allowAlways", undefined, "Allow always")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VerdictList({ verdicts }: { verdicts: VerdictView[] }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text-tertiary)] mb-1">
        {i18nT("accessPrompts.verdicts", undefined, "Recent verdicts")}
      </h3>
      <div className={`${CARD} divide-y divide-[var(--border-primary)]`}>
        {verdicts.length === 0 && (
          <p data-testid="access-verdicts-empty" className="px-3 py-2 text-xs text-[var(--text-tertiary)]">
            {i18nT("accessPrompts.verdictsEmpty", undefined, "No verdicts yet.")}
          </p>
        )}
        {verdicts.map((v) => (
          <div
            key={`${v.answeredBy}\u0000${v.at}\u0000${v.plane}\u0000${v.subject}`}
            data-testid="access-verdict-row"
            data-answered-by={v.answeredBy}
            className={ROW}
          >
            <div className="min-w-0 flex-1">
              <div className={SUBJECT}>{v.subject}</div>
              <div className={META}>
                {i18nT(`accessPrompts.outcome.${v.outcome}`, undefined, OUTCOME_EN[v.outcome])} ·{" "}
                {planeLabel(v.plane)} · {when(v.at)}
                {v.answeredBy === "yolo" ? (
                  <>
                    {" · "}
                    {i18nT("accessPrompts.noHuman", undefined, "no human answered")}
                  </>
                ) : (
                  <>
                    {v.store && (
                      <>
                        {" · "}
                        {i18nT("accessPrompts.wrote", { store: v.store }, "wrote {store}")}
                      </>
                    )}
                    {v.widenedFrom && (
                      <>
                        {" · "}
                        {i18nT("accessPrompts.widenedFrom", { subject: v.widenedFrom }, "widened from {subject}")}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PromptingBanners({
  blockers,
  hasChannel,
  onOpenHostGate,
}: {
  blockers: PromptingBlocker[];
  hasChannel: boolean;
  onOpenHostGate(): void;
}) {
  return (
    <div className="space-y-2">
      {blockers.includes("report-mode") && (
        <div data-testid="access-prompts-banner-report-mode" role="status" className={WARN_BANNER}>
          <b>
            {i18nT(
              "accessPrompts.banner.reportMode",
              { mode: "report" },
              "Held prompts unavailable — host-gate mode is {mode}",
            )}
          </b>
          <p className="mt-0.5">
            {i18nT(
              "accessPrompts.banner.reportModeBody",
              undefined,
              "No dialog will be raised on any plane. Recorded denials remain listed and answerable below.",
            )}{" "}
            <a
              href="/settings/security"
              className="underline"
              onClick={(e) => {
                e.preventDefault();
                onOpenHostGate();
              }}
            >
              {i18nT("accessPrompts.banner.reportModeLink", undefined, "Host-gate setting")}
            </a>
          </p>
        </div>
      )}
      {blockers.includes("kill-switch") && (
        <div data-testid="access-prompts-banner-kill-switch" role="status" className={WARN_BANNER}>
          <b>
            {i18nT(
              "accessPrompts.banner.killSwitch",
              { env: "PI_DASHBOARD_DISABLE_GRANT_PROMPT" },
              "Prompting force-disabled by {env}",
            )}
          </b>
          <p className="mt-0.5">
            {i18nT(
              "accessPrompts.banner.killSwitchBody",
              undefined,
              "The environment variable overrides the setting. Recorded denials remain listed and answerable below.",
            )}
          </p>
        </div>
      )}
      {blockers.includes("disabled") && (
        <div data-testid="access-prompts-banner-disabled" role="status" className={WARN_BANNER}>
          {i18nT(
            "accessPrompts.banner.disabled",
            undefined,
            "Prompting is off — no dialog will be raised. Recorded denials remain listed and answerable below.",
          )}
        </div>
      )}
      {!hasChannel && (
        <div data-testid="access-prompts-banner-no-channel" role="status" className={WARN_BANNER}>
          {i18nT(
            "accessPrompts.banner.noChannel",
            undefined,
            "This browser will not receive prompts — the server issued it no prompt capability (only a same-origin dashboard browser connection gets one).",
          )}
        </div>
      )}
    </div>
  );
}

function PromptToggle({
  prompting,
  busy,
  onToggle,
}: {
  prompting: AccessPromptsView["prompting"];
  busy: boolean;
  onToggle(): void;
}) {
  const blockers = prompting.blockers;
  // Inert, never hidden, while report mode or the kill switch blocks prompting.
  const inert = blockers.includes("report-mode") || blockers.includes("kill-switch");
  const toggleOn = prompting.enabled && !prompting.killSwitch;
  return (
    <div className={`${CARD} ${ROW} items-center`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-[var(--text-primary)]">
          {i18nT("accessPrompts.toggle", undefined, "Ask me when access is denied")}
        </div>
        <div data-testid="access-prompts-toggle-reason" className={META}>
          {blockers.includes("kill-switch")
            ? i18nT(
                "accessPrompts.toggleKillSwitch",
                { env: "PI_DASHBOARD_DISABLE_GRANT_PROMPT" },
                "Not available: {env} is set.",
              )
            : blockers.includes("report-mode")
              ? i18nT(
                  "accessPrompts.toggleReportMode",
                  { mode: "report" },
                  "Not available: host-gate mode is {mode}.",
                )
              : i18nT(
                  "accessPrompts.toggleHint",
                  undefined,
                  "Off by default. Existing grants stay in force when off; denials are still recorded.",
                )}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        data-testid="access-prompts-toggle"
        aria-checked={toggleOn}
        aria-label={i18nT("accessPrompts.toggle", undefined, "Ask me when access is denied")}
        disabled={inert || busy}
        onClick={onToggle}
        className={`shrink-0 w-9 h-5 rounded-full border border-[var(--border-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${toggleOn ? "bg-[var(--accent-primary)]" : "bg-[var(--bg-surface)]"}`}
      >
        <span
          className={`block w-3.5 h-3.5 rounded-full bg-[var(--text-primary)] transition-transform ${toggleOn ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );
}

function RefusalList({
  refusals,
  busy,
  onClear,
}: {
  refusals: RefusalView[];
  busy: string | null;
  onClear(r: RefusalView): void;
}) {
  if (refusals.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text-tertiary)] mb-1">
        {i18nT("accessPrompts.refusals", undefined, "Remembered refusals")}
      </h3>
      <div className={`${CARD} divide-y divide-[var(--border-primary)]`}>
        {refusals.map((r) => (
          <div key={`${r.plane}\u0000${r.subject}`} data-testid="access-refusal-row" className={ROW}>
            <div className="min-w-0 flex-1">
              <div className={SUBJECT}>{r.subject}</div>
              <div className={META}>
                {planeLabel(r.plane)} · {when(r.refusedAt)}
              </div>
            </div>
            <button
              type="button"
              data-testid="access-refusal-clear"
              disabled={busy === `refusal:${r.plane}:${r.subject}`}
              onClick={() => onClear(r)}
              className={BTN}
            >
              {i18nT("accessPrompts.clearRefusal", undefined, "Clear")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
