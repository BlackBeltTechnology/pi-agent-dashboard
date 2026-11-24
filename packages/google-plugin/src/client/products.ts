/**
 * Client-side product display data over the shared catalogue (levels, order, built-in flags come from
 * `../shared/products.ts`; only names and English level labels live here). Pure, no React.
 * See change: add-google-connect.
 */
import { CATALOGUE, PRODUCTS, type Product } from "../shared/products.js";

export { PRODUCTS, type Product };

export const PRODUCT_NAME: Record<Product, string> = {
  gmail: "Gmail",
  calendar: "Calendar",
  drive: "Drive",
  docs: "Docs",
  sheets: "Sheets",
  slides: "Slides",
  tasks: "Tasks",
  contacts: "Contacts",
};

export const PRODUCT_WHAT: Record<Product, string> = {
  gmail: "Search, read, draft and send mail",
  calendar: "Events and free/busy",
  drive: "Find, export and upload files",
  docs: "Documents",
  sheets: "Spreadsheets",
  slides: "Presentations",
  tasks: "Task lists",
  contacts: "People and email addresses",
};

/** English label per `<product>.<level>`; the access select shows these. */
const LEVEL_LABEL: Record<string, string> = {
  "gmail.readonly": "Read",
  "gmail.draft": "Read and draft",
  "gmail.send": "Read, draft and send",
  "drive.files": "Files I pick or create",
  "drive.read": "Read all",
  "drive.write": "Read and change all",
};

function levelLabel(product: Product, level: string): string {
  return LEVEL_LABEL[`${product}.${level}`] ?? (level === "write" ? "Read and change" : "Read");
}

export interface LevelChoice {
  id: string;
  label: string;
  /** The built-in app never offers this level (full Drive). */
  ownClientOnly: boolean;
}

export function levelChoices(product: Product): LevelChoice[] {
  const def = CATALOGUE.find((p) => p.id === product);
  return (def?.levels ?? []).map((l) => ({ id: l.id, label: levelLabel(product, l.id), ownClientOnly: !l.builtin }));
}

/** The lowest level of a product (what a fresh connect asks for: read-only, Drive at `files`). */
export function lowestLevel(product: Product): string {
  return CATALOGUE.find((p) => p.id === product)?.levels[0]?.id ?? "read";
}

/** Names of the products that are on, catalogue order, or `null` when none. */
export function productNames(on: Partial<Record<Product, unknown>>): string[] {
  return PRODUCTS.filter((p) => on[p]).map((p) => PRODUCT_NAME[p]);
}

/** The domain of an email, lower-case and exact (no suffix guessing); `undefined` when there is none. */
export function emailDomain(email: string | undefined): string | undefined {
  const e = email?.trim().toLowerCase();
  const at = e ? e.lastIndexOf("@") : -1;
  return e && at > 0 && at < e.length - 1 ? e.slice(at + 1) : undefined;
}
