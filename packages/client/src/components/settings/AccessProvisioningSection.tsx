/**
 * Settings → Access: pending provisioning requests (change:
 * add-access-provisioning, task 3.4; mockups/ui-plan.md S4, S5).
 *
 * Mounted inside `AccessPromptsSection` (above the denial "Pending requests"),
 * NOT inside `AccessSection`, whose contract pins "revoke controls only".
 * Every answer here settles an actual agent-proposed request the operator can
 * see in full: the same line component, defaults (nothing preselected) and
 * consequence statements as the dialog, so an answer on this page is never
 * less informed than one in the dialog.
 *
 * - Answerable only while this browser holds a prompt capability; the server
 *   also requires it (`POST /api/access/provision/:id/settle` and `dismiss-all`
 *   answer 403 `no-capability` otherwise). Without one the requests stay listed
 *   READ-ONLY with the reason; controls are inert, never hidden.
 * - Answers go over `POST …/settle`; the capability header attaches to every
 *   same-origin `/api/*` fetch (`grant-channel.ts`). A settled request is also
 *   claimed in the local dialog queue so no second answer can be sent from it.
 * - "Dismiss all pending" has no confirm step; each dismissal counts toward
 *   that project's cooldown, said beside the button.
 * - Refetches on mount, on every dialog-queue change (`store.getVersion()`),
 *   and on a slow poll.
 */
import type { ProvisionResponseMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { mdiAlertOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  dismissAllProvisionRequests,
  fetchProvisionRequests,
  type ProvisionRequestView,
  provisionViewToMessage,
  settleProvisionRequest,
} from "../../lib/access-grants/access-prompts-api.js";
import { useHasGrantChannel } from "../../lib/access-grants/grant-channel.js";
import { type ProvisionPromptStore, provisionPromptStore } from "../../lib/access-grants/provision-prompt-store.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  ProvisionConsequence,
  ProvisionLines,
  ProvisionRemoteGoals,
  useProvisionAnswer,
} from "../access-grant/ProvisionRequestParts.js";
import { callout, severityPill } from "../connectivity/connectivity-ui.js";

/** Background refresh while the page is open (a request created while it is open sends no page-level frame). */
const POLL_MS = 10_000;

const CARD = "border border-[var(--border-primary)] rounded bg-[var(--bg-secondary)]";
const BTN =
  "focus-ring shrink-0 inline-flex items-center justify-center px-3 min-h-[44px] sm:min-h-[36px] rounded text-xs font-semibold border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

type Busy = { id: string } | "dismiss-all" | null;

function RequestCard({
  request,
  answerable,
  busy,
  onSettle,
}: {
  request: ProvisionRequestView;
  answerable: boolean;
  busy: boolean;
  onSettle(request: ProvisionRequestView, lines: ProvisionResponseMessage["lines"]): void;
}) {
  const msg = provisionViewToMessage(request);
  const answer = useProvisionAnswer(msg.lines);
  const folders = msg.lines.length > 0;
  const minutes = Math.max(1, Math.ceil((request.expiresAt - Date.now()) / 60_000));
  const selected = answer.approved.size;
  return (
    <div data-testid="access-provision-request" data-request-id={request.requestId} className={`${CARD} p-3 space-y-3`}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <div className="min-w-0 flex-1">
          <span className="block text-xs text-[var(--text-tertiary)]">
            {i18nT("provision.claim.label", undefined, "requested for")}
          </span>
          <div data-testid="access-provision-root" className="font-mono text-sm break-all text-[var(--text-primary)]">
            {request.projectRoot}
          </div>
        </div>
        <span className={severityPill("neutral", false)}>
          {i18nT("provision.expires", { minutes }, "Expires in {minutes} min")}
        </span>
      </div>
      <ProvisionLines lines={msg.lines} answerable={answerable} answer={answer} />
      <ProvisionRemoteGoals goals={msg.remote} />
      {folders && answerable && <ProvisionConsequence />}
      {folders && answerable && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-[var(--text-tertiary)]">
            {i18nT("provision.page.footNote", undefined, "Closing this request rejects every folder.")}
          </span>
          <button
            type="button"
            data-testid="access-provision-reject"
            disabled={busy}
            onClick={() => onSettle(request, answer.rejectLines())}
            className={BTN}
          >
            {i18nT("provision.rejectRequest", undefined, "Reject request")}
          </button>
          <button
            type="button"
            data-testid="access-provision-approve"
            disabled={busy || selected === 0}
            onClick={() => onSettle(request, answer.answerLines())}
            className={BTN}
          >
            {i18nT("provision.approveSelected", { count: selected }, "Approve selected ({count})")}
          </button>
        </div>
      )}
    </div>
  );
}

