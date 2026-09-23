/**
 * YOLO activation, shared by the three entry points (change:
 * add-access-grant-dialog, tasks 8b.7a, 8b.7b, 10.54 UI half):
 *
 * - Access page card (`YoloActivationForm` with the session `cwd` as base and
 *   the explicit unscoped choice);
 * - the grant dialog (`GrantDialogYoloOffer`: that denial's subject as base,
 *   a dashed secondary affordance, never a verdict button - the pending
 *   denial still needs its own answer, 10.74);
 * - the directory settings page (`DirectoryYoloAction`: its own directory
 *   pre-selected).
 *
 * Every surface posts to the ONE server session (`POST /api/access/yolo`).
 * Roots come only from `GET /api/access/yolo/roots` (base + its ladder,
 * narrowest first, pre-selected); there is no free-text entry. Unscoped is
 * offered on the Access page only and is never pre-selected. While a session
 * is live the form ADDS its root instead and says the timer is unchanged.
 * When YOLO is unavailable (report mode) every control is rendered inert
 * with the reason - never hidden.
 */
import { useEffect, useId, useState } from "react";
import { activateYolo, fetchYoloRoots, type YoloActivation } from "../../lib/access-grants/access-prompts-api.js";
import type { YoloSessionView, YoloView } from "../../lib/access-grants/access-prompts-types.js";
import { useYoloStatus, type YoloStatusStore, yoloStatus } from "../../lib/access-grants/yolo-status.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useLiveYoloSession, yoloRemainingLabel } from "./YoloIndicators.js";

const UNSCOPED = "\u0000unscoped";

const BTN =
  "px-2 py-1 rounded text-xs border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";
const META = "text-xs text-[var(--text-tertiary)]";
const OPTION = "flex items-center gap-2 px-2 py-1 rounded text-xs";

const durationLabel = (m: number) =>
  m % 60 === 0
    ? i18nT("yolo.hours", { count: m / 60 }, "{count} h")
    : i18nT("yolo.minutes", { count: m }, "{count} min");

/** Why a control is inert; rendered next to it, never instead of it. */
function YoloUnavailableReason() {
  return (
    <p data-testid="yolo-unavailable-reason" className="text-xs text-[var(--severity-warning-fg)]">
      {i18nT(
        "yolo.unavailable",
        { mode: "report", required: "enforce" },
        "Not available: host-gate mode is {mode}. YOLO answers only prompts, which need host-gate mode {required}.",
      )}
    </p>
  );
}

/** Offered roots for a base; `null` while loading or without a base. */
function useOfferedRoots(base: string | undefined): { roots: string[] | null; error: string | null } {
  const [state, setState] = useState<{ roots: string[] | null; error: string | null }>({ roots: null, error: null });
  useEffect(() => {
    setState({ roots: null, error: null });
    if (!base) return;
    let cancelled = false;
    fetchYoloRoots(base)
      .then((res) => {
        if (cancelled) return;
        setState(res.ok && res.data ? { roots: res.data.roots, error: null } : { roots: [], error: res.error ?? `HTTP ${res.status}` });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ roots: [], error: String((err as Error)?.message ?? err) });
      });
    return () => {
      cancelled = true;
    };
  }, [base]);
  return state;
}

export interface YoloActivationFormProps {
  yolo: YoloView | null;
  /** Directory whose ladder is offered (session cwd / denial subject / folder). */
  base: string | undefined;
  /** Offer the explicit unscoped choice (Access page only). */
  allowUnscoped?: boolean;
  /** Shown after a successful activation (e.g. the dialog's "still answer"). */
  afterActivate?: string;
  store?: YoloStatusStore;
  onChanged?(): void;
}

const errorText = (error: unknown) =>
  i18nT("yolo.failed", { error: String((error as Error)?.message ?? error) }, "YOLO request failed: {error}");

type Outcome = { message: string | null; error: string | null };

/** POST one activation / add; the outcome is what the form shows afterwards. */
async function postYolo(req: YoloActivation, afterActivate: string | undefined): Promise<Outcome> {
  const res = await activateYolo(req);
  if (!res.ok) return { message: null, error: errorText(res.error ?? `HTTP ${res.status}`) };
  if (res.data?.added) return { message: i18nT("yolo.added", undefined, "Folder added. The timer is unchanged."), error: null };
  return { message: afterActivate ?? i18nT("yolo.activated", undefined, "YOLO is on."), error: null };
}

