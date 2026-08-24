/**
 * Typed backend error for the grammar service. Backends throw this so the
 * service/route can map `code` → HTTP status without leaking provider bodies.
 * See change: add-composer-grammar-check.
 */
import type { GrammarErrorCode } from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";

export class GrammarBackendError extends Error {
  readonly code: GrammarErrorCode;
  constructor(code: GrammarErrorCode, message?: string) {
    super(message ?? code);
    this.name = "GrammarBackendError";
    this.code = code;
  }
}
