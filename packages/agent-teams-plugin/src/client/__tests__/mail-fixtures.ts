/**
 * Mail fixture helper: an envelope line built WITHOUT core's validation, so hostile or
 * out-of-grammar headers (reserved names, look-alikes, bad kinds) can be tested.
 * See change: add-agent-teams-ui.
 */
import { ENVELOPE_OPEN, ENVELOPE_PEER_NOTE } from "../../shared/mail-format.js";

export const header = (kind: string, sender: string, urgent = false): string => `${ENVELOPE_OPEN}${kind} · from ${sender} · ${ENVELOPE_PEER_NOTE}${urgent ? " · urgent" : ""}]`;
