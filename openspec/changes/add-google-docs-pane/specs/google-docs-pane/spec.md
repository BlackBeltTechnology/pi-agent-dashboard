# Spec Delta — google-docs-pane

## Purpose
Show Google-native documents (Docs, Sheets, Slides) in an editor-pane tab through Google's own editor, opened from a pasted URL or a pointer file, inside an isolated, fenced desktop view whose Google session stays out of the dashboard.

## ADDED Requirements

### Requirement: Open a Google document by URL

When the `google-docs` plugin is enabled, it SHALL offer an "Open Google doc…" action that accepts a pasted Google Docs, Sheets or Slides editor URL. The action SHALL open a `gdoc:` pane tab for that document without reading or creating any workspace file.

#### Scenario: Open by URL
- **WHEN** the user pastes `https://docs.google.com/document/d/1AbCdEfGhIjK/edit` into "Open Google doc…"
- **THEN** a pane tab SHALL open for document `1AbCdEfGhIjK`, and no workspace file SHALL be read or created

#### Scenario: Same document focuses its tab
- **WHEN** document `1AbCdEfGhIjK` is already open in a Google tab and the user opens it again by URL
- **THEN** the existing tab SHALL be focused, and no second view SHALL be created

#### Scenario: Pointer to an already-open document
- **WHEN** document `1AbCdEfGhIjK` is open in a Google tab and the user opens a pointer file naming it
- **THEN** after the pointer is read, the existing tab SHALL be focused, the pointer's tab SHALL close, and no second view SHALL be created

#### Scenario: Account-switched link
- **WHEN** the user pastes `https://docs.google.com/spreadsheets/u/1/d/1AbCdEfGhIjK/edit`
- **THEN** a pane tab SHALL open for spreadsheet `1AbCdEfGhIjK`

### Requirement: Pasted URLs are validated

"Open Google doc…" SHALL reject, with a reason and without opening a tab, any URL that:
- is not `https://docs.google.com`;
- has a kind other than document, spreadsheets or presentation;
- has an id or resource key not matching `^[A-Za-z0-9_-]{10,128}$`.

A `drive.google.com` link SHALL be rejected with a hint to paste the document's editor link.

#### Scenario: Foreign host rejected
- **WHEN** the user pastes `https://evil.example/document/d/1AbCdEfGhIjK/edit`
- **THEN** the action SHALL reject it as not a Google document, and no tab SHALL open

#### Scenario: Hostile id rejected
- **WHEN** the pasted URL's id segment is `..%2F..%2Fx`
- **THEN** the action SHALL reject it, and no tab SHALL open

#### Scenario: Drive link rejected with hint
- **WHEN** the user pastes `https://drive.google.com/open?id=1AbCdEfGhIjK`
- **THEN** the action SHALL reject it and tell the user to paste the editor link from the document

### Requirement: The loaded document URL is always constructed

The Google view SHALL load only `https://docs.google.com/<kind>/d/<id>/edit`, built from the validated kind and id. It SHALL append `resourcekey=<key>` when a key is present, and keep a fragment only when it is a sheet (`gid=`), heading (`heading=h.`) or slide (`slide=id.`) anchor. It SHALL never load a pasted or pointer-supplied URL as given.

#### Scenario: Extra query dropped, sheet anchor kept
- **WHEN** the pasted URL is `https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK/edit?usp=sharing&x=<script>#gid=42`
- **THEN** the view SHALL load `https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK/edit#gid=42`

#### Scenario: Resource key kept
- **WHEN** a pointer carries `doc_id` `1AbCdEfGhIjK` and `resource_key` `0-AbCdEfGhIjKl`
- **THEN** the loaded URL SHALL carry `resourcekey=0-AbCdEfGhIjKl`

### Requirement: Pointer files open the Google view

The plugin SHALL redirect `.gdoc`, `.gsheet` and `.gslides` workspace files to its `gdoc:` tab. It SHALL read the pointer through the dashboard's existing file read, with its working-directory containment, and cap it at 64 KiB. The document comes from JSON `url`, else from `doc_id` (plus `resource_key`), ignoring unknown keys. For a bare `doc_id`, the kind SHALL follow the extension. The plugin SHALL never write a pointer file.

