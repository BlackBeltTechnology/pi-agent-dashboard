# src/__tests__/ids.test.ts — index

Review r4 B2: `next-id` starts at 001, persists, never reuses, rejects corrupt file/unknown kind; `seed-ids` takes max of `_ids.json` + catalog ids, legacy package seeding, never lowers. See change: add-reverse-spec-for-rebuild.
