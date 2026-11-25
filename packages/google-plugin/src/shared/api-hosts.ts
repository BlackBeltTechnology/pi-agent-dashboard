/**
 * REST base URL of each product's Google API. With the loopback test override (`PI_E2E_GOOGLE_BASE_URL`,
 * see `endpoints.ts`) every API hangs off the one fake-Google origin at `<origin>/<path>`; otherwise the real
 * hosts. Paths carry the API version, no trailing slash. See change: add-google-connect.
 */
import type { GoogleEndpoints } from "./endpoints.js";
import type { Product } from "./products.js";

const REAL: Readonly<Record<Product, string>> = {
  gmail: "https://gmail.googleapis.com/gmail/v1",
  calendar: "https://www.googleapis.com/calendar/v3",
  drive: "https://www.googleapis.com/drive/v3",
  docs: "https://docs.googleapis.com/v1",
  sheets: "https://sheets.googleapis.com/v4",
  slides: "https://slides.googleapis.com/v1",
  tasks: "https://tasks.googleapis.com/tasks/v1",
  contacts: "https://people.googleapis.com/v1",
};

/** Path under the fake-Google origin when overridden. */
const FAKE_PATH: Readonly<Record<Product, string>> = {
  gmail: "/gmail/v1",
  calendar: "/calendar/v3",
  drive: "/drive/v3",
  docs: "/docs/v1",
  sheets: "/sheets/v4",
  slides: "/slides/v1",
  tasks: "/tasks/v1",
  contacts: "/people/v1",
};

export function apiBase(product: Product, endpoints: GoogleEndpoints): string {
  return endpoints.overridden ? `${endpoints.issuer}${FAKE_PATH[product]}` : REAL[product];
}