#### Scenario: Valid pointer file
- **WHEN** the user opens `budget.gsheet` containing `{"url":"https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK/edit"}`
- **THEN** a `gdoc:` tab SHALL open for spreadsheet `1AbCdEfGhIjK`, and `budget.gsheet` SHALL be unchanged

#### Scenario: Bare doc_id stub
- **WHEN** `notes.gdoc` holds `{"doc_id":"1AbCdEfGhIjK","email":"a@b.c"}`
- **THEN** the tab SHALL show document `1AbCdEfGhIjK` as a Google Doc

#### Scenario: Upper-case extension
- **WHEN** the user opens `BUDGET.GSHEET` holding a valid spreadsheet `url`
- **THEN** the Google tab SHALL open as for `budget.gsheet`

#### Scenario: URL kind wins over extension
- **WHEN** `plan.gsheet` holds a `url` for a Google Doc
- **THEN** the tab SHALL show the Google Doc with a note that the extension does not match the document kind

### Requirement: Invalid pointers load nothing

A pointer SHALL render an error naming the reason, and SHALL load no remote content, when:
- it is not valid JSON;
- it exceeds 64 KiB;
- its read is refused;
- it has neither `url` nor `doc_id`;
- its `url` or id fails validation.

A present but invalid `url` SHALL NOT fall back to `doc_id`. An empty or null `url` or `doc_id` SHALL count as absent.

#### Scenario: Pointer to a foreign host
- **WHEN** the pointer holds `{"url":"https://evil.example/spreadsheets/d/1AbCdEfGhIjK"}`
- **THEN** the tab SHALL show that the address is not a Google document, and SHALL load nothing

#### Scenario: Invalid url does not fall through
- **WHEN** the pointer holds `{"url":"https://evil.example/x","doc_id":"1AbCdEfGhIjK"}`
- **THEN** the tab SHALL show the URL error, and SHALL load nothing

#### Scenario: Malformed pointer
- **WHEN** the pointer file is not valid JSON
- **THEN** the tab SHALL show a parse error, and SHALL load nothing

#### Scenario: Unrecognized shape
- **WHEN** the pointer holds `{"foo":"bar"}`
- **THEN** the tab SHALL show "unrecognized pointer", and SHALL load nothing

### Requirement: The pointer file stays reachable

A pointer-file tab SHALL offer "Show pointer file", which opens the pointer in the normal file viewer while the Google tab stays open.

#### Scenario: Show pointer file
- **WHEN** the user activates "Show pointer file" in the `budget.gsheet` tab
- **THEN** `budget.gsheet` SHALL open as JSON in the normal file viewer, and the Google tab SHALL stay open

### Requirement: The Google view runs only where it can be isolated

The Google view SHALL be offered only in the desktop app's local dashboard window, and only when the app runs with no remote-debugging switch, whether set by the app's debug-CDP option or passed directly. Everywhere else the tab SHALL show the fallback card with the reason.

#### Scenario: Debug CDP on
- **WHEN** the desktop app runs with debug CDP enabled and the user opens a Google tab
- **THEN** the tab SHALL show the fallback card stating the view is unavailable while debug CDP is on, and no Google view SHALL be created

#### Scenario: Raw remote-debugging switch
- **WHEN** the desktop app was started with `--remote-debugging-port=9333` passed directly
- **THEN** no Google view SHALL be created, and the tab SHALL show the fallback card

#### Scenario: Remote server window
- **WHEN** a Google tab is opened in a desktop window showing a remote dashboard server
- **THEN** the tab SHALL show the fallback card

### Requirement: Clients without the view get a fallback

The fallback card SHALL name the document kind and the reason, and offer "Open in Google", which opens the constructed document URL in a new browser tab. The card SHALL load no Google content inside the dashboard page.

#### Scenario: Plain browser client
- **WHEN** a pointer file is opened in a plain browser tab of the dashboard
- **THEN** the tab SHALL show the fallback card, and "Open in Google" SHALL open the constructed URL in a new browser tab

### Requirement: The Google view navigation is fenced

