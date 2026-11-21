/**
 * Helper <-> bridge wire format over the 0700-dir unix socket (local only).
 *
 *   helper -> bridge : one JSON line `{"promptText": string, "ppid": number}\n`
 *   bridge -> helper : `OK_MAGIC` + password bytes + `\n`   (answer)
 *                      anything else / EOF                    (refusal: helper exits 1)
 *
 * The answer is raw bytes so the helper never holds the password as a JS string,
 * and a garbage reply can never be mistaken for one: it must carry the magic.
 *
 * See change: add-sudo-credential-prompt (D10).
 */

export const SUDO_HELPER_OK_MAGIC = Buffer.from("PIASKPASS-OK:", "latin1");
/** Bridge refusal frame (anything without the magic is a refusal; this one is explicit). */
export const SUDO_HELPER_REFUSE = Buffer.from("NO\n", "latin1");
/** Largest request line the bridge will buffer from a helper connection. */
export const SUDO_HELPER_MAX_REQUEST_BYTES = 1024 * 1024;
