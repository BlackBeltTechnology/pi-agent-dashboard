/**
 * The product tool list. To add a product's tools: create `tools/<product>.ts` exporting a `ProductTools`
 * (see `runtime.ts`), then add ONE import line and ONE list entry below — nothing else in the bridge changes.
 * See change: add-google-connect.
 */
import type { ProductTools } from "../runtime.js";
import { gcal } from "./gcal.js";
import { gcontacts } from "./gcontacts.js";
import { gdocs } from "./gdocs.js";
import { gdrive } from "./gdrive.js";
import { gsheets } from "./gsheets.js";
import { gslides } from "./gslides.js";
import { gtasks } from "./gtasks.js";

export const PRODUCT_TOOLS: readonly ProductTools[] = [
  gcal,
  gcontacts,
  gdocs,
  gdrive,
  gsheets,
  gslides,
  gtasks,
];
