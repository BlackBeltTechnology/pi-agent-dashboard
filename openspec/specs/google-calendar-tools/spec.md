# google-calendar-tools Specification

## Purpose
Agent tools that read and change a connected account's Google Calendar through Google Connect leases, with every change confirmed by the user.

## Requirements

### Requirement: Calendar read tools
The plugin SHALL provide `gcal_calendars` (list calendars), `gcal_events` (list events of a calendar in a time range, optionally filtered by text), `gcal_event_get` and `gcal_freebusy`. Each tool SHALL take an `account` (alias or email) and require Calendar enabled at level read or higher. Results SHALL include event ids, times with time zone, title, location, attendees and response status.

#### Scenario: Today's events
- **WHEN** the agent calls `gcal_events` for `primary` and today's range
- **THEN** the events of that day are returned with ids and times in the calendar's time zone

#### Scenario: Calendar disabled
- **WHEN** the account has Calendar disabled
- **THEN** the tool fails with `product_disabled` and names Settings → Google

### Requirement: Calendar write tools
The plugin SHALL provide `gcal_event_create`, `gcal_event_update`, `gcal_event_delete` and `gcal_event_respond`, requiring Calendar at level write. Each call SHALL ask the user to confirm, showing the account, calendar, title, start and end, attendees, and whether attendees will be emailed. Guests SHALL NOT be emailed unless the call asks for it. No interactive UI, denial, dismissal or timeout SHALL leave the calendar unchanged.

#### Scenario: Denied create
- **WHEN** the user denies the confirmation for `gcal_event_create`
- **THEN** no event is created and the tool reports the denial

#### Scenario: Silent by default
- **WHEN** a confirmed `gcal_event_create` with attendees does not ask to notify them
- **THEN** the event is created without invitation emails
