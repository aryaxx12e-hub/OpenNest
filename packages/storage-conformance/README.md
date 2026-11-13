# @opennest/storage-conformance

One executable contract for every storage adapter. The suite is written against
the `StorageAdapter` ports in `@opennest/core`, never against a specific
adapter's internals, so `memory`, `dexie`, and later `sqlite` all run the same
tests.

## Usage

```ts
import "fake-indexeddb/auto";

import { runStorageConformance } from "@opennest/storage-conformance";

import { createDexieStorage } from "../index";

runStorageConformance("dexie", async (name) =>
  createDexieStorage({ databaseName: name ?? "opennest-test" })
);
```

`create` receives an optional database name so a scenario can prove that two
adapter instances on the same database see each other's data. When it is
`undefined`, the adapter should pick a unique name.

## What it covers

| Scenario     | Contract                                                           |
| ------------ | ------------------------------------------------------------------ |
| lifecycle    | idempotent `init`, `closed` after `close`, `reset`, cross-instance |
| workspaces   | create, ensure, update, delete, cascade                            |
| folders      | tree mutations, cycles, cross-workspace moves, ancestors, children |
| files        | metadata round-trip, filters, tags                                 |
| notes        | CRUD, monotonic `updatedAt`, filters                               |
| tags         | case-insensitive uniqueness, rename conflicts, cascade             |
| pagination   | cursor stability, tie-breaking by id, descending order             |
| search       | prefix semantics, filters, tiered order, hostile queries           |
| blobs        | byte-exact round-trip, usage accounting, orphan purge              |
| transactions | rollback, commit, return value, nested rejection                   |
| restore      | snapshot replace, dangling references rejected, old data kept      |
| errors       | unknown ids are `DomainError`, closed usage is `storage_error`     |

## Rules

- A scenario asserts on port behaviour only. Never import adapter internals,
  never assert on a row shape that only one adapter stores.
- Every scenario uses `withHarness`, which builds the domain services on top of
  the adapter and cleans up afterwards. Do not hand-wire services per test.
- Test names describe the contract, not the implementation ("pages through every
  row exactly once"), so a failure reads as a contract violation in any adapter.
- A new storage behaviour lands here first. An adapter-specific test belongs in
  that adapter's package only for something the contract cannot express, such as
  a Dexie version upgrade or a SQLite `PRAGMA` check.
