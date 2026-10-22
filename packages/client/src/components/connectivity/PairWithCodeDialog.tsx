/**
 * Browser "Pair with code…" dialog (Settings ▸ Servers, pair action of a card that is reached only
 * through tunnel / public routes).
 *
 * The pasted pairing text is checked LOCALLY (`resolvePairWithCode`): it must be a pairing payload
 * for THIS card's fingerprint and name at least one valid `https` origin. Only then is a new
 * browsing context opened (`noopener`) at `<origin>/pair#<payload>`; the existing landing on that
 * origin proves the payload's fingerprint before it redeems anything. Nothing is fetched here and
 * nothing is opened before the local check passes. A browser never compares fingerprints by eye.
 *
 * See change: group-servers-by-identity (D8, test-plan #F8).
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { mdiAlertCircleOutline, mdiQrcode } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type FormEvent, useId, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { openExternalUrl } from "../../lib/nav/safe-navigation.js";
import { type PairWithCodeRefusal, resolvePairWithCode } from "../../lib/pairing/pair-with-code.js";
import { callout, HELP, INPUT, LABEL } from "./connectivity-ui.js";

function refusalText(reason: PairWithCodeRefusal, name: string): string {
  switch (reason) {
    case "malformed":
      return i18nT("connection.pairCode.malformed", undefined, "That is not a pairing text. Paste the deep link or the pi:pair:v1… string.");
    case "wrong-server":
      return i18nT("connection.pairCode.wrongServer", { name }, "That pairing text is for a different server than {name}. Nothing was opened.");
    case "no-https-origin":
      return i18nT("connection.pairCode.noHttpsOrigin", { name }, "That pairing text names no usable https address for {name}. Nothing was opened.");
  }
}

export interface PairWithCodeDialogProps {
  /** Card title, used in copy. */
  name: string;
  /** The card's fingerprint — the only identity a pasted payload may carry. */
  fingerprint: string;
  onClose: () => void;
}

export function PairWithCodeDialog({ name, fingerprint, onClose }: PairWithCodeDialogProps) {
  const [text, setText] = useState("");
  const [refusal, setRefusal] = useState<PairWithCodeRefusal | null>(null);
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const target = resolvePairWithCode(text, fingerprint);
    if (!target.ok) {
      setRefusal(target.reason);
      return;
    }
    setRefusal(null);
    openExternalUrl(target.url);
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title={i18nT("connection.pairCode.title", { name }, "Pair with {name}")} icon={mdiQrcode} size="md" testId="pair-with-code-dialog">
      <form className="space-y-3" onSubmit={submit}>
        <p className="text-sm text-[var(--text-secondary)]">
          {i18nT(
            "connection.pairCode.intro",
            { name },
            "{name} is not reachable on this network. On that server, the owner opens Gateway and shows a pairing code; paste its text here.",
          )}
        </p>
        <div>
          <label htmlFor={inputId} className={LABEL}>
            {i18nT("connection.pairCode.label", undefined, "Pairing text")}
          </label>
          <input
            id={inputId}
            type="text"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="pi:pair:v1.…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setRefusal(null);
            }}
            aria-invalid={refusal ? true : undefined}
            aria-describedby={refusal ? `${helpId} ${errorId}` : helpId}
            className={`${INPUT} font-mono`}
          />
          <p id={helpId} className={`mt-1 ${HELP}`}>
            {i18nT("connection.pairCode.help", undefined, "It must belong to this server — anything else is refused before any page is opened.")}
          </p>
        </div>
        {refusal && (
          <div id={errorId} className={callout("error")} role="alert">
            <Icon path={mdiAlertCircleOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">{refusalText(refusal, name)}</div>
          </div>
        )}
        <Dialog.Footer>
          <Dialog.Cancel onClick={onClose}>{i18nT("common.cancel", undefined, "Cancel")}</Dialog.Cancel>
          <Dialog.Action onClick={() => submit()} disabled={!text.trim()} testId="pair-with-code-submit">
            {i18nT("connection.pairCode.submit", undefined, "Pair")}
          </Dialog.Action>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}
