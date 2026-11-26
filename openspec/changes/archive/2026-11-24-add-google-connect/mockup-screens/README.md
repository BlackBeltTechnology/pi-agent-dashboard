# Google accounts — mockup

How connecting Google works for a pi-dashboard user. Read top to bottom: **A** is what almost everyone sees, **B** only matters for companies whose Google admin requires their own sign-in, **D** is the dashboard opened from another computer, **C** compares with today.

Green numbered rings mark what is new. Google's own pages in A2 are drawn only for orientation — Google shows them, not the dashboard.

---

## A. What most users see

### A1 · The Google accounts page
Your own Google accounts (as many as you like), one **Connect another Google account** button. Organisation setup is folded away under *Advanced*.

![A1](a1-page-light.png)

### A2 · Connect another Google account
Same as connecting Google Drive or Gmail in other apps.

**Step 1.** Click **Connect another Google account**.

![A2 step 1](a2-connect-1-light.png)

**Step 2.** Tick what the agent may use (read-only to start) → **Continue with Google**.

![A2 step 2](a2-connect-2-light.png)

**Step 3.** Google opens its own page: pick any of your Google accounts and allow access.

![A2 step 3](a2-connect-3-light.png)

**Step 4.** The dashboard waits. The Google window closes and you come back here automatically. A fold-out keeps the paste fallback. (From another computer this goes through a confirm page — see D1.)

![A2 step 4](a2-connect-4-light.png)

**Step 5.** Done.

![A2 step 5](a2-connect-5-light.png)

**Step 6.** The new account appears in the list.

![A2 step 6](a2-connect-6-light.png)

### A3 · Change what the agent may use
Open an account card and pick a level per Google product. Turning something new on asks Google once, only for that.

**Step 1.** Open the card, set Slides to *Read*. Drive offers only *Files you pick* with the built-in sign-in (ring 10); reading all Drive files needs an organisation's own sign-in. Ring 9 states who may use the account: the dashboard enforces the levels, not Google.

![A3 step 1](a3-change-1-light.png)

**Step 2.** Google needs your OK for Slides → **Continue with Google**.

![A3 step 2](a3-change-2-light.png)

**Step 3.** Slides is on; everything else unchanged.

![A3 step 3](a3-change-3-light.png)

### A4 · Google's page unticked something the agent already uses
If you untick Gmail on Google's page while allowing Calendar, nothing is stored: Gmail keeps working, Calendar stays off.

**Step 1.** Only Calendar was allowed on Google's page.

![A4 step 1](a4-narrower-1-light.png)

**Step 2.** Nothing changed — try again and tick every box.

![A4 step 2](a4-narrower-2-light.png)

### A5 · Disconnect an account
Disconnect deletes the account from this dashboard. Removing access at Google is a separate tick, because it ends access for every dashboard using pi-dashboard with that Google account.

**Step 1.** Click **Disconnect** on the card.

![A5 step 1](a5-disconnect-1-light.png)

**Step 2.** Confirm (local only by default).

![A5 step 2](a5-disconnect-2-light.png)

**Step 3.** Optionally also remove access at Google.

![A5 step 3](a5-disconnect-3-light.png)

**Step 4.** If Google can't be reached, the account is still removed here and you get the link to remove it yourself.

![A5 step 4](a5-disconnect-4-light.png)

### A6 · The agent asks for a Drive file
With Drive at *Files you pick*, the agent asks; you choose the file in Google's own picker.

**Step 1.** The agent's request in the session.

![A6 step 1](a6-drive-pick-1-light.png)

**Step 2.** Google's file picker (drawn for orientation; Google shows it).

![A6 step 2](a6-drive-pick-2-light.png)

**Step 3.** The agent may now read that file.

![A6 step 3](a6-drive-pick-3-light.png)

---

## B. Organisations only (most users never open this)

### B1 · Organisation sign-in
For a company whose Google Workspace admin requires its own Google Cloud sign-in: open *Advanced*, add the organisation's file and email domain.

**Step 1.** Open *Advanced: organisation sign-in*.

![B1 step 1](b1-org-1-light.png)

**Step 2.** Add the organisation (name, company domain, client file from the admin).

![B1 step 2](b1-org-2-light.png)

**Step 3.** Accounts of that domain now show “organisation sign-in: BlackBelt”.

![B1 step 3](b1-org-3-light.png)

### B2 · Connecting when an organisation is set up
Only then does the dialog show a *Sign in with* choice.

![B2](b2-connect-with-org-light.png)

### B3 · A company blocks pi-dashboard.dev
Plain message: ask the admin, or set up organisation sign-in.

![B3](b3-company-blocks-light.png)

---

## D. Dashboard opened from another computer
Dashboard on a server, in Docker, or reached through a tunnel. Gmail and reading all Drive files need the dashboard's own computer or an organisation sign-in.

### D1 · Connect from another computer

**Step 1.** Gmail is shown as not available here, with the reason (ring 11). The first data-use line names the pi-dashboard.dev return page (ring 12).

![D1 step 1](d1-remote-connect-1-light.png)

**Step 2.** Google's page — no Gmail requested.

![D1 step 2](d1-remote-connect-2-light.png)

**Step 3.** The dashboard waits and tells you what comes next.

![D1 step 3](d1-remote-connect-3-light.png)

**Step 4.** Google returns to `pi-dashboard.dev/oauth/return.html`. It shows your dashboard's address; the sign-in is handed over only after you click **Continue** (ring 13).

![D1 step 4](d1-remote-connect-4-light.png)

**Step 5.** The window opens your dashboard and says it's connected.

![D1 step 5](d1-remote-connect-5-light.png)

**Step 6.** The dialog shows the result.

![D1 step 6](d1-remote-connect-6-light.png)

**Step 7.** The account is listed (Calendar and Drive files, no Gmail).

![D1 step 7](d1-remote-connect-7-light.png)

### D2 · Return page when something is off

**Step 1.** This browser can't reach the dashboard: copy the address and paste it in the dialog.

![D2 step 1](d2-return-page-off-1-light.png)

**Step 2.** The page was loaded inside another page: it refuses.

![D2 step 2](d2-return-page-off-2-light.png)

### D3 · An account connected on the dashboard's own computer, used from elsewhere

**Step 1.** Changing what the agent may use needs the dashboard's own computer.

![D3 step 1](d3-local-only-1-light.png)

**Step 2.** So does picking Drive files.

![D3 step 2](d3-local-only-2-light.png)

---

## C. Compared with today

### C1 · Today vs proposed
Left (red): today you first build your own Google Cloud app, and only Gmail works. Right (green): connect any Google account.

![C1](c1-today-vs-proposed-light.png)

### C2 · The Gmail section after the update
Gmail moved into Google accounts; nothing to reconnect.

![C2](c2-gmail-after-move-light.png)

### C3 · Phone

![C3](c3-phone-light.png)

---

## Dark theme

![A1 dark](a1-page-dark.png)

![A2 step 2 dark](a2-connect-2-dark.png)

![A3 step 1 dark](a3-change-1-dark.png)

![D1 step 1 dark](d1-remote-connect-1-dark.png)

![D1 step 4 dark](d1-remote-connect-4-dark.png)

![C1 dark](c1-today-vs-proposed-dark.png)
