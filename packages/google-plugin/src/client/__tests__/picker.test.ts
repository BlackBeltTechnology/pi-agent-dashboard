/**
 * L1 UI-side hook of `gdrive_pick` (design D9; tasks 3.8, 12.44–12.47): token route → Google picker → one JSON
 * answer for the session prompt. The server rules (local browser + built-in account) are proven in
 * `server/__tests__/routes.test.ts`; here the token route is a stub that answers like it. See change: add-google-connect.
 */
import { describe, expect, it, vi } from "vitest";
import { parsePickerAnswer, pickerPluginMeta } from "../../shared/picker.js";
import { answerPickerPrompt, isPickerPrompt } from "../picker.js";

const meta = pickerPluginMeta({ sub: "s1", email: "a@x.com" });
const budget = { id: "1AbC_d-9", name: "Budget 2026", mimeType: "application/vnd.google-apps.spreadsheet" };
const unavailable = () => Promise.reject(Object.assign(new Error("picker_unavailable"), { code: "picker_unavailable", status: 403 }));

describe("answerPickerPrompt", () => {
  it("ignores prompts that are not a picker prompt", async () => {
    const show = vi.fn();
    expect(isPickerPrompt({ kind: "browser-takeover" })).toBe(false);
    expect(await answerPickerPrompt({ kind: "browser-takeover" }, { show }, vi.fn())).toBeUndefined();
    expect(show).not.toHaveBeenCalled();
  });

  it("local built-in: fetches a token for the prompt's account, shows the picker, answers the picked files", async () => {
    const token = vi.fn(async () => ({ accessToken: "PICKER-TOKEN", expiresAt: 5 }));
    const show = vi.fn(async () => [budget]);
    const answer = await answerPickerPrompt(meta, { show }, token);
    expect(token).toHaveBeenCalledWith("/picker-token", { method: "POST", body: JSON.stringify({ account: "s1" }) });
    expect(show).toHaveBeenCalledWith("PICKER-TOKEN");
    expect(parsePickerAnswer(answer)).toEqual({ files: [budget] });
  });

  it("remote / own client (token route 403 picker_unavailable): the picker is never shown; answer says unavailable", async () => {
    const show = vi.fn();
    const answer = await answerPickerPrompt(meta, { show }, unavailable);
    expect(show).not.toHaveBeenCalled();
    expect(parsePickerAnswer(answer)).toMatchObject({ error: "picker_unavailable" });
  });

  it("any other token failure is also reported as unavailable (the tool must not wait for the timeout)", async () => {
    const show = vi.fn();
    const answer = await answerPickerPrompt(meta, { show }, () => Promise.reject(new Error("HTTP 500")));
    expect(show).not.toHaveBeenCalled();
    expect(parsePickerAnswer(answer)).toMatchObject({ error: "picker_unavailable" });
  });

  it("closed dialog or a picker that throws → empty selection", async () => {
    const token = async () => ({ accessToken: "T", expiresAt: 1 });
    expect(parsePickerAnswer(await answerPickerPrompt(meta, { show: async () => [] }, token))).toEqual({ files: [] });
    expect(parsePickerAnswer(await answerPickerPrompt(meta, { show: () => Promise.reject(new Error("blocked")) }, token))).toEqual({ files: [] });
  });
});

describe("parsePickerAnswer (browser input is bounded)", () => {
  it("drops unusable entries, caps the list, defaults the mime type", () => {
    const raw = JSON.stringify({ files: [{ id: "ok1", name: "n", mimeType: "bad" }, { id: "../x" }, { name: "no id" }, null, ...Array.from({ length: 80 }, (_, i) => ({ id: `f${i}`, name: "x", mimeType: "text/plain" }))] });
    const out = parsePickerAnswer(raw);
    expect("files" in out && out.files).toHaveLength(50);
    expect("files" in out && out.files[0]).toEqual({ id: "ok1", name: "n", mimeType: "application/octet-stream" });
  });
  it.each([undefined, "", "not json", "null", "[]", '{"files":"x"}'])("garbage %j → nothing picked", (raw) => {
    expect(parsePickerAnswer(raw)).toEqual({ files: [] });
  });
});
