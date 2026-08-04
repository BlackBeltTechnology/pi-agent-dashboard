/**
 * Retry settings section — edits pi's OWN native retry policy via
 * GET/PUT /api/pi-retry. Covers all six fields:
 * `retry.{enabled,maxRetries,baseDelayMs}` and
 * `retry.provider.{timeoutMs,maxRetries,maxRetryDelayMs}`.
 *
 * GLOBAL editor only. pi has no persisted per-session retry policy
 * (`setAutoRetryEnabled` delegates to the global setter), so there is no
 * project-scoped or per-session variant. The dashboard keeps no parallel policy
 * and runs no retry loop: raising `maxRetries` is the whole "retry forever"
 * mechanism.
 *
 * Because pi reads its settings only at session construction, saving reloads
 * every connected session so the policy applies at once.
 *
 * Commits through the panel's UNIFIED Save (no private Save button): registers
 * as a draft source so one Save commits every dirty store, the nav rail shows a
 * per-page dirty dot, and the leave guard offers Save / Discard / Cancel. A
 * failing commit throws, so the host keeps this source dirty and names it in
 * the partial-failure message. See change: unify-settings-save-contract.
 *
 * See change: retry-forever-with-stop-control (spec `pi-retry-settings`).
 */
import { useSettingsDraftSource } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiAlert, mdiInformationOutline, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useState } from "react";
import {
  getPiRetryPolicy,
  PI_RETRY_DEFAULTS,
  type PiRetryPolicy,
  putPiRetryPolicy,
} from "../../lib/api/pi-retry-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/** Attempt count above which the tail exceeds a day at default base — warn (never cap). */
const LONG_TAIL_ATTEMPTS = 20;
/** How many leading delays to show in the schedule preview. */
const PREVIEW_STEPS = 6;

interface Props {
  /** Injectable for tests. Defaults to the REST helpers. */
  load?: () => Promise<PiRetryPolicy>;
  save?: (p: PiRetryPolicy) => Promise<{ policy: PiRetryPolicy; reloadedSessions: number }>;
}

