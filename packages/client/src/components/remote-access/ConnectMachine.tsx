/**
 * Connect to another machine: Which machine → Check it can be reached → Ask that
 * machine for access → finish. State lives in {@link useConnectMachine}, held by
 * the wizard host so it survives moving between steps.
 *
 * Add → probe → ask (design D7). Browser: opens the remote's own `/pair?request`
 * page in a new tab with no opener and says the confirmation is NOT verified
 * here. Desktop app: proves the server's identity first and knocks only when the
 * proven fingerprint matches what is pinned/advertised (or the operator
 * confirms it).
 *
 * See change: add-remote-access-wizard.
 */

import type { DiscoveredServerInfo, KnownServerListEntry, KnownServerProbeStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useCallback, useEffect, useState } from "react";
import {
  discoverServers,
  listKnownServersWithAccess,
  probeKnownServer,
  removeKnownServer,
} from "../../lib/api/known-servers-api.js";
import { getOpenServerWindow } from "../../lib/electron-server-windows.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { openExternalUrl } from "../../lib/nav/safe-navigation.js";
import { knockServer } from "../../lib/pairing/knock.js";
import { challengeIdentity } from "../../lib/pairing/pair-protocol.js";
import {
  type Address,
  ensureKnown,
  findKnown,
  knockDecision,
  parseAddress,
  remoteOrigin,
  remoteRequestUrl,
  sameAddress,
} from "../../lib/remote-access/connect-machine.js";
import { HELP, severityPill } from "../connectivity/connectivity-ui.js";
import type { StepCtx } from "./ra-context.js";
import { Callout, PrimaryButton, SmallButton } from "./ra-ui.js";

type Reach = { status: "idle" } | { status: "running" } | { status: "done"; result: KnownServerProbeStatus | null };
type Ask =
  | { status: "idle" }
  | { status: "proving" }
  | { status: "confirm"; fingerprint: string }
  | { status: "waiting"; code: string }
  | { status: "error"; message: string }
  | { status: "opened" };

export interface ConnectMachine {
  target: Address | null;
  setTarget: (a: Address | null) => void;
  /** This run added the entry (so a failed probe may offer Remove). */
  created: boolean;
  setCreated: (b: boolean) => void;
  /** The task stopped (identity changed): the reason. */
  stopped: string | null;
  setStopped: (s: string | null) => void;
  reach: Reach;
  setReach: (r: Reach) => void;
  ask: Ask;
  setAsk: (a: Ask) => void;
  known: KnownServerListEntry[];
  setKnown: (k: KnownServerListEntry[]) => void;
}

export function useConnectMachine(): ConnectMachine {
  const [target, setTarget] = useState<Address | null>(null);
  const [created, setCreated] = useState(false);
  const [stopped, setStopped] = useState<string | null>(null);
  const [reach, setReach] = useState<Reach>({ status: "idle" });
  const [ask, setAsk] = useState<Ask>({ status: "idle" });
  const [known, setKnown] = useState<KnownServerListEntry[]>([]);
  return { target, setTarget, created, setCreated, stopped, setStopped, reach, setReach, ask, setAsk, known, setKnown };
}

const WORD: Record<KnownServerProbeStatus, string> = {
  reachable: "Available",
  "name-not-resolved": "Unreachable",
  refused: "Unreachable",
  timeout: "Unreachable",
  error: "Unreachable",
};

// ── Which machine ────────────────────────────────────────────────────

