# start-prepare.ts — index

`prepareStart`: everything before a team exists — goal check, template load (cache dropped), playbook render + cap, hook trust (`hooks_untrusted`/`hash_mismatch`), profile `preflight`; returns `createTeam` input + snapshot. A refusal leaves nothing. See change: add-agent-teams-templates-hooks.