In the Google view, top-level navigation, redirects and subframes SHALL be allowed only to the exact hosts `docs.google.com`, `accounts.google.com`, `drive.google.com` and the operator-configured sign-in hosts. No suffix match SHALL apply. An off-list link, new window or `mailto:` that follows user input in the view within one second SHALL open in the system browser. Any other off-list subframe or unsupported scheme SHALL be dropped.

#### Scenario: External link in a document
- **WHEN** the user clicks a link to `https://example.org` inside a Google Doc in the view
- **THEN** the view SHALL stay on the document, and `https://example.org` SHALL open in the system browser

#### Scenario: Lookalike host
- **WHEN** a subframe navigates to `https://evilgoogleusercontent.com`
- **THEN** the navigation SHALL be dropped

#### Scenario: User-content host refused
- **WHEN** a subframe navigates to `https://sites.google.com/view/x`
- **THEN** the navigation SHALL be dropped

#### Scenario: Federated sign-in host
- **WHEN** the operator added `sso.example.com` to the sign-in hosts and Google sign-in redirects there
- **THEN** the view SHALL load it

### Requirement: Fence hosts are compared after normalization

The fence SHALL compare the parsed, lower-cased, punycode-normalized host name. A URL carrying userinfo or a non-default port SHALL NOT match an allowed host.

#### Scenario: Userinfo trick
- **WHEN** a link in the view targets `https://docs.google.com@evil.example/`
- **THEN** it SHALL NOT be loaded in the view

### Requirement: Off-list redirects are blocked, not launched

A redirect inside the Google view to a host outside the allowed list, or an off-list top-level navigation without user input in the view in the preceding second, SHALL be cancelled. It SHALL NOT be opened automatically anywhere. The tab SHALL show a notice naming the blocked host, with an "Open in browser" action that opens it in the system browser only when the user activates it.

#### Scenario: Redirect off Google
- **WHEN** a navigation inside the view redirects to `https://evil.example`
- **THEN** the view SHALL not load it, nothing SHALL open automatically, and the tab SHALL offer "Open in browser" for `evil.example`

#### Scenario: Script navigation without input
- **WHEN** a script in the view sets `location.href` to `https://evil.example` with no user input in the last second
- **THEN** nothing SHALL open automatically, and the tab SHALL offer "Open in browser"

### Requirement: Sign-in hosts are validated

The operator-configured sign-in hosts SHALL be accepted only as bare lower-case host names: no scheme, path, port or wildcard, and no IP literal. An invalid entry SHALL be refused when settings are saved, with the reason.

#### Scenario: Wildcard refused
- **WHEN** the operator enters `*.example.com` as a sign-in host
- **THEN** the setting SHALL be refused, and nothing SHALL be saved

### Requirement: Google view popups open in the system browser

The Google view SHALL NOT create a secondary app window. A popup to an http(s) or `mailto:` URL SHALL follow the off-list rule: it opens in the system browser when it follows user input in the view within one second, and otherwise gets the "Open in browser" notice. Any other popup SHALL be dropped.

#### Scenario: Popup from a document
- **WHEN** the user clicks a link in the view that calls `window.open("https://example.org")`
- **THEN** no app window SHALL open, and `https://example.org` SHALL open in the system browser

### Requirement: The Google view permissions are default-deny

The Google view SHALL allow clipboard writes and fullscreen, and SHALL deny every other permission request and check without prompting, including clipboard read, camera, microphone, geolocation and notifications. Pasting with the keyboard SHALL still work.

#### Scenario: Camera request denied
- **WHEN** a page in the view requests camera access
- **THEN** the request SHALL be denied without a prompt

#### Scenario: Slides presentation
- **WHEN** the user starts "Present" in Google Slides in the view
- **THEN** the presentation SHALL go fullscreen, and Esc SHALL return to the pane

#### Scenario: Copy and paste work
- **WHEN** the user copies text in a Google Doc in the view and pastes it into another document
- **THEN** the text SHALL be pasted

### Requirement: Downloads from the Google view go to the device

Downloads started in the Google view SHALL show a device save dialog defaulting to the user's Downloads folder. The view SHALL never write a download anywhere without that dialog, and SHALL never open it in an editor.

