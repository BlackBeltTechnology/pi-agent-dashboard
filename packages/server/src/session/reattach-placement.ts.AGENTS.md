# reattach-placement.ts — index

Reattach placement policy: decides how a re-registered session id (`registerReason: "reattach"`, dashboard restart) places in cwd `sessionOrder`. Exports `decideReattachAction` (pure: `always`→moveToFront, `streaming-only`→moveToFront iff streaming, `preserve`→preserve), `applyReattachPolicy`, `ReattachAction` (`"moveToFront"` | `"preserve"`). Pure logic extracted from `applyReattachPolicy`.
