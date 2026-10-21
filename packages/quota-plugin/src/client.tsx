/**
 * Provider Quota — dashboard client entry.
 *
 * Two contributions:
 *  - `QuotaWidget` (composer-context-group): a `Quota` group in the chat
 *    composer's session-action strip, after GIT and before STATUS. One chip per
 *    enabled provider with EVERY window inline (`5h <bar> 14%  7d <bar> 32%`),
 *    pace colour on the fill and a `now` tick; a dashed `not live` tag when the
 *    server marks the provider `stale`. The session's model provider leads with
 *    an accent ring; a session provider with no adapter gets a `no quota` note.
 *    Click → shared Dialog primitive. It used to live in `content-inline-footer`
 *    (below the composer hints); the strip's session-conditional groups are the
 *    right home — the footer rationale (the composer's draft-conditional context
 *    slider) never applied to the strip.
 *  - `QuotaSettings` (settings-section): a non-blocking ToS WARNING (printed,
 *    not a gate) + master enable + per-provider toggles, committed through the
 *    host Settings panel's global Save via `useSettingsDraftSource`.
 *
 * Data comes only from `GET /api/quota` (server-computed, tokens never cross the
 * wire). Absent/empty → nothing renders (honest degradation, never an error).
 * See change: move-quota-to-context-strip.
 */
import {
  ComposerContextGroup,
  useT,
  useUiPrimitive,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computePace, formatResetIn, type Pace, type PaceSeverity, paceLabel } from "./pace.js";
import { providerLabel } from "./quota-status.js";
import type {
  ApiQuotaResponse,
  ProviderQuota,
} from "./types.js";

export { catalog } from "./i18n.js";

const SEVERITY_COLOR: Record<PaceSeverity, string> = {
  green: "#34d399",
  orange: "#fbbf24",
  red: "#f87171",
  muted: "#71717a",
};


/**
 * Localized pace-state formatter. `paceLabel` (pure, in pace.ts) supplies the
 * English fallback; the shell translator localizes it for zh-CN/hu.
 */
function usePaceText(): (pace: Pace) => string {
  const t = useT();
  return (pace: Pace) => {
    const fallback = paceLabel(pace);
    switch (pace.state) {
      case "unavailable":
        return t("unavailable", undefined, fallback);
      case "stale":
        return t("stale", undefined, fallback);
      case "ok":
        return pace.warn
          ? t("overBy", { pct: Math.round(pace.overage ?? 0) }, fallback)
          : t("onPace", undefined, fallback);
    }
  };
}

/**
 * The session's model provider = the prefix before the first `/`.
 * `undefined` when the model is missing or has no `/` (custom/aliased models).
 * Single place to extend if pi's provider ids ever drift.
 * See change: move-quota-to-context-strip (design D5).
 */
export function providerForModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const idx = model.indexOf("/");
  if (idx <= 0) return undefined;
  return model.slice(0, idx);
}

/** Model id = everything after the first `/` (the whole string when absent). */
function modelIdForModel(model: string | undefined): string {
  if (!model) return "";
  const idx = model.indexOf("/");
  return idx >= 0 ? model.slice(idx + 1) : model;
}

/** Shared quota fetch/refresh state. One owner (`QuotaWidget`) instantiates it. */
export interface QuotaState {
  providers: ProviderQuota[];
  /** Epoch ms of the most recently APPLIED snapshot, or null before the first. */
  lastUpdated: number | null;
  /** Force a fresh `GET /api/quota`. No-op while a request is already in flight. */
  refresh: () => void;
  isRefreshing: boolean;
}

/**
 * Poll `/api/quota` and expose an on-demand refresh (design D7). BOTH the poll
 * and the manual refresh carry a monotonically increasing sequence id; a
 * response is applied only when its id is the newest issued, so an out-of-order
 * race can never clobber a newer snapshot and `lastUpdated` never regresses. On
 * failure the prior snapshot is retained (honest degradation, no error UI).
 * `refresh` is a no-op while `isRefreshing` (disable-while-in-flight).
 */