function DurationPicker({
  durations,
  chosen,
  disabled,
  onChoose,
}: {
  durations: number[];
  chosen: number | null;
  disabled: boolean;
  onChoose(m: number): void;
}) {
  const group = useId();
  return (
    <fieldset data-testid="yolo-durations" disabled={disabled} className="flex flex-wrap gap-1">
      <legend className={`${META} mb-1 w-full`}>{i18nT("yolo.duration", undefined, "Stop asking for")}</legend>
      {durations.map((m) => (
        <label key={m} className={`${OPTION} border border-[var(--border-primary)]`}>
          <input type="radio" name={group} value={m} checked={chosen === m} onChange={() => onChoose(m)} />
          {durationLabel(m)}
        </label>
      ))}
    </fieldset>
  );
}

function RootsStatus({ base, roots, error }: { base: string | undefined; roots: string[] | null; error: string | null }) {
  if (!base) {
    return (
      <p data-testid="yolo-no-base" className={META}>
        {i18nT("yolo.noBase", undefined, "No working directory to scope to. Open a session, or use a folder's settings page.")}
      </p>
    );
  }
  if (roots === null) return <p className={META}>{i18nT("yolo.rootsLoading", undefined, "Loading folders...")}</p>;
  if (roots.length > 0) return null;
  return (
    <p data-testid="yolo-no-roots" className={META}>
      {error ? errorText(error) : i18nT("yolo.noRoots", { base }, "No folder above {base} may be opened.")}
    </p>
  );
}

function rootTag(i: number, inSession: boolean): string {
  if (inSession) return i18nT("yolo.rootInSession", undefined, "already in session");
  if (i === 0) return i18nT("yolo.rootNarrowest", undefined, "narrowest");
  return i18nT("yolo.rootUp", { count: i }, "{count} level(s) up");
}

function RootPicker({
  base,
  offered,
  chosen,
  disabled,
  withUnscoped,
  sessionRoots,
  onChoose,
}: {
  base: string | undefined;
  offered: { roots: string[] | null; error: string | null };
  chosen: string | null;
  disabled: boolean;
  withUnscoped: boolean;
  sessionRoots: string[];
  onChoose(root: string): void;
}) {
  const group = useId();
  return (
    <fieldset data-testid="yolo-roots" disabled={disabled} className="space-y-0.5">
      <legend className={`${META} mb-1`}>{i18nT("yolo.rootLegend", undefined, "In which folder?")}</legend>
      <RootsStatus base={base} roots={offered.roots} error={offered.error} />
      {offered.roots?.map((r, i) => (
        <label key={r} data-testid="yolo-root-option" className={`${OPTION} cursor-pointer hover:bg-[var(--bg-tertiary)]`}>
          <input type="radio" name={group} value={r} checked={chosen === r} onChange={() => onChoose(r)} />
          <span className="font-mono break-all text-[var(--text-primary)] flex-1">{r}</span>
          <span className="shrink-0 text-[var(--text-tertiary)]">{rootTag(i, sessionRoots.includes(r))}</span>
        </label>
      ))}
      {withUnscoped && (
        <label
          data-testid="yolo-unscoped-option"
          className={`${OPTION} cursor-pointer border-2 border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] font-bold text-[var(--severity-warning-fg)]`}
        >
          <input
            type="radio"
            name={group}
            value="unscoped"
            checked={chosen === UNSCOPED}
            onChange={() => onChoose(UNSCOPED)}
          />
          <span className="flex-1">
            <b>{i18nT("yolo.unscoped", undefined, "Everywhere (unscoped)")}</b>{" "}
            {i18nT("yolo.unscopedHint", undefined, "every folder on this machine, including every other session's workspace")}
          </span>
        </label>
      )}
    </fieldset>
  );
}

