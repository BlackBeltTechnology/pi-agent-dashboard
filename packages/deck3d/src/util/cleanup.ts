/**
 * Release a browser, page or sandbox when its work is already done. Closing is
 * cleanup, never part of the outcome: a rejecting `close()` must not turn a
 * finished command into a failed one, nor replace the real error of an earlier
 * failure. Used in `finally` blocks.
 */
export async function closeQuietly(target: { close(): Promise<unknown> } | undefined): Promise<void> {
  try {
    await target?.close();
  } catch {
    // Nothing useful to do: the work it served has already succeeded or failed on its own terms.
  }
}
