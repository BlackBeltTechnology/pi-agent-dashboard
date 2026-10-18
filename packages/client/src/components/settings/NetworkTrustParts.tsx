/**
 * Security ▸ Network access — the trust-mode radio and its callouts, plus the
 * pure rules the section and its tests share. The panel owns the draft: nothing
 * here writes; every handler edits the panel draft and the panel Save commits.
 *
 * See change: retire-trusted-networks-bypass (D6b, mockups A1–A4).
 */
import type { TrustMode } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { mdiAlertOutline, mdiInformationOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useId } from "react";
import { trustEntryCovers } from "../../lib/gateway/gateway-config-ops.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { TrustPosture } from "../../lib/network-trust/trust-posture.js";
import { callout } from "../connectivity/connectivity-ui.js";

/** Everything the section needs to render and edit the trust mode (all derived by the panel). */
export interface NetworkTrustControls {
  /** Mode of the working draft (an unrecognised stored value reads `pair`). */
  draftMode: TrustMode;
  /** Mode of the saved config (what is enforced right now). */
  savedMode: TrustMode;
  /** The stored value when present but unrecognised in the DRAFT, else `null`. */
  unrecognised: string | null;
  posture: TrustPosture | null;
  /** `pairing.acceptLanRequests` as saved / as drafted. */
  lanSaved: boolean;
  lanDraft: boolean;
  onModeChange: (mode: TrustMode) => void;
  onLanChange: (on: boolean) => void;
}

/** "3 device addresses" — the unit is an address, not a device (one device can show several). */
function deviceAddresses(n: number): string {
  return n === 1
    ? i18nT("settings.networkAccess.oneAddress", undefined, "1 device address")
    : i18nT("settings.networkAccess.nAddresses", { n }, "{n} device addresses");
}

/** Private / CGNAT / link-local ranges a device may always request access from. */
function isDefaultKnockRange(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
}

/**
 * Can this refused peer already ask for access? A private/CGNAT address or one
 * a list entry covers. Advisory: the server's knock gate is the authority.
 */
export function canRequestAccess(ip: string, listed: string[]): boolean {
  return isDefaultKnockRange(ip) || listed.some((entry) => trustEntryCovers(entry, ip));
}

function Notice({
  severity,
  testId,
  children,
}: {
  severity: "warning" | "info";
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" data-testid={testId} className={callout(severity)}>
      <Icon path={severity === "warning" ? mdiAlertOutline : mdiInformationOutline} size={0.7} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1.5">{children}</div>
    </div>
  );
}

const CARD =
  "flex min-h-[44px] flex-1 cursor-pointer items-start gap-2 rounded-lg border bg-[var(--bg-tertiary)] px-3 py-2.5 text-left hover:bg-[var(--bg-hover)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus-ring)]";

