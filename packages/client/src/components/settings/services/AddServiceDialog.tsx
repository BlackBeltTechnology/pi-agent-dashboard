/**
 * Add a service: choose a discovered offer or paste a JSON definition → review
 * (a dry run, nothing written) → explicit Confirm. Prefetch is a SEPARATE,
 * unchecked option and is never implied by Confirm. Validation errors are
 * listed one per line.
 * See change: add-services-settings-ui (D10, "Add service with explicit review").
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { AddReview, OfferSummary } from "@blackbelt-technology/pi-dashboard-shared/services/status.js";
import { useEffect, useId, useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import { type AddSource, addService, listOffers, runVerb, type ServicesResult } from "../../../lib/services/services-api.js";
import { BUTTON_CLASS, HELP_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS } from "../vault/vault-ui.js";
import { ActionFailure } from "./services-ui.js";

type Step = "choose" | "review" | "done";

function ReviewTable({ review }: { review: AddReview }) {
  const rows: Array<[string, string]> = [
    [i18nT("services.review.mode", undefined, "Mode"), review.mode + (review.drivers ? ` (${review.drivers.join(", ")})` : "")],
    ...(review.image ? ([[i18nT("services.review.image", undefined, "Image"), review.image]] as Array<[string, string]>) : []),
    ...(review.recipe
      ? ([[i18nT("services.review.recipe", undefined, "Recipe"), `${review.recipe.runner} ${review.recipe.package}${review.recipe.args.length ? ` ${review.recipe.args.join(" ")}` : ""}`]] as Array<[string, string]>)
      : []),
    [i18nT("services.review.ports", undefined, "Ports"), review.ports.join(", ") || "—"],
    [i18nT("services.review.volumes", undefined, "Volumes"), review.volumes.join(", ") || "—"],
    [i18nT("services.review.binds", undefined, "Host folders"), review.binds.join(", ") || "—"],
    [
      i18nT("services.review.secrets", undefined, "Secrets"),
      review.secrets.length ? review.secrets.map((n) => `${n} ← ${review.secretSources[n] ?? ""}`).join("; ") : "—",
    ],
  ];
  return (
    <dl data-testid="service-add-review" className="m-0 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-semibold text-[var(--text-secondary)]">{k}</dt>
          <dd className="m-0 break-words font-mono text-[var(--text-primary)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Server validation errors arrive as one `; `-joined message: show one per line. */
const errorLines = (message: string | undefined): string[] => (message ?? "").split("; ").map((l) => l.trim()).filter(Boolean);