/** Busy/outcome state around one POST; refreshes the shared store afterwards. */
function useYoloSubmit(store: YoloStatusStore, afterActivate: string | undefined, onChanged?: () => void) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ message: null, error: null });
  const run = async (req: YoloActivation) => {
    setBusy(true);
    setOutcome({ message: null, error: null });
    try {
      setOutcome(await postYolo(req, afterActivate));
      await store.refresh();
      onChanged?.();
    } catch (err) {
      setOutcome({ message: null, error: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, outcome, run };
}

export function YoloActivationForm(props: YoloActivationFormProps) {
  const { session, now } = useLiveYoloSession(props.store ?? yoloStatus);
  if (props.yolo === null) {
    return <p className={META}>{i18nT("yolo.loading", undefined, "Loading YOLO status...")}</p>;
  }
  if (session?.unscoped) {
    return (
      <p data-testid="yolo-covers-all" className={META}>
        {i18nT("yolo.coversAll", undefined, "The active YOLO session is unscoped: it already covers every folder.")}
      </p>
    );
  }
  return <ActivationBody {...props} yolo={props.yolo} session={session} now={now} />;
}

function ActivationBody({
  yolo,
  base,
  allowUnscoped = false,
  afterActivate,
  store = yoloStatus,
  onChanged,
  session,
  now,
}: YoloActivationFormProps & { yolo: YoloView; session: YoloSessionView | null; now: number }) {
  const offered = useOfferedRoots(base);
  const [duration, setDuration] = useState<number | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const { busy, outcome, run } = useYoloSubmit(store, afterActivate, onChanged);

  // Shortest duration and the narrowest root are the defaults; unscoped never is.
  const chosenDuration = duration ?? yolo.durationsMinutes[0] ?? null;
  const chosenRoot = choice ?? offered.roots?.[0] ?? null;
  const inert = !yolo.available;
  const adding = session !== null;
  const ready = chosenRoot !== null && chosenDuration !== null;

  const submit = () => {
    if (!ready) return;
    void run(
      chosenRoot === UNSCOPED
        ? { durationMinutes: chosenDuration, unscoped: true }
        : { durationMinutes: chosenDuration, base: base ?? chosenRoot, root: chosenRoot },
    );
  };

  return (
    <div data-testid="yolo-activation" data-mode={adding ? "add" : "activate"} className="space-y-2">
      {inert && <YoloUnavailableReason />}
      {adding ? (
        <p data-testid="yolo-add-note" className="text-xs text-[var(--text-secondary)]">
          {i18nT(
            "yolo.addNote",
            { remaining: yoloRemainingLabel(session, now) },
            "YOLO is already on ({remaining}). Adding a folder joins that session: the timer is unchanged, and it never becomes unscoped.",
          )}
        </p>
      ) : (
        <DurationPicker
          durations={yolo.durationsMinutes}
          chosen={chosenDuration}
          disabled={inert || busy}
          onChoose={setDuration}
        />
      )}
      <RootPicker
        base={base}
        offered={offered}
        chosen={chosenRoot}
        disabled={inert || busy}
        withUnscoped={allowUnscoped && !adding}
        sessionRoots={session?.roots.map((r) => r.path) ?? []}
        onChoose={setChoice}
      />
      <button
        type="button"
        data-testid={adding ? "yolo-add-root" : "yolo-activate"}
        disabled={inert || busy || !ready}
        onClick={submit}
        className={BTN}
      >
        {adding
          ? i18nT("yolo.addRoot", undefined, "Add this folder (timer unchanged)")
          : i18nT("yolo.activate", undefined, "Stop asking")}
      </button>
      {outcome.message && (
        <p data-testid="yolo-activation-result" role="status" className="text-xs text-[var(--text-secondary)]">
          {outcome.message}
        </p>
      )}
      {outcome.error && (
        <p data-testid="yolo-activation-error" role="alert" className="text-xs text-[var(--severity-error-fg)]">
          {outcome.error}
        </p>
      )}
    </div>
  );
}

/**
 * Collapsible entry point shared by the grant dialog and the directory page:
 * a dashed secondary affordance that reveals the form. Inert, with the
 * reason, when YOLO is unavailable.
 */
function YoloDisclosure({
  testId,
  label,
  base,
  afterActivate,
  note,
  store = yoloStatus,
}: {
  testId: string;
  label: string;
  base: string;
  afterActivate?: string;
  note?: string;
  store?: YoloStatusStore;
}) {
  const yolo = useYoloStatus(store);
  const [open, setOpen] = useState(false);
  const inert = yolo !== null && !yolo.available;
  return (
    <div data-testid={testId} className="space-y-2">
      <button
        type="button"
        data-testid={`${testId}-toggle`}
        aria-expanded={open}
        disabled={inert}
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-2 py-1.5 rounded text-xs border border-dashed border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {label}
      </button>
      {inert && <YoloUnavailableReason />}
      {note && <p className={META}>{note}</p>}
      {open && !inert && <YoloActivationForm yolo={yolo} base={base} afterActivate={afterActivate} store={store} />}
    </div>
  );
}

/** Inline "stop asking for a while" inside the grant dialog (NOT a verdict). */
export function GrantDialogYoloOffer({ subject, store }: { subject: string; store?: YoloStatusStore }) {
  return (
    <YoloDisclosure
      testId="grant-dialog-yolo"
      label={i18nT("yolo.dialogOffer", undefined, "Stop asking for a while (YOLO)...")}
      base={subject}
      note={i18nT(
        "yolo.dialogNote",
        undefined,
        "Auto-allows later file requests in the chosen folder. The request above still needs your answer.",
      )}
      afterActivate={i18nT(
        "yolo.dialogActivated",
        undefined,
        "YOLO is on. This request still needs your answer below.",
      )}
      store={store}
    />
  );
}

/** Pre-scoped action on the directory settings page (its own folder pre-selected). */
export function DirectoryYoloAction({ cwd, store }: { cwd: string; store?: YoloStatusStore }) {
  return (
    <YoloDisclosure
      testId="directory-yolo"
      label={i18nT("yolo.directoryOffer", undefined, "Stop asking in this folder (YOLO)...")}
      base={cwd}
      store={store}
    />
  );
}
