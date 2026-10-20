export type OoxmlValidation = { ok: true } | { ok: false; reason: string };
/** Worker-thread validator for the craft-web claims (zip central directory + content types). */
export function validate(bytes: Uint8Array, ext: string): OoxmlValidation;