export function AddServiceDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const [step, setStep] = useState<Step>("choose");
  const [offers, setOffers] = useState<OfferSummary[] | null>(null);
  const [offersError, setOffersError] = useState<string | null>(null);
  const [source, setSource] = useState<"offer" | "paste">("offer");
  const [offer, setOffer] = useState<string>("");
  const [pasted, setPasted] = useState("");
  const [prefetch, setPrefetch] = useState(false);
  const [review, setReview] = useState<AddReview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [failure, setFailure] = useState<ServicesResult<unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [prefetchNote, setPrefetchNote] = useState<string | null>(null);
  const pasteId = useId();
  const prefetchId = useId();

  useEffect(() => {
    let live = true;
    void listOffers().then((res) => {
      if (!live) return;
      if (res.ok && res.data) {
        const open = res.data.offers.filter((o) => !o.added);
        setOffers(open);
        if (open.length === 0) setSource("paste");
      } else {
        setOffers([]);
        setSource("paste");
        setOffersError(res.error ?? null);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const buildSource = (): AddSource | { error: string } => {
    if (source === "offer") return offer ? { offer } : { error: i18nT("services.add.pickOffer", undefined, "Pick an offer first.") };
    try {
      return { definition: JSON.parse(pasted) as unknown };
    } catch {
      return { error: i18nT("services.add.notJson", undefined, "That is not valid JSON.") };
    }
  };

  const doReview = async () => {
    const src = buildSource();
    if ("error" in src) {
      setErrors([src.error]);
      return;
    }
    setBusy(true);
    setErrors([]);
    setFailure(null);
    // Always a dry run first: nothing is written until Confirm.
    const res = await addService(src, true);
    setBusy(false);
    if (res.ok && res.data) {
      setReview(res.data.review);
      setStep("review");
    } else if (res.code === "operate_required") {
      setFailure(res);
    } else {
      setErrors(errorLines(res.error));
    }
  };

  const confirm = async () => {
    const src = buildSource();
    if ("error" in src || !review) return;
    setBusy(true);
    setFailure(null);
    const res = await addService(src, false);
    if (!res.ok) {
      setBusy(false);
      return setFailure(res);
    }
    const id = res.data?.review.id ?? review.id;
    // Prefetch only when the user ticked it — a separate request, never implied by Confirm.
    if (prefetch && review.needsPrefetch) {
      const pf = await runVerb(id, "prefetch");
      setPrefetchNote(pf.ok ? i18nT("services.add.prefetched", undefined, "Package fetched.") : (pf.error ?? i18nT("services.add.prefetchFailed", undefined, "Prefetch failed.")));
    }
    setBusy(false);
    setAddedId(id);
    setStep("done");
  };

  return (
    <Dialog open onClose={addedId ? () => onAdded(addedId) : onClose} title={i18nT("services.add.title", undefined, "Add a service")} size="lg" testId="service-add-dialog">
      {step === "choose" && (
        <>
          <fieldset className="m-0 border-0 p-0">
            <legend className={LABEL_CLASS}>{i18nT("services.add.source", undefined, "Where does it come from?")}</legend>
            <div className="flex flex-wrap gap-4 text-sm text-[var(--text-primary)]">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="svc-source" checked={source === "offer"} disabled={!offers || offers.length === 0} onChange={() => setSource("offer")} data-testid="service-add-source-offer" />
                {i18nT("services.add.fromOffer", undefined, "A package offers it")}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="svc-source" checked={source === "paste"} onChange={() => setSource("paste")} data-testid="service-add-source-paste" />
                {i18nT("services.add.fromJson", undefined, "Paste a JSON definition")}
              </label>
            </div>
          </fieldset>
          {source === "offer" ? (
            <ul data-testid="service-add-offers" className="m-0 list-none space-y-1 p-0">
              {(offers ?? []).map((o) => (
                <li key={o.ref}>
                  <label className="flex items-start gap-2 rounded border border-[var(--border-subtle)] p-2 text-sm text-[var(--text-primary)]">
                    <input type="radio" name="svc-offer" checked={offer === o.ref} onChange={() => setOffer(o.ref)} className="mt-1" data-testid={`service-add-offer-${o.id}`} />
                    <span>
                      <strong>{o.id}</strong> <span className={HELP_CLASS}>{o.mode}</span>
                      <span className={`${HELP_CLASS} block`}>
                        {o.package}@{o.version}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
              {offers === null && <li className={HELP_CLASS}>{i18nT("services.add.loadingOffers", undefined, "Looking for offers…")}</li>}
            </ul>
          ) : (
            <div>
              <label htmlFor={pasteId} className={LABEL_CLASS}>
                {i18nT("services.add.jsonLabel", undefined, "Service definition (JSON)")}
              </label>
              <textarea id={pasteId} className={`${INPUT_CLASS} min-h-[10rem] font-mono`} value={pasted} onChange={(e) => setPasted(e.target.value)} spellCheck={false} data-testid="service-add-json" />
              {offersError && <p className={`${HELP_CLASS} mt-1`}>{offersError}</p>}
            </div>
          )}
          {errors.length > 0 && (
            <ul role="alert" data-testid="service-add-errors" className="m-0 list-none space-y-0.5 p-0 text-xs text-[var(--severity-error-fg)]">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <ActionFailure failure={failure} />
          <div className="flex justify-end gap-2">
            <button type="button" className={BUTTON_CLASS} onClick={onClose} data-testid="service-add-cancel">
              {i18nT("common.cancel", undefined, "Cancel")}
            </button>
            <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={busy} onClick={doReview} data-testid="service-add-review-button">
              {i18nT("services.add.review", undefined, "Review")}
            </button>
          </div>
        </>
      )}
      {step === "review" && review && (
        <>
          <p className="text-sm text-[var(--text-secondary)]">
            {i18nT("services.add.reviewLead", { id: review.id }, "Check what {id} will be allowed to do. Nothing is written until you confirm.")}
          </p>
          <ReviewTable review={review} />
          {review.needsPrefetch && (
            <label htmlFor={prefetchId} className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
              <input id={prefetchId} type="checkbox" checked={prefetch} onChange={(e) => setPrefetch(e.target.checked)} className="mt-1" data-testid="service-add-prefetch" />
              <span>
                {i18nT("services.add.prefetchOption", undefined, "Also download the package now")}
                <span className={`${HELP_CLASS} block`}>{i18nT("services.add.prefetchHint", undefined, "Starting a service never downloads anything. This is the one explicit download.")}</span>
              </span>
            </label>
          )}
          <ActionFailure failure={failure} />
          <div className="flex justify-end gap-2">
            <button type="button" className={BUTTON_CLASS} onClick={() => setStep("choose")} data-testid="service-add-back">
              {i18nT("common.back", undefined, "Back")}
            </button>
            <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={busy} onClick={confirm} data-testid="service-add-confirm">
              {i18nT("services.add.confirm", undefined, "Add service")}
            </button>
          </div>
        </>
      )}
      {step === "done" && addedId && (
        <>
          <p className="text-sm text-[var(--text-primary)]" data-testid="service-add-done">
            {i18nT("services.add.done", { id: addedId }, "{id} was added. It is not started yet.")}
          </p>
          {prefetchNote && <p className={HELP_CLASS}>{prefetchNote}</p>}
          <div className="flex justify-end">
            <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={() => onAdded(addedId)} data-testid="service-add-open">
              {i18nT("services.add.open", undefined, "Open service")}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
