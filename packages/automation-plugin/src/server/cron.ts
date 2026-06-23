/**
 * Re-export of the pure 5-field cron evaluator (now in `../shared/cron.js`)
 * so existing server imports keep working. The implementation moved to
 * `shared/` so the client editor can compute the next-run preview from the
 * same parser the server scheduler uses.
 *
 * See change: add-automation-plugin, redesign-automation-editor-and-board.
 */
export { parseCron, nextFire, isValidCron } from "../shared/cron.js";
