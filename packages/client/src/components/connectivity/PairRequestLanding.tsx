/**
 * Request mode of the browser `/pair` landing (`/pair?request`, no payload
 * fragment): a browser on the LAN knocks the dashboard it was loaded from and a
 * person at the dashboard machine approves by typing the 8-digit code shown here.
 *
 *   intro → Request access → waiting (code, countdown, poll)
 *     → approved (cookie exchange → `/`) | rejected | expired | missed | refused
 *
 * Same-origin and TOFU (design D9): no identity challenge. It must run on a
 * plain-http LAN origin, so it never touches `crypto.subtle`, `crypto.randomUUID`
 * or `navigator.clipboard`. No Cancel while waiting — the server cannot withdraw
 * a knock (ui-plan D8). A live request (`pendingId`/`confirmCode`/`expiresAt`)
 * lives in `sessionStorage` so a reload resumes the same code; it is cleared on
 * any resolution or expiry.
 *
 * See change: add-lan-knock-pairing (D9, ui-plan D5–D10).
 */
import { KNOCK_NO_RETRY, KNOCK_REFUSAL_COPY, KNOCK_REFUSAL_GENERIC } from "@blackbelt-technology/pi-dashboard-shared/pairing-knock.js";
import { mdiCancel, mdiCheckCircle, mdiClockOutline, mdiInformationOutline, mdiLockOpenVariantOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { finishDevicePairing } from "../../lib/pairing/device-auth.js";
import { confirmCodeAriaLabel, formatCountdown, groupConfirmCode } from "../../lib/pairing/knock-format.js";
import {
  clearStoredKnock,
  clearStoredRefusal,
  readStoredKnock,
  type StoredKnock,
  writeStoredKnock,
  writeStoredRefusal,
} from "../../lib/pairing/knock-state.js";
import { postJson } from "../../lib/pairing/pair-protocol.js";
import { requestAccess } from "../../lib/pairing/pairing-api.js";
import { INPUT } from "./connectivity-ui.js";
import { PairKeepFailedNotice } from "./PairKeepFailedNotice.js";
import { CALLOUT_ERROR, CALLOUT_INFO, CALLOUT_SUCCESS, CALLOUT_WARNING, LANDING_PRIMARY, LANDING_SECONDARY } from "./pair-landing-ui.js";

type Phase = "intro" | "sending" | "waiting" | "approved" | "rejected" | "expired" | "missed" | "refused" | "keepFailed";

/** The live knock this tab is waiting on. Persisted in `sessionStorage` (see `lib/pairing/knock-state.ts`). */
type StoredRequest = StoredKnock;

interface PollResult {
  status: "pending" | "approved" | "rejected" | "unknown";
  token?: string;
}

interface Refusal {
  code: string;
  /** Epoch ms until which a retry is pointless (`knock_rate_limited`). */
  cooldownUntil?: number;
}

const POLL_INTERVAL_MS = 2000;
/** Placeholder swapped for the host element when rendering `{host}` templates. */
const HOST_MARK = "\u0001";

/** Refusal copy + no-retry set live in shared so the Electron connecting window uses identical wording. */
const REFUSAL_COPY = KNOCK_REFUSAL_COPY;
const REFUSAL_GENERIC = KNOCK_REFUSAL_GENERIC;
const NO_RETRY = KNOCK_NO_RETRY;

const readStored = readStoredKnock;
const writeStored = writeStoredKnock;
const clearStored = clearStoredKnock;

/** True for `/pair?request` without a payload fragment (the QR flow owns a fragment). */
export function isRequestMode(): boolean {
  if (window.location.hash.replace(/^#/, "").trim()) return false;
  return new URLSearchParams(window.location.search).has("request");
}

/** `{host}` templates need the host as an element, but `t()` only returns strings. */
function useWithHost() {
  const { t } = useI18n();
  return (key: string, fallback: string, hostNode: React.ReactNode): React.ReactNode => {
    const [before, after = ""] = t(key, { host: HOST_MARK }, fallback).split(HOST_MARK);
    return (
      <>
        {before}
        {hostNode}
        {after}
      </>
    );
  };
}

/**
 * Poll `/api/pair/poll` while `active`: on a timer AND immediately when the page
 * becomes visible again. A resumed request polls at once (its outcome may already
 * be waiting); a fresh one after one interval. Resolution is reported through
 * `onResolved` and always clears the stored request first.
 */
function useKnockPoll(
  active: boolean,
  request: StoredRequest | null,
  resumedId: string | undefined,
  onResolved: (outcome: PollOutcome) => void,
): void {
  const resolvedRef = useRef(onResolved);
  resolvedRef.current = onResolved;

  useEffect(() => {
    if (!active || !request) return;
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      clearTimeout(timer);
      const outcome = await pollOnce(request);
      inFlight = false;
      if (stopped) return;
      if (outcome) {
        clearStored();
        resolvedRef.current(outcome);
      } else if (!stopped) {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    timer = setTimeout(poll, resumedId === request.pendingId ? 0 : POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, request, resumedId]);
}

/** One poll; a transient transport error is "no outcome yet" (retry on the next tick). */
async function pollOnce(request: StoredRequest): Promise<PollOutcome | null> {
  try {
    const r = await postJson<PollResult>("", "/api/pair/poll", { pendingId: request.pendingId });
    return classifyPoll(r, request.expiresAt);
  } catch {
    return null;
  }
}

type PollOutcome = { phase: "approved"; token: string } | { phase: "rejected" | "expired" | "missed" };

/** Map a poll result to a resolution, or null while the request is still live. */
function classifyPoll(r: PollResult, expiresAt: number): PollOutcome | null {
  if (r.status === "approved" && r.token) return { phase: "approved", token: r.token };
  if (r.status === "rejected") return { phase: "rejected" };
  if (r.status === "pending") return Date.now() < expiresAt ? null : { phase: "expired" };
  // `unknown` (or any status this client does not know) is terminal.
  return { phase: Date.now() < expiresAt ? "missed" : "expired" };
}

function Title() {
  const { t } = useI18n();
  return <h1 className="text-xl font-semibold">{t("landing.request.title", undefined, "Request access")}</h1>;
}

function IntroView(props: {
  busy: boolean;
  name: string;
  error: string | null;
  onName: (v: string) => void;
  onSend: () => void;
}) {
  const { t } = useI18n();
  const withHost = useWithHost();
  const hostEl = (
    <span data-testid="pair-landing-request-host" className="font-mono font-semibold text-[var(--text-primary)]">
      {window.location.host}
    </span>
  );
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!props.busy) props.onSend();
      }}
    >
      <Title />
      <p className="text-sm text-[var(--text-secondary)]">
        {withHost(
          "landing.request.intro",
          "Ask the dashboard at {host} to let this browser in. The person at that computer approves it by typing a code you'll see here.",
          hostEl,
        )}
      </p>
      {window.location.protocol !== "https:" && (
        <div data-testid="pair-landing-request-unencrypted" role="note" className={CALLOUT_WARNING}>
          <Icon path={mdiLockOpenVariantOutline} size={0.8} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            {t(
              "landing.request.unencrypted",
              undefined,
              "This page isn't encrypted. The request, and the access you get, travel in the clear on this network.",
            )}
          </p>
        </div>
      )}
      <div>
        <label htmlFor="pair-request-name" className="mb-1 block text-sm font-semibold text-[var(--text-primary)]">
          {t("landing.request.nameLabel", undefined, "Device name")}{" "}
          <span className="font-normal text-[var(--text-secondary)]">{t("landing.request.optional", undefined, "(optional)")}</span>
        </label>
        <p id="pair-request-name-hint" className="mb-1 text-xs text-[var(--text-secondary)]">
          {t("landing.request.nameHint", undefined, "Shown to the person approving, next to this device's network address.")}
        </p>
        <input
          id="pair-request-name"
          data-testid="pair-landing-request-name"
          className={INPUT}
          value={props.name}
          onChange={(e) => props.onName(e.target.value)}
          aria-describedby="pair-request-name-hint"
          autoComplete="off"
        />
      </div>
      {props.error && (
        <p data-testid="pair-landing-request-error" role="alert" className={CALLOUT_ERROR}>
          {props.error}
        </p>
      )}
      <button type="submit" data-testid="pair-landing-request-send" disabled={props.busy} aria-busy={props.busy} className={LANDING_PRIMARY}>
        {props.busy ? t("landing.request.sending", undefined, "Sending request…") : t("landing.request.send", undefined, "Request access")}
      </button>
    </form>
  );
}

function WaitingView({ request, now }: { request: StoredRequest; now: number }) {
  const { t } = useI18n();
  const withHost = useWithHost();
  return (
    <>
      <Title />
      <div
        data-testid="pair-landing-request-status"
        role="status"
        aria-live="polite"
        className="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-5 text-center"
      >
        <p className="text-sm text-[var(--text-primary)]">
          {withHost(
            "landing.request.typeCode",
            "On the computer running the dashboard ({host}), type this code in the \"asks to connect\" window:",
            <span className="font-mono font-semibold">{window.location.hostname}</span>,
          )}
        </p>
        <p
          data-testid="pair-landing-request-code"
          role="img"
          aria-label={confirmCodeAriaLabel(request.confirmCode)}
          className="my-3 whitespace-pre font-mono text-4xl font-bold tracking-widest text-[var(--text-primary)]"
        >
          {groupConfirmCode(request.confirmCode)}
        </p>
        {/* The ticking time is not announced every second: only the surrounding status text is live. */}
        <p data-testid="pair-landing-request-countdown" aria-live="off" className="flex items-center justify-center gap-1 text-xs text-[var(--text-primary)]">
          <Icon path={mdiClockOutline} size={0.6} aria-hidden="true" />
          {t("landing.request.waiting", { time: formatCountdown(request.expiresAt - now) }, "Waiting for approval · expires in {time}")}
        </p>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">
        {t("landing.request.keepOpen", undefined, "Keep this page open. It continues on its own once approved.")}
      </p>
    </>
  );
}

function ApprovedView() {
  const { t } = useI18n();
  return (
    <>
      <Title />
      <div data-testid="pair-landing-request-approved" role="status" className={CALLOUT_SUCCESS}>
        <Icon path={mdiCheckCircle} size={0.8} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>{t("landing.request.approved", undefined, "Approved. Opening the dashboard…")}</p>
      </div>
    </>
  );
}

/** Declined: a definitive "no", and the server's cooldown applies — no immediate retry. */
function RejectedView() {
  const { t } = useI18n();
  return (
    <>
      <Title />
      <div data-testid="pair-landing-request-rejected" role="alert" className={CALLOUT_ERROR}>
        <Icon path={mdiCancel} size={0.8} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{t("landing.request.rejected", undefined, "The dashboard declined this request.")}</p>
          <p className="mt-1">
            {t(
              "landing.request.rejectedHint",
              undefined,
              "If that was a mistake, ask the person at that computer, then request again in about 10 minutes.",
            )}
          </p>
        </div>
      </div>
    </>
  );
}

/** Expired, or an outcome missed while the page was away: one primary "Request again". */
function EndedView({ expired, onAgain }: { expired: boolean; onAgain: () => void }) {
  const { t } = useI18n();
  return (
    <>
      <Title />
      <div data-testid={`pair-landing-request-${expired ? "expired" : "missed"}`} role="alert" className={CALLOUT_INFO}>
        <Icon path={mdiInformationOutline} size={0.8} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">
            {expired
              ? t("landing.request.expired", undefined, "The request expired before anyone approved it.")
              : t("landing.request.missed", undefined, "This request may have been decided while this page was away.")}
          </p>
          <p className="mt-1">
            {expired
              ? t("landing.request.expiredHint", undefined, "Make sure someone is at the dashboard computer, then send a new request.")
              : t(
                  "landing.request.missedHint",
                  undefined,
                  "Check with the person at the dashboard computer. If you still need access, request again.",
                )}
          </p>
        </div>
      </div>
      <button type="button" data-testid="pair-landing-request-retry" onClick={onAgain} className={LANDING_PRIMARY}>
        {t("landing.request.again", undefined, "Request again")}
      </button>
    </>
  );
}

/** A refusal: what happened + what to do, with an action only when retrying can help. */
function RefusedView({ refusal, now, onAgain }: { refusal: Refusal; now: number; onAgain: () => void }) {
  const { t } = useI18n();
  const copy = REFUSAL_COPY[refusal.code] ?? REFUSAL_GENERIC;
  const remaining = refusal.cooldownUntil ? refusal.cooldownUntil - now : 0;
  const cooling = remaining > 0;
  const time = formatCountdown(remaining);
  const rateLimited = refusal.code === "knock_rate_limited";
  return (
    <>
      <Title />
      <div data-testid="pair-landing-request-refused" role="alert" className={CALLOUT_INFO}>
        <Icon path={mdiInformationOutline} size={0.8} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>{t(copy.key, { time }, copy.fallback)}</p>
      </div>
      {(rateLimited || !NO_RETRY.has(refusal.code)) && (
        <button
          type="button"
          data-testid="pair-landing-request-retry"
          disabled={cooling}
          onClick={onAgain}
          className={rateLimited && !cooling ? LANDING_PRIMARY : LANDING_SECONDARY}
        >
          {rateLimited
            ? cooling
              ? t("landing.request.againIn", { time }, "Request again (in {time})")
              : t("landing.request.again", undefined, "Request again")
            : t("landing.tryAgain", undefined, "Try again")}
        </button>
      )}
    </>
  );
}

export function PairRequestLanding({ onPaired }: { onPaired?: (token: string) => void }) {
  const { t } = useI18n();
  const [resumed] = useState<StoredRequest | null>(readStored);
  const [request, setRequest] = useState<StoredRequest | null>(resumed);
  const [phase, setPhase] = useState<Phase>(resumed ? "waiting" : "intro");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  const issuedToken = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // One-second clock while a countdown is on screen (waiting, or a rate-limit cooldown).
  const ticking = phase === "waiting" || (phase === "refused" && !!refusal?.cooldownUntil);
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  const openDashboard = useCallback(() => {
    const token = issuedToken.current;
    if (onPaired && token) onPaired(token);
    else window.location.href = "/";
  }, [onPaired]);

  // Store the bearer (cookie exchange completes BEFORE navigation), then load the dashboard.
  const finishPaired = useCallback(
    async (token: string) => {
      issuedToken.current = token;
      const result = await finishDevicePairing(token);
      if (!mounted.current) return;
      if (result?.keepFailed) setPhase("keepFailed");
      else openDashboard();
    },
    [openDashboard],
  );

  const onResolved = useCallback(
    (outcome: PollOutcome) => {
      setPhase(outcome.phase);
      if (outcome.phase === "approved") void finishPaired(outcome.token);
    },
    [finishPaired],
  );
  useKnockPoll(phase === "waiting", request, resumed?.pendingId, onResolved);

  const send = useCallback(async () => {
    setError(null);
    setRefusal(null);
    clearStoredRefusal();
    setPhase("sending");
    let result: Awaited<ReturnType<typeof requestAccess>>;
    try {
      result = await requestAccess(name);
    } catch (err) {
      if (!mounted.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(t("landing.request.err.transport", { message }, `Couldn't reach the dashboard: ${message}`));
      setPhase("intro");
      return;
    }
    if (!mounted.current) return;
    if (!result.ok) {
      const refused = {
        code: result.error,
        ...(result.retryAfter ? { cooldownUntil: Date.now() + result.retryAfter * 1000 } : {}),
      };
      setRefusal(refused);
      // The denied bar reads it back (its refusal reason survives leaving this page).
      writeStoredRefusal({ ...refused, at: Date.now() });
      setPhase("refused");
      return;
    }
    const live: StoredRequest = { pendingId: result.pendingId, confirmCode: result.confirmCode, expiresAt: result.expiresAt };
    writeStored(live);
    setRequest(live);
    setNow(Date.now());
    setPhase("waiting");
  }, [name, t]);

  const again = () => void send();
  switch (phase) {
    case "intro":
    case "sending":
      return <IntroView busy={phase === "sending"} name={name} error={error} onName={setName} onSend={again} />;
    case "waiting":
      return request ? <WaitingView request={request} now={now} /> : null;
    case "approved":
      return <ApprovedView />;
    case "keepFailed":
      return (
        <>
          <Title />
          <PairKeepFailedNotice onOpen={openDashboard}>
            <button type="button" data-testid="pair-landing-request-retry" onClick={again} className={LANDING_SECONDARY}>
              {t("landing.request.again", undefined, "Request again")}
            </button>
          </PairKeepFailedNotice>
        </>
      );
    case "rejected":
      return <RejectedView />;
    case "expired":
    case "missed":
      return <EndedView expired={phase === "expired"} onAgain={again} />;
    case "refused":
      return refusal ? <RefusedView refusal={refusal} now={now} onAgain={again} /> : null;
  }
}
