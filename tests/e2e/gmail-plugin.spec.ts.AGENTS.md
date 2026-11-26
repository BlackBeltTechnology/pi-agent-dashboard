# gmail-plugin.spec.ts — index

L3 gmail-plugin vs in-container fake Google (`helpers/fake-google.ts`, `helpers/google-connect.ts`). Account/client/setup management moved to the `google` plugin (add-google-connect D10); every case seeds an own installed client + account over `/api/plugins/google/*` and drives Settings → Google accounts (paste-fallback consent). Gmail tools lease through it.

Cases (describe `google accounts: product changes and the Gmail pointer (L3)`): A100 narrower consent reply changes nothing; A111 Slides read reuses the dialog; B137 removed Gmail management routes answer `410 {error:"moved"}`, `GET state` 200 `{moved:true}`; F1 one readonly/ok row; F2 two accounts keep own Gmail level; F3 raise re-consents, lower is immediate; F4 disconnect cancel/revoke/Google-down notice; F5 `gmail_send` confirm card sends once; F6 dead grant → `reauth_required` in tool + `google-account-status` badge; F3 (filters) toggle re-consents with `gmail.settings.basic`, `gmail_filter_create` → one filter; B140 Gmail notice links to Google accounts. Plus BE106 paired-device `origin_denied` from `gmail/lease` + `gmail/accounts`.

Removed with the Gmail wizard (no replacement, behaviour gone by design): old F1–F6 wizard/REST form, setup-ux F2 (project id / owner), auto-setup F5 (setup/run states). 503 `google_connect_unavailable` is L1 only (B138).