export function AccessProvisioningSection({ store = provisionPromptStore }: { store?: ProvisionPromptStore }) {
  const version = useSyncExternalStore(store.subscribe, store.getVersion);
  const hasChannel = useHasGrantChannel();
  const [requests, setRequests] = useState<ProvisionRequestView[] | null>(null);
  // Two sources, so the refetch that follows a refused answer does not wipe its message.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchProvisionRequests();
      if (res.ok && res.data) {
        setRequests(res.data.requests.filter((r) => r.status === "pending"));
        setLoadError(null);
      } else if (res.status === 404) {
        // A server without the provisioning routes: nothing can be pending.
        setRequests([]);
        setLoadError(null);
      } else {
        setLoadError(res.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setLoadError(String((err as Error)?.message ?? err));
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

  const run = useCallback(
    async (key: Exclude<Busy, null>, action: () => Promise<{ ok: boolean; status: number; error?: string }>) => {
      setBusy(key);
      setActionError(null);
      try {
        const res = await action();
        // 409 `already-settled` etc.: say so; the refetch below shows the truth.
        if (!res.ok) setActionError(res.error ?? `HTTP ${res.status}`);
        await load();
      } catch (err) {
        setActionError(String((err as Error)?.message ?? err));
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const settle = (request: ProvisionRequestView, lines: ProvisionResponseMessage["lines"]) =>
    void run({ id: request.requestId }, async () => {
      const res = await settleProvisionRequest(request.requestId, lines);
      // The page answered it: the local dialog must not answer it a second time.
      if (res.ok) store.claim(request.requestId);
      return res;
    });

  const error = actionError ?? loadError;
  const list = requests ?? [];
  const count = list.length;
  const reasonId = "access-provision-readonly-reason";

  return (
    <div data-testid="access-provision-section" className="space-y-2">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
          {i18nT("provision.section.title", { count }, "Provisioning requests ({count})")}
        </h3>
        <span className="flex-1" />
        <button
          type="button"
          data-testid="access-provision-dismiss-all"
          disabled={!hasChannel || count === 0 || busy !== null}
          aria-describedby={hasChannel ? undefined : reasonId}
          onClick={() => void run("dismiss-all", dismissAllProvisionRequests)}
          className={BTN}
        >
          {i18nT("provision.dismissAll", undefined, "Dismiss all pending")}
        </button>
      </div>
      <p className="text-xs text-[var(--text-tertiary)]">
        {i18nT(
          "provision.dismissAllHint",
          undefined,
          "Dismissing a request counts toward that project's cooldown, so it can't ask again straight away.",
        )}
      </p>

      {!hasChannel && (
        <div id={reasonId} role="status" data-testid="access-provision-readonly" className={callout("warning")}>
          <Icon path={mdiAlertOutline} size={0.7} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <b className="block">
              {i18nT("provision.readonly.title", undefined, "Read-only: this browser can't answer provisioning requests")}
            </b>
            <p>
              {i18nT(
                "provision.readonly.body",
                undefined,
                "The server issued it no prompt capability (only a same-origin dashboard browser connection gets one). Open the dashboard in a browser that has one to answer. “Dismiss all pending” is unavailable here for the same reason.",
              )}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div data-testid="access-provision-error" role="alert" className="text-sm text-[var(--severity-error-fg)]">
          {i18nT("provision.error", { error }, "Provisioning request failed: {error}")}
        </div>
      )}

      {requests && count === 0 && (
        <p data-testid="access-provision-empty" className={`${CARD} px-3 py-2 text-xs text-[var(--text-tertiary)]`}>
          {i18nT("provision.empty", undefined, "No provisioning request is waiting.")}
        </p>
      )}

      {list.map((r) => (
        <RequestCard
          key={r.requestId}
          request={r}
          answerable={hasChannel}
          busy={busy !== null}
          onSettle={settle}
        />
      ))}
    </div>
  );
}
