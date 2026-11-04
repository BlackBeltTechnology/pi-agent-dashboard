// Waits up to 60 s, returning early when the run is aborted (the next step's
// segment check then ends the run `aborted`).
// Plain JS syntax (valid TS) so any loader runs it. See change: update-flows-plugin (F7).
export default async function (_input, ctx) {
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 60_000);
    ctx?.signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve(undefined);
    });
  });
  return {};
}
