# view-message-store.ts — index

`ViewMessageStore` class. Per-session JSON store at `~/.pi/dashboard/view-messages/<sid>.json`. Methods `get(sid) / append(sid, target) / remove(sid)`. Sanitizes sid for filename (strips `..`, `/`). Separate from events.jsonl so agent never observes `/view` rows. Injected into `BrowserHandlerContext.viewMessageStore`. See change: render-file-previews.
