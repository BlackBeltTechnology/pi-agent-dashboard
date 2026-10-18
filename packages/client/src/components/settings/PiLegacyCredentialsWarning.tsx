/**
 * Warning listing plain-text API keys left in pi's settings.json (masked), with
 * a per-key cleanup action queued until the unified Save: "Move to Providers"
 * (auth.json has nothing for the provider), "Remove from settings.json"
 * (auth.json already holds this exact key) or a manual-step explanation (a
 * differing credential, or a providerless key — automatic removal could delete
 * the only copy). Actions exist in Form mode only: a raw JSON save would write
 * the keys back.
 *
 * See change: pi-settings-full-coverage (spec pi-settings-legacy-credentials).
 */
import { mdiAlert } from "@mdi/js";
import { Icon } from "@mdi/react";
import type { PiLegacyCredential } from "../../lib/api/pi-settings-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

export type LegacyAction = "move" | "remove";
/** key → queued action. */
export type LegacyQueue = Readonly<Record<string, LegacyAction>>;

interface Props {
  items: PiLegacyCredential[];
  queue: LegacyQueue;
  mode: "form" | "json";
  onQueue: (key: string, action: LegacyAction | null) => void;
}

const btn = "rounded border border-[var(--border-secondary)] px-2 py-0.5 text-xs";

/** Why this key is listed, per auth state. */
function whatText(item: PiLegacyCredential): string {
  const provider = item.provider ?? "";
  if (item.auth === "same") {
    return i18nT("piSettings.legacy.whatSame", { provider }, `Providers already holds this key for ${provider}; this copy is a duplicate.`);
  }
  if (item.provider === null) return i18nT("piSettings.legacy.whatNoProvider", undefined, "This key is not tied to a provider.");
  if (item.auth === "none") return i18nT("piSettings.legacy.whatNone", { provider }, `${provider} is not set up in Providers yet.`);
  return i18nT("piSettings.legacy.whatDifferent", { provider }, `Providers holds a different credential for ${provider}.`);
}

function QueuedAction({ item, queued, onQueue }: { item: PiLegacyCredential; queued: LegacyAction; onQueue: Props["onQueue"] }) {
  return (
    <span className="flex items-center gap-2">
      <span data-testid={`pi-settings-legacy-queued-${item.key}`}>
        {queued === "move"
          ? i18nT("piSettings.legacy.queuedMove", undefined, "Will move on Save")
          : i18nT("piSettings.legacy.queuedRemove", undefined, "Will remove on Save")}
      </span>
      <button type="button" data-testid={`pi-settings-legacy-undo-${item.key}`} className={btn} onClick={() => onQueue(item.key, null)}>
        {i18nT("piSettings.legacy.undo", undefined, "Undo")}
      </button>
    </span>
  );
}

function RowAction({ item, canAct, onQueue }: { item: PiLegacyCredential; canAct: boolean; onQueue: Props["onQueue"] }) {
  const automatic: LegacyAction | null = item.auth === "same" ? "remove" : item.auth === "none" && item.provider !== null ? "move" : null;
  if (automatic && canAct) {
    return (
      <button type="button" data-testid={`pi-settings-legacy-${automatic}-${item.key}`} className={btn} onClick={() => onQueue(item.key, automatic)}>
        {automatic === "remove"
          ? i18nT("piSettings.legacy.remove", undefined, "Remove from settings.json")
          : i18nT("piSettings.legacy.move", undefined, "Move to Providers")}
      </button>
    );
  }
  if (automatic) return null; // JSON mode: no actions
  return (
    <span data-testid={`pi-settings-legacy-manual-${item.key}`} className="text-[var(--text-secondary)]">
      {i18nT("piSettings.legacy.manual", undefined, "Keep the credential you want in Providers, then delete this key by hand in JSON mode.")}
    </span>
  );
}

function Row({ item, queued, canAct, onQueue }: { item: PiLegacyCredential; queued: LegacyAction | undefined; canAct: boolean; onQueue: Props["onQueue"] }) {
  return (
    <li data-testid={`pi-settings-legacy-${item.key}`} className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0">
        <code className="font-mono">{item.key}</code> <span className="font-mono">{item.masked}</span>. {whatText(item)}
      </span>
      {queued ? <QueuedAction item={item} queued={queued} onQueue={onQueue} /> : <RowAction item={item} canAct={canAct} onQueue={onQueue} />}
    </li>
  );
}

export function PiLegacyCredentialsWarning({ items, queue, mode, onQueue }: Props) {
  if (items.length === 0) return null;
  const n = items.length;
  return (
    <div
      role="region"
      aria-label={i18nT("piSettings.legacy.region", undefined, "Plain-text API keys")}
      data-testid="pi-settings-legacy"
      className="space-y-2 rounded border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] px-3 py-2 text-xs text-[var(--severity-warning-fg)]"
    >
      <div className="flex items-center gap-2 font-semibold">
        <Icon path={mdiAlert} size={0.6} className="shrink-0" />
        {n === 1
          ? i18nT("piSettings.legacy.titleOne", undefined, "1 API key is stored as plain text in settings.json")
          : i18nT("piSettings.legacy.titleMany", { n }, `${n} API keys are stored as plain text in settings.json`)}
      </div>
      <ul className="space-y-1">
        {items.map((it) => (
          <Row key={it.key} item={it} queued={queue[it.key]} canAct={mode === "form"} onQueue={onQueue} />
        ))}
      </ul>
      {mode === "json" && (
        <p data-testid="pi-settings-legacy-json-note">
          {i18nT("piSettings.legacy.jsonNote", undefined, "The cleanup runs from Form mode, because a JSON save would write the keys back.")}
        </p>
      )}
    </div>
  );
}
