# ask-user-attachments.ts — index

Persist image attachments for ask_user input responses. Exports `attachmentDirForSession`, `persistAttachment`, `cleanupAttachmentsForSession`, `hashBytes`, `extensionForMime`, `MAX_PER_IMAGE_BYTES`, `MAX_PER_MESSAGE_BYTES`, `PersistedAttachment`. Writes content-addressed images to `~/.pi/dashboard/attachments/<sessionId>`; idempotent on hash.
