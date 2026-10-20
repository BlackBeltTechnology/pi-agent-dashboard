# SupervisedModeSection.tsx — index

Settings ▸ Security ▸ *Tool approval (Supervised mode)*. Draft-bound `supervisedMode`: default-mode select, timeout (whole 10–3600; invalid → field error + `onInvalidChange(true)` disables Save; `parseSupervisedTimeout`), editable tool chips (add/remove, case-insensitive dedupe), NO allow-list field (E45). Warns when ask_user timeout undercuts it: `undercutEffectiveSeconds` = `min(supervised, askUser−1)`. Hint names allow-first gap (`ctx_execute`). Copy: not a sandbox, container for isolation. See change: add-supervised-tool-approval.
