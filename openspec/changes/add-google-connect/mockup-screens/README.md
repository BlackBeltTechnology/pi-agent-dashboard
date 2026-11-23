# Google accounts — mockup

How connecting Google works for a pi-dashboard user. Read top to bottom: **A** is what almost everyone sees, **B** only matters for companies whose Google admin requires their own sign-in, **C** compares with today.

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

**Step 4.** The dashboard waits. The Google window closes and you come back here automatically — also when the dashboard runs on another computer (via the pi-dashboard.dev return page). A fold-out keeps the paste fallback.

![A2 step 4](a2-connect-4-light.png)

**Step 5.** Done.

![A2 step 5](a2-connect-5-light.png)

**Step 6.** The new account appears in the list.

![A2 step 6](a2-connect-6-light.png)

### A3 · Change what the agent may use
Open an account card and pick a level per Google product. Turning something new on asks Google once, only for that.

**Step 1.** Open the card, set Slides to *Read*.

![A3 step 1](a3-change-1-light.png)

**Step 2.** Google needs your OK for Slides → **Continue with Google**.

![A3 step 2](a3-change-2-light.png)

**Step 3.** Slides is on; everything else unchanged.

![A3 step 3](a3-change-3-light.png)

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

![C1 dark](c1-today-vs-proposed-dark.png)