export function useQuota(pollMs = 60_000): QuotaState {
  const [providers, setProviders] = useState<ProviderQuota[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const seqRef = useRef(0);
  const refreshingRef = useRef(false);
  const aliveRef = useRef(true);

  const apply = useCallback((seq: number, json: ApiQuotaResponse): void => {
    // Apply ONLY the newest issued request's response (D7). Comparing against the
    // last *issued* sequence — not the last *applied* one — means a superseded
    // response is dropped even when the newer request FAILED before this older
    // one resolved; the retained snapshot then survives (honest degradation).
    if (!aliveRef.current || seq !== seqRef.current) return;
    setProviders(Array.isArray(json.providers) ? json.providers : []);
    setLastUpdated(Date.now());
  }, []);

  const load = useCallback(
    async (manual: boolean): Promise<void> => {
      if (manual && refreshingRef.current) return; // single-flight: ignore while in flight
      if (manual) {
        refreshingRef.current = true;
        setIsRefreshing(true);
      }
      const seq = ++seqRef.current;
      try {
        const res = await fetch("/api/quota");
        apply(seq, (await res.json()) as ApiQuotaResponse);
      } catch {
        // Keep the prior snapshot — a failed refresh must not blank the widget.
      } finally {
        if (manual) {
          refreshingRef.current = false;
          if (aliveRef.current) setIsRefreshing(false);
        }
      }
    },
    [apply],
  );

  useEffect(() => {
    aliveRef.current = true;
    void load(false);
    const timer = setInterval(() => void load(false), pollMs);
    return () => {
      aliveRef.current = false;
      clearInterval(timer);
    };
  }, [load, pollMs]);

  const refresh = useCallback(() => void load(true), [load]);
  return { providers, lastUpdated, refresh, isRefreshing };
}


/**
 * Grey `now` caption sitting directly BENEATH the tick, horizontally centred on
 * it. Replaces the former legend row: the marker names itself in place instead
 * of being explained elsewhere. Offset is clamped to 6..94% so the centred
 * label never overflows the track at the extremes.
 */
/**
 * Time-until-reset caption. Renders NOTHING when `formatResetIn` yields null
 * (past/epoch-sentinel/unparseable reset), so a bogus upstream timestamp stays
 * invisible instead of claiming a decades-old reset.
 */
function ResetsIn({ resetsAt, now }: { resetsAt: string; now: number }) {
  const t = useT();
  const rel = formatResetIn(resetsAt, now);
  if (rel === null) return null;
  return (
    <span data-testid="quota-resets-in" style={{ whiteSpace: "nowrap" }}>
      {t("resetsIn", { t: rel }, `resets in ${rel}`)}
    </span>
  );
}

function NowCaption({ elapsedPercent }: { elapsedPercent: number }) {
  const t = useT();
  return (
    <div style={{ position: "relative", height: 12 }}>
      <span
        data-testid="quota-now-caption"
        style={{
          position: "absolute",
          top: 0,
          left: `${Math.min(94, Math.max(6, elapsedPercent))}%`,
          transform: "translateX(-50%)",
          fontSize: 9,
          lineHeight: "12px",
          whiteSpace: "nowrap",
          color: "var(--text-muted, #71717a)",
        }}
      >
        {t("now", undefined, "now")}
      </span>
    </div>
  );
}

/** Slim track with a fill (0..100) and a `now` tick. */
function MiniBar({ pace, usedPercent, height = 4 }: { pace: Pace; usedPercent: number; height?: number }) {
  const color = SEVERITY_COLOR[pace.severity];
  return (
    <div
      data-testid="quota-bar"
      style={{
        position: "relative",
        height,
        borderRadius: height,
        background: "var(--bg-tertiary, rgba(63,63,70,0.5))",
        overflow: "hidden",
      }}
    >
      <div
        data-severity={pace.severity}
        style={{
          position: "absolute",
          inset: 0,
          width: `${Math.min(100, Math.max(0, usedPercent))}%`,
          background: color,
          borderRadius: height,
        }}
      />
      {pace.elapsedPercent !== null && (
        <div
          data-testid="quota-now-tick"
          style={{
            position: "absolute",
            top: -1,
            bottom: -1,
            left: `${pace.elapsedPercent}%`,
            width: 1.5,
            background: "var(--text-primary, #e4e4e7)",
            opacity: 0.7,
          }}
        />
      )}
    </div>
  );
}

/**
 * composer-context-group: a `Quota` group with one chip per provider that has
 * at least one window. Every window renders inline (label · bar · %), the bar
 * fill is paced and a stale provider is tagged. The session's model provider
 * leads with an accent ring; a defined provider absent from `providers[]` gets
 * a non-interactive `no quota` note. Click opens the dialog. Renders nothing
 * when no provider has windows. See change: move-quota-to-context-strip.
 */
export function QuotaWidget({ session }: { session?: DashboardSession }) {
  const quota = useQuota();
  const { providers } = quota;
  const t = useT();
  const now = Date.now();
  const [dialogProvider, setDialogProvider] = useState<string | null>(null);

  // Only providers carrying at least one window produce a chip. Guard the shape
  // too: `/api/quota` is untrusted wire data, so a malformed entry ({}) must be
  // skipped rather than throw on `p.windows.length`.
  const rows = useMemo(
    () => providers.filter((p) => Array.isArray(p?.windows) && p.windows.length > 0),
    [providers],
  );

  if (rows.length === 0) return null;

  const model = session?.model;
  const sessionProvider = providerForModel(model);
  const matched =
    sessionProvider !== undefined ? rows.find((p) => p.provider === sessionProvider) : undefined;
  // Session provider first; the rest keep their payload order. Derived on every
  // render, so a model switch re-orders the chips without any user action.
  const ordered = matched ? [matched, ...rows.filter((p) => p.provider !== sessionProvider)] : rows;
  const showNote = sessionProvider !== undefined && matched === undefined;
  const modelId = modelIdForModel(model);

  return (
    <>
      <ComposerContextGroup label={t("quota", undefined, "Quota")} testId="quota-context-group">
        {showNote && (
          <span
            data-testid="quota-no-adapter-note"
            style={{
              fontSize: 11,
              color: "var(--text-secondary)",
              border: "1px dashed var(--border-subtle, rgba(82,82,91,0.6))",
              borderRadius: 4,
              padding: "0 4px",
              whiteSpace: "nowrap",
            }}
          >
            {t("noQuota", { modelId }, `${modelId} · no quota`)}
          </span>
        )}
        {ordered.map((p) => {
          const ringed = p.provider === sessionProvider;
          const dimmed = sessionProvider !== undefined && !ringed;
          const windowsText = p.windows
            .map((w) => `${w.label} ${Math.round(w.usedPercent)}%`)
            .join(", ");
          // The button's `aria-label` overrides its visible content, so an
          // explicit staleness suffix is required for AT to hear it.
          const chipAria = t(
            "chipAria",
            { provider: providerLabel(p.provider), windows: windowsText },
            `${providerLabel(p.provider)} quota, ${windowsText}`,
          );
          return (
            <button
              key={p.provider}
              type="button"
              data-testid={`quota-chip-${p.provider}`}
              data-session-provider={ringed ? "true" : undefined}
              data-dimmed={dimmed ? "true" : undefined}
              data-stale={p.stale === true ? "true" : undefined}
              title={windowsText}
              aria-label={
                p.stale === true ? `${chipAria}, ${t("retained", undefined, "not live")}` : chipAria
              }
              onClick={() => setDialogProvider(p.provider)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "transparent",
                // Borderless: the host `ToolbarGroup` (info variant) is the
                // container now. See change: redesign-composer-session-strip.
                border: 0,
                borderRadius: 4,
                padding: "0 6px",
                minHeight: 24,
                lineHeight: 1.4,
                fontSize: 12,
                cursor: "pointer",
                whiteSpace: "nowrap",
                color: ringed ? "var(--text-primary, #e4e4e7)" : "var(--text-secondary, #a1a1aa)",
                opacity: dimmed ? 0.5 : 1,
                boxShadow: ringed
                  ? "inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, var(--border-subtle, rgba(82,82,91,0.6)))"
                  : undefined,
              }}
            >
              <span style={{ fontWeight: 600 }}>{providerLabel(p.provider)}</span>
              {p.stale === true && (
                <span
                  data-testid={`quota-chip-stale-${p.provider}`}
                  style={{
                    color: "var(--text-muted, #71717a)",
                    border: "1px dashed var(--border-subtle, rgba(82,82,91,0.6))",
                    borderRadius: 3,
                    padding: "0 3px",
                  }}
                >
                  {t("retained", undefined, "not live")}
                </span>
              )}
              {p.windows.map((w, i) => {
                const pace = computePace(w, now);
                // A stale provider's retained figures are shown muted.
                const severity: PaceSeverity = p.stale === true ? "muted" : pace.severity;
                return (
                  <span
                    key={`${w.label}-${i}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
                  >
                    <span>{w.label}</span>
                    <span style={{ display: "inline-block", width: 40 }}>
                      <MiniBar pace={{ ...pace, severity }} usedPercent={w.usedPercent} height={3} />
                    </span>
                    <span>{Math.round(w.usedPercent)}%</span>
                  </span>
                );
              })}
            </button>
          );
        })}
      </ComposerContextGroup>
      {dialogProvider !== null && (
        <QuotaDialog quota={quota} initial={dialogProvider} onClose={() => setDialogProvider(null)} />
      )}
    </>
  );
}

/** Relative "last updated" caption text, or null before the first snapshot. */
function lastUpdatedText(lastUpdated: number | null | undefined, now: number, t: ReturnType<typeof useT>): string | null {
  if (lastUpdated == null) return null;
  const secs = Math.max(0, Math.round((now - lastUpdated) / 1000));
  if (secs < 5) return t("updatedJustNow", undefined, "updated just now");
  if (secs < 60) return t("updatedSecondsAgo", { s: secs }, `updated ${secs}s ago`);
  const mins = Math.round(secs / 60);
  return t("updatedMinutesAgo", { m: mins }, `updated ${mins}m ago`);
}

/** Detail dialog via the shared `ui:dialog` primitive; selector: All · per-provider. */
export function QuotaDialog({
  quota,
  initial,
  onClose,
}: {
  quota: QuotaState;
  initial: string;
  onClose: () => void;
}) {
  const { providers, lastUpdated, refresh, isRefreshing } = quota;
  const t = useT();
  const paceText = usePaceText();
  const Dialog = useUiPrimitive(UI_PRIMITIVE_KEYS.dialog);
  const [selected, setSelected] = useState<string>(initial);
  const now = Date.now();

  // A refresh can drop the selected provider from the snapshot; fall back to All
  // rather than render an empty detail view (design D7).
  useEffect(() => {
    if (selected !== "__all__" && !providers.some((p) => p.provider === selected)) {
      setSelected("__all__");
    }
  }, [providers, selected]);

  const shown = selected === "__all__" ? providers : providers.filter((p) => p.provider === selected);
  const updatedLabel = lastUpdatedText(lastUpdated, now, t);

  return (
    <Dialog open onClose={onClose} title={t("heading", undefined, "Provider Quota")} size="md" testId="quota-dialog">
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}
      >
        <span data-testid="quota-last-updated" style={{ fontSize: 10, color: "var(--text-muted, #71717a)" }}>
          {updatedLabel}
        </span>
        <button
          type="button"
          data-testid="quota-refresh"
          onClick={refresh}
          disabled={isRefreshing}
          style={{
            fontSize: 11,
            padding: "2px 10px",
            borderRadius: 999,
            border: "1px solid var(--border-subtle, rgba(82,82,91,0.6))",
            background: "transparent",
            color: "var(--text-secondary, #a1a1aa)",
            cursor: isRefreshing ? "default" : "pointer",
            opacity: isRefreshing ? 0.5 : 1,
          }}
        >
          {isRefreshing ? t("refreshing", undefined, "Refreshing…") : t("refresh", undefined, "Refresh")}
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        <SelectorPill label={t("all", undefined, "All")} active={selected === "__all__"} onClick={() => setSelected("__all__")} />
        {providers.map((p) => (
          <SelectorPill
            key={p.provider}
            label={providerLabel(p.provider)}
            active={selected === p.provider}
            onClick={() => setSelected(p.provider)}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {shown.map((p) => (
          <div
            key={p.provider}
            data-testid={`quota-card-${p.provider}`}
            style={{
              border: "1px solid var(--border-subtle, rgba(82,82,91,0.5))",
              borderRadius: 6,
              padding: 10,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text-primary, #e4e4e7)" }}>
              {providerLabel(p.provider)}
              {/* Retained snapshot: the latest refresh failed (e.g. HTTP 429) so
                  these are the last known figures, not live. Surfaced in the
                  dialog ONLY — the footer bar stays quiet by design.
                  See change: publish-quota-plugin. */}
              {p.stale === true && (
                <span
                  data-testid={`quota-stale-${p.provider}`}
                  title={t("retainedBody", undefined, "The latest refresh failed, so the last known values are shown.")}
                  style={{
                    marginLeft: 6,
                    fontSize: 10,
                    fontWeight: 400,
                    color: "var(--text-muted, #71717a)",
                  }}
                >
                  {t("retained", undefined, "not live")}
                </span>
              )}
            </div>
            {p.windows.map((w, i) => {
              const pace = computePace(w, now);
              return (
                <div key={`${w.label}-${i}`} style={{ marginBottom: 8, fontSize: 11 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ color: "var(--text-secondary, #a1a1aa)" }}>{w.label}</span>
                    <span style={{ color: SEVERITY_COLOR[pace.severity] }}>
                      {Math.round(w.usedPercent)}%
                      {pace.projected !== null && (
                        <span style={{ color: "var(--text-muted, #71717a)", marginLeft: 6 }}>
                          {t("projected", undefined, "proj.")} {Math.round(pace.projected)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <MiniBar pace={pace} usedPercent={w.usedPercent} height={6} />
                  {pace.elapsedPercent !== null && <NowCaption elapsedPercent={pace.elapsedPercent} />}
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-muted, #71717a)",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span>{paceText(pace)}</span>
                    <ResetsIn resetsAt={w.resetsAt} now={now} />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function SelectorPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 11,
        padding: "2px 10px",
        borderRadius: 999,
        border: "1px solid var(--border-subtle, rgba(82,82,91,0.6))",
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#fff" : "var(--text-secondary, #a1a1aa)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
