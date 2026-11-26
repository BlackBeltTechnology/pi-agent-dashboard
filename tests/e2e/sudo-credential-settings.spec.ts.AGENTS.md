# sudo-credential-settings.spec.ts — index

L3 (test-plan #S65). Settings ▸ Security `sudo-credential-enabled` toggle: off + Save + reload stays off, `GET /api/config` `data.sudoCredentialPrompt.enabled:false`; on restores defaults (120 s, 5 min) untouched. Operator-armed (`OperatorSession`); resets defaults before/after. See change: add-sudo-credential-prompt.
