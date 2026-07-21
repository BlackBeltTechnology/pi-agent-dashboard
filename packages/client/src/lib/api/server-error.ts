/**
 * Zone-3 code-mapping resolver (change: make-all-ui-text-i18n).
 *
 * Server/extension/shared emit user-facing failures as `{ code, vars?, message? }`
 * where `code` is a stable machine classifier (e.g. `"PREFLIGHT_FAILED"`,
 * `"git.not_a_repo"`). The client maps the code to an `err.<domain>.<code>`
 * catalog key and renders it in the active language. When no client mapping
 * exists, the server-provided English `message` is shown — never a bare code.
 */
import { t as standaloneT } from "../i18n/i18n.js";

type Vars = Record<string, string | number>;
type Translator = (key: string, vars?: Vars, fallback?: string) => string;

export interface CodedMessage {
  code?: string;
  vars?: Vars;
  message?: string;
}

/**
 * Normalise a server code into the `err.*` key namespace. Accepts both dotted
 * (`git.not_a_repo`) and SCREAMING_SNAKE (`PREFLIGHT_FAILED`) forms and lowers
 * them to `err.<code>` with dots preserved as domain separators.
 */
export function errKeyForCode(code: string): string {
  const normalized = code
    .trim()
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
  return `err.${normalized}`;
}

/**
 * Resolve a coded server message to display text in the active language.
 * Order: `err.<code>` translation → server `message` → the (normalised) code.
 * Pass a bound translator (`useI18n().t`) inside components; omit it to use the
 * standalone module-level `t()` for non-component call sites (toasts/handlers).
 */
export function resolveServerMessage(input: CodedMessage, translate: Translator = standaloneT): string {
  const { code, vars, message } = input;
  if (code) {
    const key = errKeyForCode(code);
    // t() returns the key itself when unmapped; detect that to fall back to
    // the server message (graceful degradation, never a bare code).
    const resolved = translate(key, vars, message ?? key);
    if (resolved !== key) return resolved;
  }
  if (message) return message;
  return code ?? "";
}
