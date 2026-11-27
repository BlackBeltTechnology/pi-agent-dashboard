# user-actions.ts — index

`createUserActions`: `stopMember` (store pre-checks ⇒ `team_closed`/`not_found`/`not_connected`/`not_busy`; pending-stop guard ⇒ repeat is `{aborted:true}` with no second abort; `abortMember({actor:'user', notify:false})`; one waking coalesced lead notice with owned task ids only, ≤10 then `+N more`) and `shutdownTeam` (closed ⇒ 409; closing/in-flight ⇒ 202 without `teamDelete`; non-waking notice `team shut down by the user`, then `teamDelete({actor:'user', force:true})`). Pure; the route logs outcomes. See change: add-agent-teams-ui.
