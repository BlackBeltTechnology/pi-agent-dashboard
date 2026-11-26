/**
 * UI side of `gdrive_pick` (design D9): given the session prompt's `pluginMeta` (`shared/picker.ts`), get a
 * short-lived token from `POST /api/plugins/google/picker-token` (local browsers + built-in accounts only; the
 * server decides), show Google's picker and return the ONE JSON answer for the prompt. The component that mounts
 * this supplies `show` (loads Google's picker script with the key and token). Never throws: every failure is an
 * answer, so the tool never sits out its 5-minute timeout. See change: add-google-connect.
 */
import { encodePickerAnswer, PICKER_KIND, type PickedFile } from "../shared/picker.js";
import { api } from "./ui.js";

export interface PickerHost {
  /** Open Google's picker with `accessToken`; resolves the picked files (empty when the dialog is closed). */
  show(accessToken: string): Promise<PickedFile[]>;
}

type TokenApi = (path: string, init: { method: "POST"; body: string }) => Promise<{ accessToken: string; expiresAt: number }>;

export const isPickerPrompt = (meta: Record<string, unknown> | undefined): meta is Record<string, unknown> & { account: string } =>
  meta?.kind === PICKER_KIND && typeof meta.account === "string" && meta.account !== "";

const WHY = "the Google file picker is only available for the built-in Google app in a browser on the dashboard host";

/** `undefined` when `meta` is not a picker prompt; otherwise the answer text to send for it. */
export async function answerPickerPrompt(meta: Record<string, unknown> | undefined, host: PickerHost, tokenApi: TokenApi = api): Promise<string | undefined> {
  if (!isPickerPrompt(meta)) return undefined;
  let token: string;
  try {
    token = (await tokenApi("/picker-token", { method: "POST", body: JSON.stringify({ account: meta.account }) })).accessToken;
  } catch {
    return encodePickerAnswer({ error: "picker_unavailable", reason: WHY });
  }
  try {
    return encodePickerAnswer({ files: await host.show(token) });
  } catch {
    return encodePickerAnswer({ files: [] });
  }
}
