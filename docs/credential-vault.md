# Credential vault

Status: D4B design accepted on 2026-11-17. Implementation completed on
2026-11-18. Independent security review not started. This document describes the
implemented optional passphrase-encrypted BYOK vault. It is not a workspace
encryption document and makes no independent security claim.

Binding decisions are in ADR 0011. The AI architecture is in
[ai-provider-architecture.md](./ai-provider-architecture.md). The release gate is
[ai-security-review.md](./ai-security-review.md).

## Scope

The credential vault stores provider credentials at rest when the user chooses
the optional passphrase-protected mode.

- Session-only credentials are the default.
- The vault is optional and off until the user sets it up.
- D4B has no recovery. Losing the vault passphrase loses stored credentials.
- Workspace recovery, backup restore, and workspace key rotation never open the
  vault.
- The vault passphrase never opens workspace content or a backup.
- Extension code never receives a vault handle or a raw secret.
- There is no server-side escrow and no hosted recovery service.

The vault does not store workspace data, notes, files, prompts, responses, or AI
chat history.

## Threat model

The vault protects credentials from plaintext storage in IndexedDB or
localStorage. It does not protect against:

- XSS or a compromised page while the vault is unlocked.
- Malicious browser extensions with page access.
- A compromised device or operating system.
- Provider-side retention after a request is sent.
- Reliable JavaScript memory zeroization.
- Offline guessing against a copied vault record beyond the KDF cost and
  rate-limit metadata.

The vault never stores a passphrase hint, recovery key, raw DEK, raw CEK, or
plaintext secret. Rate limiting raises the cost of normal UI guessing; it does not
protect a copied record from offline guessing.

## Key hierarchy

```text
passphrase
  -> PBKDF2-SHA-256(salt, iterations >= 600000)
  -> HKDF-SHA-256(info = "opennest:credential-vault-kek:v1")
  -> vault KEK

vault DEK (random 256-bit)
  -> wrapped by the vault KEK with AES-256-GCM
  -> stored in the vault record

entry CEK (random 256-bit, fresh per create or update)
  -> wrapped by the vault DEK with AES-256-GCM
  -> used once to encrypt one credential secret

credential secret
  -> encrypted by the entry CEK with a fresh 96-bit nonce
```

D4B uses no recovery key. A future vault-only recovery key would require a
separate approval and must wrap only the vault DEK. It must remain independent of
the workspace recovery key and the backup recovery key.

### Constants

| Name                           | Value                                  |
| ------------------------------ | -------------------------------------- |
| Vault KEK domain               | `opennest:credential-vault-kek:v1`     |
| Passphrase minimum             | 12 characters, not trimmed             |
| KDF                            | PBKDF2-SHA-256                         |
| Salt                           | 128-bit random                         |
| Iteration floor                | 600,000                                |
| Iteration ceiling              | 2,000,000                              |
| Vault DEK                      | 256-bit random                         |
| Entry CEK                      | 256-bit random per create or update    |
| Cipher                         | AES-256-GCM, 96-bit nonce, 128-bit tag |
| Unlock attempts before backoff | 5                                      |
| Backoff after failed attempts  | 30 seconds                             |
| Default auto-lock              | 5 minutes of inactivity                |
| Maximum entries                | 50                                     |
| Entry secret size              | 1 to 8,192 bytes                       |
| Account label size             | 1 to 120 characters                    |

The KDF record is versioned. Raising the iteration count is allowed. Lowering the
floor requires an explicit security decision and a migration plan.

## Record format

A version 1 vault record contains:

- `version: 1`.
- `vaultId`.
- `activeKid`.
- KDF parameters: algorithm, hash, iterations, and salt.
- `wrappedDek`: nonce, ciphertext, and tag.
- Entry records.
- `failedAttempts` and `retryAfter`.
- `createdAt` and `updatedAt`.

An entry record contains:

- `id`, `providerId`, and `accountLabel`.
- `version: 1`.
- `kid`.
- `wrappedCek`: nonce, ciphertext, and tag.
- `iv`, `ciphertext`, and `tag` for the secret.
- `createdAt` and `updatedAt`.

The record stores only ciphertext, wrapped keys, public metadata, and lifecycle
metadata. Provider ID and account label are plaintext metadata so the user can
identify an entry before unlock. The secret is never plaintext.

### AAD binding

The wrapped DEK is authenticated with vault version, vault ID, active key ID, and
the credential-vault domain. The entry wrapped CEK and secret are authenticated
with a canonical AAD object containing:

- `vaultId`.
- Active `kid`.
- `entryId`.
- `providerId`.
- `accountLabel`.
- `entryVersion`.
- `purpose`, either `entry-key` or `entry-secret`.

Moving a wrapped key, ciphertext, entry ID, provider ID, label, key ID, or purpose
to another record must fail authentication.

Parsing is strict. Wrong versions, unknown fields, duplicate keys, invalid
base64url, invalid timestamps, invalid retry state, a wrong KDF domain, bad salt,
or a bad wrapped key fail closed. Parsing never falls back to plaintext.

## Lifecycle

### Setup

`setup(passphrase)` requires at least 12 characters and does not trim the input.
Leading and trailing spaces are part of the passphrase.

Setup:

1. Generates a 128-bit salt, vault ID, active key ID, and 256-bit vault DEK.
2. Derives the vault KEK with the vault domain.
3. Wraps the DEK with AES-256-GCM and a unique nonce.
4. Stores an empty entry list.
5. Returns an unlocked session with the default 5-minute auto-lock.

