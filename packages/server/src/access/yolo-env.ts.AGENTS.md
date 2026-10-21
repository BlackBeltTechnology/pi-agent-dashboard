# yolo-env.ts — index

`parseYoloEnv` + `YOLO_ENV` (`PI_DASHBOARD_GRANT_YOLO`) + `YOLO_UNSCOPED` (task 2b.8, syntax decided with the operator): one plain absolute path, a JSON array of absolute paths for several (a path may contain `:` or `;`, so no delimiter is safe), or the literal `unscoped`. Anything else (`1`, `true`, relative, `[]`, malformed JSON, `UNSCOPED`) is `invalid` and leaves YOLO inactive. Parse only; root resolution and the forbidden rule live in `yolo-session.ts`. See change: add-access-grant-dialog.