export function MachineBody({ ctx, cm }: { ctx: StepCtx; cm: ConnectMachine }) {
  const { t } = useI18n();
  const [discovered, setDiscovered] = useState<DiscoveredServerInfo[]>([]);
  const [words, setWords] = useState<Record<string, KnownServerProbeStatus | null>>({});
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { setKnown } = cm;

  useEffect(() => {
    let alive = true;
    void listKnownServersWithAccess()
      .then(async ({ servers }) => {
        if (!alive) return;
        setKnown(servers);
        for (const s of servers) {
          void probeKnownServer(s.host, s.port).then((st) => alive && setWords((w) => ({ ...w, [`${s.host}:${s.port}`]: st })));
        }
      })
      .catch(() => {});
    // Discovered-but-unknown servers can't be probed until added: label only.
    void discoverServers()
      .then((d) => alive && setDiscovered(d.filter((x) => !x.isLocal)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [setKnown]);

  const unknownDiscovered = discovered.filter((d) => !findKnown(cm.known, d));

  const next = async () => {
    const addr = parseAddress(input);
    if (!addr) {
      setError(t("remoteAccess.machine.badAddress", undefined, "Enter an address like 192.168.1.20:8000."));
      return;
    }
    setError(null);
    setBusy(true);
    const out = await ensureKnown(addr, cm.known);
    setBusy(false);
    switch (out.kind) {
      case "known":
        cm.setTarget(out.address);
        cm.setCreated(false);
        break;
      case "created":
        cm.setTarget(out.address);
        cm.setCreated(true);
        break;
      case "identity-changed":
        cm.setStopped(t("remoteAccess.machine.identityChanged", undefined, "The server at that address is not the one this dashboard knew — its identity changed. Stopped."));
        return;
      case "self-address":
        setError(t("remoteAccess.machine.selfAddress", undefined, "That address reaches this dashboard itself, not another machine."));
        return;
      case "refused":
        setError(t("remoteAccess.err.refused", undefined, "This browser is not allowed to make the change."));
        return;
      default:
        setError(out.message);
        return;
    }
    ctx.complete("machine");
  };

  if (cm.stopped) {
    return (
      <Callout severity="error" testId="remote-access-machine-stopped">
        {cm.stopped}
      </Callout>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1" data-testid="remote-access-machine-list">
        {cm.known.map((s) => {
          const key = `${s.host}:${s.port}`;
          const st = words[key];
          return (
            <li key={key}>
              <button
                type="button"
                data-testid="remote-access-machine-known"
                className="flex w-full items-center gap-2 rounded border border-[var(--border-primary)] px-2 py-1.5 text-left text-xs"
                onClick={() => setInput(key)}
              >
                <span className="min-w-0 flex-1 truncate">{s.label ? `${s.label} · ${key}` : key}</span>
                <span className={severityPill(st === "reachable" ? "success" : st === undefined ? "neutral" : "error", true)}>
                  {st === undefined ? t("remoteAccess.checking", undefined, "Checking…") : st === null ? t("remoteAccess.unknown", undefined, "unknown") : WORD[st]}
                </span>
              </button>
            </li>
          );
        })}
        {unknownDiscovered.map((d) => (
          <li key={`${d.host}:${d.port}`}>
            <button
              type="button"
              data-testid="remote-access-machine-discovered"
              className="flex w-full items-center gap-2 rounded border border-[var(--border-primary)] px-2 py-1.5 text-left text-xs"
              onClick={() => setInput(`${d.host}:${d.port}`)}
            >
              <span className="min-w-0 flex-1 truncate">{d.name ? `${d.name} · ${d.host}:${d.port}` : `${d.host}:${d.port}`}</span>
              <span className={severityPill("info", true)}>{t("remoteAccess.machine.found", undefined, "found on this network")}</span>
            </button>
          </li>
        ))}
      </ul>
      <label className="block text-xs text-[var(--text-secondary)]">
        {t("remoteAccess.machine.address", undefined, "Address of the other machine")}
        <input
          data-testid="remote-access-machine-input"
          className="mt-1 block w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-xs text-[var(--text-primary)]"
          placeholder="192.168.1.20:8000"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" data-testid="remote-access-machine-error" className="text-xs text-[var(--severity-error-fg)]">
          {error}
        </p>
      )}
      <PrimaryButton testId="remote-access-machine-continue" onClick={() => void next()} disabled={busy || input.trim() === ""}>
        {t("remoteAccess.continue", undefined, "Continue")}
      </PrimaryButton>
    </div>
  );
}

// ── Check it can be reached ──────────────────────────────────────────

export function ReachBody({ ctx, cm }: { ctx: StepCtx; cm: ConnectMachine }) {
  const { t } = useI18n();
  const { target, reach, setReach } = cm;
  const { complete } = ctx;

  const run = useCallback(async () => {
    if (!target) return;
    setReach({ status: "running" });
    const result = await probeKnownServer(target.host, target.port);
    setReach({ status: "done", result });
    if (result === "reachable") complete("reach");
  }, [target, setReach, complete]);

  useEffect(() => {
    if (reach.status === "idle") void run();
  }, [reach.status, run]);

  const failed = reach.status === "done" && reach.result !== "reachable";
  return (
    <div className="space-y-2" data-testid="remote-access-reach">
      {reach.status !== "done" && <p className="text-xs text-[var(--text-secondary)]">{t("remoteAccess.checking", undefined, "Checking…")}</p>}
      {failed && (
        <>
          <Callout severity="error" testId="remote-access-reach-failed">
            {t(
              "remoteAccess.reach.failed",
              { reason: reach.result ?? "unknown" },
              `${target ? `${target.host}:${target.port}` : "That machine"} could not be reached: ${reach.result ?? "unknown"}.`,
            )}
          </Callout>
          <div className="flex gap-2">
            <SmallButton testId="remote-access-reach-retry" onClick={() => setReach({ status: "idle" })}>
              {t("remoteAccess.retry", undefined, "Retry")}
            </SmallButton>
            {cm.created && target && (
              <SmallButton
                testId="remote-access-reach-remove"
                onClick={() => {
                  // The wizard only ever creates the plain-http route it typed; name it so an https sibling survives.
                  void removeKnownServer(target.host, target.port, "http").then(() => {
                    cm.setTarget(null);
                    cm.setCreated(false);
                    setReach({ status: "idle" });
                    ctx.patchRun({ done: ctx.run.done.filter((d) => d !== "machine") });
                  });
                }}
              >
                {t("remoteAccess.reach.remove", undefined, "Remove it from known servers")}
              </SmallButton>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Ask that machine for access ──────────────────────────────────────

export function AskBody({ ctx, cm }: { ctx: StepCtx; cm: ConnectMachine }) {
  const { t } = useI18n();
  const { target, ask, setAsk } = cm;
  const desktop = !!getOpenServerWindow();
  if (!target) return null;

  if (!desktop) {
    return (
      <div className="space-y-3" data-testid="remote-access-ask-browser">
        <p className={HELP}>
          {t(
            "remoteAccess.ask.browser",
            undefined,
            "The other machine shows the code to type there, and the approval result, in the tab this opens.",
          )}
        </p>
        <PrimaryButton
          testId="remote-access-ask-open"
          onClick={() => {
            openExternalUrl(remoteRequestUrl(target));
            setAsk({ status: "opened" });
          }}
        >
          {t("remoteAccess.ask.openPage", undefined, "Open the request page")}
        </PrimaryButton>
        {ask.status === "opened" && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--severity-warning-fg)]" data-testid="remote-access-ask-unverified">
              {t("remoteAccess.ask.unverified", undefined, "This dashboard cannot verify the confirmation below — the other tab shows the real result.")}
            </p>
            <SmallButton testId="remote-access-ask-approved" onClick={() => ctx.complete("ask")}>
              {t("remoteAccess.ask.approved", undefined, "I've been approved")}
            </SmallButton>
          </div>
        )}
      </div>
    );
  }

  const origin = remoteOrigin(target);
  const entry = findKnown(cm.known, target);
  const doKnock = async (fingerprint: string) => {
    setAsk({ status: "waiting", code: "" });
    try {
      const out = await knockServer(origin, fingerprint, "pi-dashboard", {
        onWaiting: (w) => setAsk({ status: "waiting", code: w.confirmCode }),
      });
      if (out.status === "approved") ctx.complete("ask");
      else setAsk({ status: "error", message: out.status });
    } catch (e) {
      setAsk({ status: "error", message: e instanceof Error ? e.message : "request failed" });
    }
  };

  const start = async () => {
    setAsk({ status: "proving" });
    try {
      const proof = await challengeIdentity(origin);
      if (!proof.verified) {
        setAsk({ status: "error", message: t("remoteAccess.ask.badProof", undefined, "The server could not prove its identity.") });
        return;
      }
      const advert = (await discoverServers().catch(() => [] as DiscoveredServerInfo[])).find((d) => sameAddress(d, target))?.fingerprint;
      const decision = knockDecision({ pin: entry?.fingerprint, advert, proven: proof.fingerprint });
      if (decision.kind === "knock") await doKnock(decision.fingerprint);
      else if (decision.kind === "confirm") setAsk({ status: "confirm", fingerprint: decision.fingerprint });
      else
        setAsk({
          status: "error",
          message: t("remoteAccess.ask.mismatch", { against: decision.against }, `Identity mismatch (${decision.against}) — no request was sent.`),
        });
    } catch (e) {
      setAsk({ status: "error", message: e instanceof Error ? e.message : "request failed" });
    }
  };

  return (
    <div className="space-y-3" data-testid="remote-access-ask-desktop">
      {ask.status === "confirm" && (
        <>
          <Callout severity="warning">
            {t("remoteAccess.ask.confirmFp", undefined, "This server has no pinned identity yet. Only continue if this fingerprint matches the one shown on that machine:")}{" "}
            <code data-testid="remote-access-ask-fingerprint" className="select-all break-all font-mono">
              {ask.fingerprint}
            </code>
          </Callout>
          <PrimaryButton testId="remote-access-ask-confirm" onClick={() => void doKnock(ask.fingerprint)}>
            {t("remoteAccess.ask.confirmSend", undefined, "It matches — send the request")}
          </PrimaryButton>
        </>
      )}
      {ask.status === "waiting" && (
        <p role="status" data-testid="remote-access-ask-waiting" className="text-sm text-[var(--text-primary)]">
          {ask.code
            ? t("remoteAccess.ask.code", { code: ask.code }, `Type this code on the other machine: ${ask.code}`)
            : t("remoteAccess.checking", undefined, "Checking…")}
        </p>
      )}
      {ask.status === "error" && (
        <Callout severity="error" testId="remote-access-ask-error">
          {ask.message}
        </Callout>
      )}
      {(ask.status === "idle" || ask.status === "error") && (
        <PrimaryButton testId="remote-access-ask-run" onClick={() => void start()}>
          {t("remoteAccess.ask.run", undefined, "Ask for access")}
        </PrimaryButton>
      )}
    </div>
  );
}

// ── Finish ───────────────────────────────────────────────────────────

export function FinishBody({ ctx, cm }: { ctx: StepCtx; cm: ConnectMachine }) {
  const { t } = useI18n();
  const target = cm.target;
  if (!target) return null;
  const openWindow = getOpenServerWindow();
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-secondary)]">{t("remoteAccess.finish.help", undefined, "You can use that machine's dashboard now.")}</p>
      <div className="flex gap-2">
        <PrimaryButton
          testId="remote-access-finish-open"
          onClick={() => {
            if (openWindow) void openWindow({ host: target.host, port: target.port });
            else openExternalUrl(remoteOrigin(target));
            ctx.finishTask();
          }}
        >
          {openWindow
            ? t("remoteAccess.finish.openWindow", undefined, "Open its window")
            : t("remoteAccess.finish.openTab", undefined, "Open it in a new tab")}
        </PrimaryButton>
        <SmallButton testId="remote-access-finish-stay" onClick={() => ctx.finishTask()}>
          {t("remoteAccess.finish.stay", undefined, "Stay here")}
        </SmallButton>
      </div>
    </div>
  );
}