### Unlock

`unlock(passphrase)` validates the record and persisted failure state before
attempting the KDF.

- After 5 failed attempts, unlock is refused for 30 seconds.
- A successful unlock resets the failure count and retry time.
- A failed unlock returns a generic authenticated-decryption error.
- The in-memory DEK is non-extractable where the platform allows it.
- A session exposes `vaultId`, `unlockedAt`, `expiresAt`, `isUnlocked`, `touch`,
  and `lock`.
- Activity calls `touch`; expiry is checked before every vault operation.
- `lock` drops the in-memory key material and invalidates the session.

### Change passphrase

`changePassphrase(session, currentPassphrase, nextPassphrase)` requires the
current passphrase, creates a new salt and KDF parameters, and rewraps the same
vault DEK. It does not re-encrypt entries. The old passphrase stops working.

### Rotation

`rotate(session)` creates a new active key ID and a new vault DEK, then rewraps
every entry with a fresh entry CEK. The old vault DEK cannot decrypt the new
record. Rotation preserves the credential plaintext only inside the operation and
never returns it to the UI.

### Delete

`delete()` removes the vault record. There is no recovery path. Deleting the
vault does not delete workspace data, but it makes stored credentials
permanently unreadable.

## Entry operations

- `list(session)` returns metadata only: entry ID, provider ID, label, version,
  and timestamps.
- `create(session, input)` validates the provider ID, label, and secret, creates
  a fresh CEK and nonce, encrypts the secret, and returns metadata.
- `update(session, entryId, input)` changes the label, secret, or both. A secret
  change uses a fresh CEK and nonce. Other entries keep their ciphertext.
- `remove(session, entryId)` removes one entry.
- `withSecret(session, entryId, providerId, operation)` checks the session,
  expiry, provider ID, entry ID, and AAD before decrypting. It passes the secret
  only to the operation closure and returns only the closure result.
- `rotate(session)` rotates the vault DEK and every entry CEK.

Provider IDs follow the same rules as capability qualifiers. They reject
whitespace, separators, wildcards, dot segments, and control characters. Labels
are 1 to 120 characters. Secrets are 1 to 8,192 UTF-8 bytes. The vault accepts at
most 50 entries and unique entry IDs.

Every create or update generates a fresh entry CEK and nonce. A CEK encrypts
exactly one secret and is never reused for a new write. Lock, expiry, or a
provider mismatch rejects every entry operation before decryption.

## Storage

The vault uses IndexedDB database `opennest-credentials`, version 1, table
`vaults: "id"`. The row is `{ id: "default", record }`. Only the parsed vault
record is stored.

Session credentials use an in-memory store. The private map is cleared on lock,
delete-all, or runtime disposal. `list()` returns metadata only.

Neither store is included in backup v1 or backup v2. Backup restore cannot
recover provider access. Delete-all clears session credentials, deletes the vault
record, and locks the vault. The delete order is: AI, credentials, privacy.

## Failure behavior

- Wrong passphrase: generic authentication error, increment failure state.
- Rate limited: local error with retry time, no KDF attempt.
- Malformed record: fail closed, do not overwrite the record.
- Locked or expired session: reject every operation.
- Provider mismatch: reject before decrypting.
- AAD mismatch: reject before returning plaintext.
- Browser storage eviction: report the vault as missing; never invent entries.
- Delete-all failure: report the failure; do not claim credentials are gone.

There is no recovery flow and no password hint. The UI must warn before setup that
losing the passphrase loses the stored credentials.

## Security boundaries

- XSS while unlocked can read plaintext credentials or invoke a handle. The
  browser cannot provide a perfect secret boundary.
- JavaScript garbage collection is not reliable zeroization. Locking reduces
  exposure but cannot prove old buffers are erased.
- PBKDF2 is weaker than a memory-hard KDF. Argon2 is deferred.
- The vault is browser storage, not an OS keychain.
- A provider can retain anything the user sends after a request is approved.
- The vault record is excluded from backups, but an attacker with local browser
  storage access can copy it and attempt offline guessing.
- No independent review has been performed. The vault must not be described as
  independently reviewed or recoverable.

## Verification requirements

- Setup and unlock round-trip.
- Wrong passphrase and the 5-attempt, 30-second rate limit.
- 11-character passphrase rejected, 12 accepted, and leading or trailing spaces
  preserved.
- Passphrase change invalidates the old passphrase and keeps the same DEK.
- Rotation preserves secrets and invalidates the old DEK.
- AAD and ciphertext swaps across entry IDs, provider IDs, labels, key IDs, and
  purposes fail authentication.
- Nonce uniqueness across wrapped keys and secret ciphertexts.
- Update leaves other entries unchanged.
- Lock and expiry reject list, create, update, remove, and `withSecret`.
- Record JSON contains no passphrase, DEK, CEK, or plaintext secret.
- Workspace and backup keys cannot unwrap the vault DEK.
- Backup v1 and backup v2 contain no vault record, session credential, or
  provider config.
- Delete-all removes the vault record and session credentials.

## Open gaps

- D4B has no vault recovery.
- External review has not started.
- Memory zeroization is best effort.
- XSS while unlocked is outside the vault boundary.
- Browser storage can be evicted.
- No OS keychain or WebAuthn integration exists.
- Multi-device credential sync is not implemented.
