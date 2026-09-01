/**
 * Hungarian UI dictionary and HU formatting conventions.
 *
 * Hungarian is OPT-IN via an explicit `locale` (design D14): because the skill
 * is user-global it must not assume the Hungarian archive, so these conventions
 * are never an ambient default.
 */
import type { UiDictionary } from "./dictionary.js";

export const hu: UiDictionary = {
  required: "Kötelező",
  optional: "Nem kötelező",
  requiredMarker: "*",
  allFieldsRequired: "Az űrlap minden mezője kötelező.",
  optionalHint: "A nem kötelezőként jelölt mezők üresen hagyhatók.",
  next: "Tovább",
  previous: "Vissza",
  submit: "Beküldés",
  addItem: "Hozzáadás",
  removeItem: "Eltávolítás",
  clear: "Törlés",
  errorSummaryTitle: "Hiba történt",
  computedValue: "Számított érték",
  computedHint: "Ez az érték automatikusan számított, nem szerkeszthető.",
  disabledHint: "Ez a mező csak olvasható.",
  apiUnsupported: "A távoli beállítás-betöltés nem támogatott; ez a mező le van tiltva.",
  fileTooLarge: (limitMb) => `A fájl túl nagy. A megengedett legnagyobb méret ${limitMb} MB.`,
  fileTypeRejected: (accepted) => `Ez a fájltípus nem engedélyezett. Elfogadott típusok: ${accepted}.`,
  revealedAnnouncement: (label) => `A(z) ${label} mező most megjelent.`,
  revealedReason: "A korábbi válaszai alapján jelent meg.",
  noOptions: "Nincs elérhető lehetőség.",
  matrixRowLabel: "Sor",
  selectPlaceholder: "Válasszon…",
  formLevelErrors: "A folytatás előtt tekintse át a következőket:",
};

// --- HU formatting conventions -------------------------------------------

/** Hungarian date format: YYYY. MM. DD. for display; storage stays YYYY-MM-DD. */
export const HU_DATE_DISPLAY_FORMAT = "YYYY. MM. DD.";

/** Format a HUF amount the Hungarian way: "1 234 567 Ft". */
export function formatHuf(amount: number): string {
  const grouped = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 }).format(amount);
  return `${grouped} Ft`;
}

/** Optional HU input masks (opt-in; documented in references/hu-locale.md). */
export const HU_MASKS = {
  /** Tax ID (adóazonosító jel): 10 digits. */
  taxId: "##########",
  /** Postal code (irányítószám): 4 digits. */
  postalCode: "####",
  /** Phone: +36 ## ### ####. */
  phone: "+36 ## ### ####",
} as const;
