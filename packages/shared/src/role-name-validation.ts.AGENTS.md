# role-name-validation.ts — index

Shared role-name trust boundary. `isValidRoleName(name, existing) → {ok, reason?}`: non-empty after trim; regex `^[A-Za-z0-9][A-Za-z0-9_-]*$` (no `/`/whitespace/`@`/`.`); collision vs `existing` (add-time only; bridge passes `[]` = syntax-only). Enforced identically on client (inline hint) + bridge (`roles:set`/`roles:remove` reject). See change: add-custom-roles-ui.
