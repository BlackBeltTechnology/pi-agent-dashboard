# __tests__/credential-migration.test.ts — index

L1 startup migration of plaintext credential files over test codecs / singleton + stub keychain: E9 no marker on disk (UTF-16/base64 too), E42 vault migrates, E43 no plaintext copy + `.corrupt-*` sha unchanged, E44 late plaintext encrypted by next write, E45 no key / locked / corrupt left untouched with log lines, X7 verify mismatch, X8 rename EIO retried by next write, X9 racing writer. See change: encrypt-credentials-at-rest.