#### Scenario: Native document downloaded as Office file
- **WHEN** the user picks File → Download → Microsoft Word on a Google Doc in the view
- **THEN** a device save dialog SHALL appear defaulting to Downloads, and the file SHALL NOT open in any editor

### Requirement: The Google session is isolated from the dashboard

The Google view's cookies and storage SHALL never be readable by the dashboard page or sent to the dashboard server. A dashboard window SHALL be able to control only the views it created, and only by a document reference that the desktop app validates again. Arbitrary URLs SHALL never be accepted. Settings SHALL offer a sign-out that clears the view's Google session, unless a view still has unsaved edits.

#### Scenario: Dashboard page cannot see Google cookies
- **WHEN** the user is signed in to Google in the view
- **THEN** the dashboard page SHALL have no access to the view's cookies, and no dashboard server request SHALL carry them

#### Scenario: Sign out
- **WHEN** the user activates "Sign out of Google in the dashboard view" with no unsaved Google edits
- **THEN** the next Google view SHALL show Google sign-in

#### Scenario: Sign out while saving
- **WHEN** a live Google view blocks unloading and the user activates sign-out
- **THEN** nothing SHALL be cleared, and the user SHALL be told to wait for Google to finish saving

#### Scenario: Hostile document reference refused
- **WHEN** a dashboard page asks the desktop app to show kind `../x` or id `a/b`
- **THEN** no view SHALL be created

### Requirement: Live Google views are bounded without losing edits

At most three Google views SHALL be live per dashboard window. Opening a fourth SHALL release the least recently active view that had no user input in the last 10 seconds and whose page does not block unloading. If no view can be released, no fourth view SHALL be created, and the user SHALL be told to close a Google tab. A released view SHALL reload its document when its tab is shown again.

#### Scenario: Fourth view
- **WHEN** three Google tabs are live, all saved, and the user opens a fourth
- **THEN** the least recently active view SHALL be released, and activating its tab SHALL reload it

#### Scenario: Unsaved view kept
- **WHEN** the least recently active view's page blocks unloading
- **THEN** that view SHALL stay live, and the next candidate SHALL be released instead

#### Scenario: Recently edited view kept
- **WHEN** the least recently active view received a keystroke 3 seconds ago
- **THEN** that view SHALL NOT be released

### Requirement: Google views close with an unload check

Closing a Google tab whose page blocks unloading SHALL keep the tab open and tell the user the document is still saving. Disabling the plugin, reloading the dashboard page or closing the window SHALL release that window's views after at most one 5-second retry. No view SHALL outlive its dashboard page.

#### Scenario: Close while saving
- **WHEN** the user closes a Google tab whose page blocks unloading
- **THEN** the tab SHALL stay open with a "still saving" notice

#### Scenario: Dashboard page reload
- **WHEN** the dashboard page reloads while two Google views are live
- **THEN** both views SHALL be released, and the reloaded page SHALL be able to open three new Google views

### Requirement: Dashboard overlays stay visible above the Google view

While any dashboard or plugin dialog, menu, listbox or popover overlaps the pane, the Google view SHALL NOT cover it. The pane SHALL show an opaque placeholder instead. No image of the Google page SHALL be captured into the dashboard page.

#### Scenario: Dialog over a Google tab
- **WHEN** a confirmation dialog opens while a Google tab is active
- **THEN** the dialog SHALL be fully visible and interactive, and the pane SHALL show the placeholder until the dialog closes

#### Scenario: Plugin dialog over a Google tab
- **WHEN** another plugin opens a modal dialog overlapping the pane while a Google tab is active
- **THEN** the dialog SHALL be fully visible and interactive

### Requirement: Google view outcomes are observable without content

The plugin SHALL count view outcomes from a fixed set, covering opens, fallbacks by reason, pointer errors by reason, attach failures, blocked budget, fenced and blocked navigations, denied permissions, downloads and releases, including releases after a tab closed. It SHALL reject unknown outcomes, and SHALL never send or log document ids, URLs, hosts or file paths.

#### Scenario: Fenced navigation is counted
- **WHEN** a navigation to a non-Google host is sent to the system browser
- **THEN** the fenced-external count SHALL increase, and no log line SHALL contain the URL or host