function ModeCard({
  mode,
  checked,
  title,
  pill,
  description,
  onSelect,
}: {
  mode: TrustMode;
  checked: boolean;
  title: string;
  pill: string;
  description: string;
  onSelect: () => void;
}) {
  const id = useId();
  return (
    <label className={`${CARD} ${checked ? "border-[var(--tint-blue-border)]" : "border-[var(--border-secondary)]"}`}>
      {/* A native radio keeps arrow-key navigation, `.checked` and the radio role for free;
          the name comes from the title only, the consequence line is the description. */}
      <input
        type="radio"
        name="network-trust-mode"
        className="sr-only"
        data-testid={`network-trust-mode-${mode}`}
        checked={checked}
        onChange={onSelect}
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-2 ${checked ? "border-[var(--accent-primary)]" : "border-[var(--border-strong)]"}`}
      >
        {checked && <span className="size-2 rounded-full bg-[var(--accent-primary)]" />}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
          <span id={`${id}-t`}>{title}</span>
          <span className="rounded-full border border-[var(--severity-neutral-border)] bg-[var(--severity-neutral-bg)] px-1.5 text-[11px] font-semibold text-[var(--severity-neutral-fg)]">
            {pill}
          </span>
        </span>
        <span id={`${id}-d`} className="mt-0.5 block text-xs text-[var(--text-secondary)]">
          {description}
        </span>
      </span>
    </label>
  );
}

export function NetworkTrustModeRadio({ draftMode, onModeChange }: Pick<NetworkTrustControls, "draftMode" | "onModeChange">) {
  const labelId = useId();
  return (
    <div>
      <p id={labelId} className="mb-1 text-xs font-semibold text-[var(--text-primary)]">
        {i18nT("settings.networkAccess.modeLabel", undefined, "How devices on your network get in")}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col gap-2 sm:flex-row">
        <ModeCard
          mode="pair"
          checked={draftMode === "pair"}
          title={i18nT("settings.networkAccess.pairTitle", undefined, "Pair each device")}
          pill={i18nT("settings.networkAccess.recommended", undefined, "Recommended")}
          description={i18nT(
            "settings.networkAccess.pairDescription",
            undefined,
            "Every phone, laptop or browser is approved once with a code and can be revoked on its own.",
          )}
          onSelect={() => onModeChange("pair")}
        />
        <ModeCard
          mode="legacy"
          checked={draftMode === "legacy"}
          title={i18nT("settings.networkAccess.legacyTitle", undefined, "Trust whole networks")}
          pill={i18nT("settings.networkAccess.legacyPill", undefined, "Legacy")}
          description={i18nT(
            "settings.networkAccess.legacyDescription",
            undefined,
            "Any device on the listed networks gets full access without signing in.",
          )}
          onSelect={() => onModeChange("legacy")}
        />
      </div>
    </div>
  );
}

/** The "also accept access requests" checkbox shared by the consequence and the pair-mode info callout. */
function AcceptLanCheckbox({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-[32px] cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        data-testid="network-trust-accept-lan"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {i18nT("settings.networkAccess.acceptLan", undefined, "Also accept access requests from devices on this network")}
    </label>
  );
}

/**
 * Callouts between the radio and the list heading: the consequence of an unsaved
 * switch to Pair, or the migration warning, the pair-mode "LAN requests are off"
 * note, and the unrecognised-stored-value warning.
 */
export function NetworkTrustNotices(props: NetworkTrustControls) {
  const { draftMode, savedMode, unrecognised, posture, lanSaved, lanDraft, onModeChange, onLanChange } = props;
  const peers = posture?.networkOnly.distinctPeers ?? 0;
  const switching = draftMode === "pair" && savedMode === "legacy";
  const migrating = !switching && savedMode === "legacy" && draftMode === "legacy" && peers > 0;
  const lanOffInPair = !switching && savedMode === "pair" && draftMode === "pair" && !lanSaved;
  const lanOff = !lanDraft;

  return (
    <>
      {switching && (
        <Notice severity="warning" testId="network-trust-mode-consequence">
          <p>
            <strong>
              {peers > 0
                ? i18nT(
                    "settings.networkAccess.consequenceCount",
                    { count: deviceAddresses(peers) },
                    "{count} used network trust in the last 7 days or since the last restart.",
                  )
                : i18nT(
                    "settings.networkAccess.consequenceGeneric",
                    undefined,
                    "Devices that rely on network trust alone will be refused.",
                  )}
            </strong>{" "}
            {i18nT(
              "settings.networkAccess.consequenceBody",
              undefined,
              "After you save, they will be refused until each one pairs (Request access on the device, then you approve with a code). You can switch back at any time. A paired browser opens the live dashboard only with the Operate tier.",
            )}
          </p>
          <p>
            {i18nT(
              "settings.networkAccess.inPageSwitchNote",
              undefined,
              "Other dashboards that switch to this one in-page lose images and previews; open this dashboard directly instead.",
            )}
          </p>
          {!lanSaved && (
            <>
              {lanOff && (
                <p>
                  {i18nT(
                    "settings.networkAccess.lanOff",
                    undefined,
                    "Devices can't request access while LAN requests are off on this dashboard.",
                  )}
                </p>
              )}
              <AcceptLanCheckbox checked={lanDraft} onChange={onLanChange} />
            </>
          )}
        </Notice>
      )}

      {migrating && (
        <Notice severity="warning" testId="network-trust-migration">
          <p>
            <strong>
              {i18nT(
                "settings.networkAccess.migrationCount",
                { count: deviceAddresses(peers) },
                "{count} reached this dashboard by network trust alone",
              )}
            </strong>{" "}
            {i18nT(
              "settings.networkAccess.migrationBody",
              undefined,
              "in the last 7 days or since the last restart. Pair them, then choose Pair each device.",
            )}
          </p>
        </Notice>
      )}

      {lanOffInPair && (
        <Notice severity="info" testId="network-trust-lan-off">
          <p>
            {lanOff
              ? i18nT(
                  "settings.networkAccess.lanOffPair",
                  undefined,
                  "Devices can't request access until LAN requests are accepted on this dashboard.",
                )
              : i18nT(
                  "settings.networkAccess.lanOnAfterSave",
                  undefined,
                  "LAN requests will be accepted after you save.",
                )}
          </p>
          <AcceptLanCheckbox checked={lanDraft} onChange={onLanChange} />
        </Notice>
      )}

      {unrecognised !== null && (
        <Notice severity="warning" testId="network-trust-unrecognised">
          <p>
            {i18nT(
              "settings.networkAccess.unrecognised",
              { value: JSON.stringify(unrecognised) },
              "The saved trust mode {value} is not recognised, so this dashboard treats it as Pair each device. Save an explicit choice to replace it.",
            )}
          </p>
          <button
            type="button"
            data-testid="network-trust-save-explicit"
            onClick={() => onModeChange("pair")}
            className="focus-ring min-h-[32px] cursor-pointer rounded-md border border-[var(--severity-warning-border)] px-2.5 text-xs font-semibold"
          >
            {i18nT("settings.networkAccess.saveExplicit", undefined, "Use Pair each device explicitly")}
          </button>
        </Notice>
      )}
    </>
  );
}

/** One refused peer in `pair` mode: an information callout, never a Trust action. */
export function PairRefusedPeer({
  ip,
  count,
  eligible,
  onAllow,
}: {
  ip: string;
  count: number;
  eligible: boolean;
  onAllow: () => void;
}) {
  return (
    <div role="status" data-testid={`block-event-${ip}`} className={callout("info")}>
      <Icon path={mdiInformationOutline} size={0.7} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1.5">
        {eligible ? (
          <p>
            <strong className="font-mono">{ip}</strong>{" "}
            {i18nT(
              "settings.networkAccess.refusedEligible",
              { times: count > 1 ? ` ${count}×` : "" },
              "was refused{times}. On that device, open this dashboard and choose Request access. You'll approve it here with a code.",
            )}
          </p>
        ) : (
          <>
            <p>
              <strong className="font-mono">{ip}</strong>{" "}
              {i18nT(
                "settings.networkAccess.refusedIneligible",
                undefined,
                "was refused. It is outside the private ranges, so it cannot request access yet.",
              )}
            </p>
            <button
              type="button"
              data-testid={`block-event-allow-requests-${ip}`}
              onClick={onAllow}
              className="focus-ring min-h-[32px] cursor-pointer rounded-md border border-[var(--severity-info-border)] px-2.5 text-xs font-semibold"
            >
              {i18nT("settings.networkAccess.allowRequests", { ip }, "Allow requests from {ip}")}
            </button>
            <p className="text-[11px]">
              {i18nT("settings.networkAccess.allowRequestsHint", undefined, "This only lets devices there ask. You still approve each one.")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