/** Humanize a millisecond delay for the schedule preview. */
function human(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s % 1 === 0 ? s : s.toFixed(1)} s`;
  if (s < 3600) return `${(s / 60).toFixed(1)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} days`;
}

/** pi's schedule: delay_n = baseDelayMs · 2^(n-1); total across all attempts. */
function computeSchedule(maxRetries: number, baseDelayMs: number): { seq: string[]; totalMs: number } {
  const seq: string[] = [];
  let totalMs = 0;
  for (let i = 1; i <= maxRetries; i++) {
    const d = baseDelayMs * 2 ** (i - 1);
    totalMs += d;
    if (seq.length < PREVIEW_STEPS) seq.push(human(d));
  }
  if (maxRetries > PREVIEW_STEPS) seq.push(`… → ${human(baseDelayMs * 2 ** (maxRetries - 1))}`);
  return { seq, totalMs };
}

/** Non-negative integer from a form string; NaN when blank/invalid. */
function intOf(s: string): number {
  return s.trim() === "" ? Number.NaN : Number(s);
}

interface FormState {
  enabled: boolean;
  maxRetries: string;
  baseDelayMs: string;
  provTimeoutMs: string; // blank = omitted (SDK default)
  provMaxRetries: string;
  provMaxRetryDelayMs: string;
}

/** Validate the form. Returns the first blocking message, else null. */
function validate(f: FormState): string | null {
  const mr = intOf(f.maxRetries);
  const bd = intOf(f.baseDelayMs);
  const pmr = intOf(f.provMaxRetries);
  const pmd = intOf(f.provMaxRetryDelayMs);
  if (!Number.isInteger(mr) || mr < 0) {
    return i18nT("retry.errMaxRetries", undefined, "Max attempts must be a non-negative integer.");
  }
  if (!Number.isInteger(bd) || bd < 1) {
    return i18nT("retry.errBaseDelay", undefined, "Base delay must be a positive integer (ms).");
  }
  if (f.provTimeoutMs.trim() !== "") {
    const pt = intOf(f.provTimeoutMs);
    if (!Number.isInteger(pt) || pt < 1) {
      return i18nT("retry.errProvTimeout", undefined,
        "Provider timeout must be a positive integer (ms), or blank for the SDK default.");
    }
  }
  if (!Number.isInteger(pmr) || pmr < 0) {
    return i18nT("retry.errProvMaxRetries", undefined,
      "Provider retries must be a non-negative integer.");
  }
  if (!Number.isInteger(pmd) || pmd < 0) {
    return i18nT("retry.errProvMaxDelay", undefined,
      "Provider max delay must be a non-negative integer (ms). 0 disables the limit.");
  }
  return null;
}

function toPolicy(f: FormState): PiRetryPolicy {
  const timeoutMs = f.provTimeoutMs.trim() === "" ? undefined : Number(f.provTimeoutMs);
  return {
    enabled: f.enabled,
    maxRetries: Number(f.maxRetries),
    baseDelayMs: Number(f.baseDelayMs),
    provider: {
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      maxRetries: Number(f.provMaxRetries),
      maxRetryDelayMs: Number(f.provMaxRetryDelayMs),
    },
  };
}

/** A labelled numeric field row. */
function NumField({
  label, hint, testId, value, onChange, disabled, min, step, placeholder,
}: {
  label: string; hint: string; testId: string; value: string;
  onChange: (v: string) => void; disabled?: boolean; min?: number; step?: number; placeholder?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-40 text-[var(--text-primary)]">{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        placeholder={placeholder}
        data-testid={testId}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 disabled:opacity-40"
      />
      <span className="text-[var(--text-muted)]">{hint}</span>
    </label>
  );
}

/** The schedule preview + long-tail warning. */
function SchedulePreview({ maxRetries, schedule }: { maxRetries: number; schedule: { seq: string[]; totalMs: number } | null }) {
  if (!schedule) return null;
  const longTail = maxRetries > LONG_TAIL_ATTEMPTS;
  return (
    <>
      <div data-testid="retry-schedule-preview" className="rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 py-2 text-xs text-[var(--text-tertiary)]">
        <div>
          {i18nT("retry.previewTotal", undefined, "Total before the turn finally fails:")}{" "}
          <b className="text-[var(--text-primary)]" data-testid="retry-schedule-total">
            {maxRetries === 0 ? i18nT("retry.noRetries", undefined, "no retries") : human(schedule.totalMs)}
          </b>
        </div>
        {schedule.seq.length > 0 && (
          <div className="mt-1 font-mono text-[10.5px] text-[var(--text-muted)]">{schedule.seq.join(" → ")}</div>
        )}
      </div>
      {longTail && (
        <div data-testid="retry-longtail-warning" className="flex items-start gap-2 rounded border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] px-3 py-2 text-xs text-[var(--severity-warning-fg)]">
          <Icon path={mdiAlert} size={0.6} className="mt-0.5 shrink-0" />
          <span>
            {i18nT("retry.longTailWarning", { n: maxRetries, total: human(schedule.totalMs) },
              `${maxRetries} attempts can keep one turn alive for about ${human(schedule.totalMs)}. That is allowed — Stop ends it instantly — but the tail is long.`)}
          </span>
        </div>
      )}
    </>
  );
}

export function RetrySettingsSection({ load = getPiRetryPolicy, save = putPiRetryPolicy }: Props) {
  const [form, setForm] = useState<FormState>({
    enabled: PI_RETRY_DEFAULTS.enabled,
    maxRetries: String(PI_RETRY_DEFAULTS.maxRetries),
    baseDelayMs: String(PI_RETRY_DEFAULTS.baseDelayMs),
    provTimeoutMs: "",
    provMaxRetries: String(PI_RETRY_DEFAULTS.provider.maxRetries),
    provMaxRetryDelayMs: String(PI_RETRY_DEFAULTS.provider.maxRetryDelayMs),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Loaded policy as a form snapshot — the dirty baseline for the unified Save.
  // Null until the first load resolves, so a pending read never reads as dirty.
  const [originalForm, setOriginalForm] = useState<FormState | null>(null);

  const patch = useCallback((p: Partial<FormState>) => setForm((f) => ({ ...f, ...p })), []);

  useEffect(() => {
    let alive = true;
    load()
      .then((p) => {
        if (!alive) return;
        const loaded: FormState = {
          enabled: p.enabled,
          maxRetries: String(p.maxRetries),
          baseDelayMs: String(p.baseDelayMs),
          provTimeoutMs: p.provider.timeoutMs === undefined ? "" : String(p.provider.timeoutMs),
          provMaxRetries: String(p.provider.maxRetries),
          provMaxRetryDelayMs: String(p.provider.maxRetryDelayMs),
        };
        setForm(loaded);
        setOriginalForm(loaded);
      })
      .catch(() => { /* keep defaults on read failure */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [load]);

  const validationError = validate(form);
  const mr = intOf(form.maxRetries);
  const bd = intOf(form.baseDelayMs);
  const schedule = validationError ? null : computeSchedule(mr, bd);

  // Dirty vs the loaded policy — string compare so an invalid in-progress edit
  // still counts as dirty (toPolicy would yield NaN and hide it).
  const isDirty = originalForm !== null && JSON.stringify(form) !== JSON.stringify(originalForm);

  // Unified-Save commit. THROWS on invalid input so `Promise.allSettled` in the
  // host marks this source failed, keeps it dirty, and lists it in
  // `settings.savePartialFail` instead of reporting a false success.
  const commit = useCallback(async () => {
    const v = validate(form);
    if (v) { setError(v); setStatus(null); throw new Error(v); }
    setError(null);
    setStatus(null);
    try {
      const res = await save(toPolicy(form));
      setOriginalForm(form);
      setStatus(
        i18nT("retry.saved", { n: res.reloadedSessions },
          `Saved. Reloaded ${res.reloadedSessions} connected session(s).`),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, [form, save]);

  // Discard → restore the loaded policy.
  const reset = useCallback(() => {
    setForm((f) => originalForm ?? f);
    setError(null);
    setStatus(null);
  }, [originalForm]);

  // page: "sessions" — must match the tab this section renders on, or the dirty
  // dot lands on the wrong nav item. Retry lives under Sessions because its
  // observable effect is on a session (waiting / attempt n / countdown / Stop).
  useSettingsDraftSource({ id: "pi-retry", page: "sessions", isDirty, commit, reset });

  return (
    <section data-testid="retry-settings-section" className="space-y-3">
      {/* No local <h3>: the enclosing <Section title> already names this block —
          a second heading rendered "Retry" above "Provider retry". */}
      <p className="text-xs text-[var(--text-tertiary)]">
        {i18nT("retry.subtitle", undefined,
          "How hard pi retries a failing provider before giving up on a turn. These are pi's own settings.")}
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
          <Icon path={mdiLoading} size={0.6} className="animate-spin" />
          {i18nT("common.loading", undefined, "Loading…")}
        </div>
      ) : (
        <>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              data-testid="retry-enabled-toggle"
              checked={form.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            <span className="text-[var(--text-primary)]">
              {i18nT("retry.enabled", undefined, "Enabled")}
            </span>
            <span className="text-[var(--text-muted)]">
              {i18nT("retry.enabledHint", undefined, "pi retries transient provider failures")}
            </span>
          </label>

          <NumField
            label={i18nT("retry.maxAttempts", undefined, "Max attempts")}
            hint={i18nT("retry.maxAttemptsHint", undefined, "pi default: 3 · no cap")}
            testId="retry-maxretries-input"
            value={form.maxRetries}
            onChange={(v) => patch({ maxRetries: v })}
            disabled={!form.enabled}
            min={0}
            step={1}
          />
          <NumField
            label={i18nT("retry.baseDelay", undefined, "Base delay (ms)")}
            hint={i18nT("retry.baseDelayHint", undefined, "doubles each attempt, uncapped")}
            testId="retry-basedelay-input"
            value={form.baseDelayMs}
            onChange={(v) => patch({ baseDelayMs: v })}
            disabled={!form.enabled}
            min={1}
            step={100}
          />

          <SchedulePreview maxRetries={mr} schedule={schedule} />

          {/* ── retry.provider.* ─────────────────────────────────────────── */}
          <div data-testid="retry-provider-group" className="mt-1 space-y-2 border-t border-[var(--border-primary)] pt-3">
            <div className="text-xs font-semibold text-[var(--text-primary)]">
              {i18nT("retry.providerTitle", undefined, "Provider / SDK request controls")}
            </div>
            <NumField
              label={i18nT("retry.provTimeout", undefined, "Request timeout (ms)")}
              hint={i18nT("retry.provTimeoutHint", undefined, "blank = SDK default")}
              testId="retry-provider-timeout-input"
              value={form.provTimeoutMs}
              onChange={(v) => patch({ provTimeoutMs: v })}
              min={1}
              step={1000}
              placeholder={i18nT("retry.sdkDefault", undefined, "SDK default")}
            />
            <NumField
              label={i18nT("retry.provMaxRetries", undefined, "Provider retries")}
              hint={i18nT("retry.provMaxRetriesHint", undefined, "pi default: 0")}
              testId="retry-provider-maxretries-input"
              value={form.provMaxRetries}
              onChange={(v) => patch({ provMaxRetries: v })}
              min={0}
              step={1}
            />
            <NumField
              label={i18nT("retry.provMaxDelay", undefined, "Max server delay (ms)")}
              hint={i18nT("retry.provMaxDelayHint", undefined, "pi default: 60000 · 0 disables the limit")}
              testId="retry-provider-maxdelay-input"
              value={form.provMaxRetryDelayMs}
              onChange={(v) => patch({ provMaxRetryDelayMs: v })}
              min={0}
              step={1000}
            />
            <div data-testid="retry-provider-note" className="flex items-start gap-2 rounded border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] px-3 py-2 text-xs text-[var(--severity-warning-fg)]">
              <Icon path={mdiAlert} size={0.6} className="mt-0.5 shrink-0" />
              <span>
                {i18nT("retry.providerInvisibleWait", undefined,
                  "A wait taken inside the provider layer emits no event: the session renders as ordinary streaming, with no attempt count and no countdown.")}
              </span>
            </div>
          </div>

          {(validationError || error) && (
            <div data-testid="retry-error" className="text-xs text-[var(--severity-error-fg)]">
              {validationError ?? error}
            </div>
          )}

          <div data-testid="retry-scope-note" className="flex items-start gap-2 rounded border border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] px-3 py-2 text-xs text-[var(--severity-info-fg)]">
            <Icon path={mdiInformationOutline} size={0.6} className="mt-0.5 shrink-0" />
            <span>
              {i18nT("retry.scopeNote", undefined,
                "Global setting — also applies to pi sessions started outside the dashboard. Saving reloads connected sessions so it takes effect right away.")}
            </span>
          </div>

          {/* No Save button — the panel's unified Save bar commits this source.
             `reloadedSessions` still surfaces here; the generic bar cannot
             express it. */}
          {status && (
            <div data-testid="retry-save-status" className="text-xs text-[var(--accent-green)]">{status}</div>
          )}
        </>
      )}
    </section>
  );
}
