# Stage B: Core Architecture and Storage Design

- Status: Approved on 2026-11-12 and implemented as Stage B. Live status is in
  `ROADMAP.md`.
- Date: 2026-11-12
- Scope: AGENTS.md Stage B (domain models, storage interfaces, IndexedDB adapter,
  repository layer, validation, error handling, persistence tests), plus the
  SQLite adapter approved under decision 6 (18). The adapter is approved; its
  migrations remain gated by B4, which must prove the Drizzle migrator over
  `node:sqlite` before anything is built on it (10.4, B4).
- Supersedes: nothing. Extends `2026-11-12-foundation-stage-a-design.md`. Records
  the package-boundary shift in ADR 0003.
- Product source: `PRD.md` sections 4, 5, 8, 9, 13, 14, and 19.

## 1. Intent

Stage A delivered a shell with localization, tokens, and gates, but no data.
Stage B builds the layer every MVP feature sits on: a domain model, the
repository ports that express it, two interchangeable storage adapters, input
validation, and the tests that prove the adapters really are interchangeable.

The exit criteria are architectural, not visual. When Stage B is done, a feature
developer writes `folders.create({ parentId, name })` against an interface, and
the same call works against IndexedDB in the browser and SQLite on a self-hosted
server, with the same observable behaviour, the same validation errors, and the
same transactional guarantees for metadata.

Nothing user-visible ships in this stage. No page, route, or component in
`apps/web` changes.

## 2. Goals

1. A dependency-free domain model and repository ports a browser bundle can
   import without pulling in Node APIs.
2. Two adapters implementing those ports with equivalent behaviour: IndexedDB
   via Dexie, and SQLite via Drizzle over `node:sqlite`.
3. Business rules enforced once: folder cycles, workspace ownership, tag name
   uniqueness, filename safety, size and MIME limits, timestamp policy.
4. Versioned, forward-only, tested migrations.
5. Storage-level search, because PRD section 9 ties FTS5 to the SQLite adapter.
6. A conformance suite that runs the identical scenarios against both adapters,
   so "interchangeable" is proven by execution.
7. All Stage A quality gates still pass.

## 3. Non-goals

1. No UI (Stage C).
2. No `/api/v1/*` routes. PRD section 8 forbids a network API for a local
   operation. The ports are the API for Stage C; HTTP waits for self-hosting.
3. No authentication or multi-user exposure.
4. No encryption. PRD section 13 forbids calling browser storage encrypted.
5. No AI, cloud sync, collaboration, marketplace, or plugins.
6. No PWA manifest or service worker (Stage E).
7. No export/import archive format or UI (Stage D). Stage B defines only the
   `restore()` input shape so adapters will not need reshaping later.

## 4. Constraints

Carried over from Stage A, all verified:

- Termux/Android aarch64, Node 24.22.2, npm 11.21.1.
- Working tree on `/data` (f2fs). Shared storage is `noexec`, refuses symlinks,
  and blocks native module loading.
- No shebangs and no `npx`. Tools are invoked as `node scripts/x.mjs` or
  `node node_modules/<pkg>/<entry>`.
- Next.js on Webpack with Wasm SWC; Turbopack unavailable.
- Gates: `lint`, `typecheck`, `test`, `build`, `format:check`.
- Packages are consumed as TypeScript source through `transpilePackages`, must
  not import Next.js, and are imported only through their public entry point.

New constraints found while preparing this spec:

- `better-sqlite3` needs a native build and is not installed. Stage A proved
  native addons are fragile here, so the SQLite adapter must not require one.
- Drizzle ORM stable is `0.45.4`. `drizzle-orm/node-sqlite` exists only in the
  `1.0.0-rc` line, so it cannot be used on a stable release.
- `drizzle-kit` 0.31.11 pulls `tsx` and `esbuild`; both resolve to Android arm64
  binaries. Verified by installing and running it.

### 4.1 Probes run while preparing this spec

Throwaway projects under `$TMPDIR`, not projections.

| Probe                                     | Result                                                                |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `node:sqlite` on Node 24.22.2             | works; SQLite 3.54.1                                                  |
| FTS5 external-content table               | works; `MATCH 'belanja*'` returns the row                             |
| FTS5 tokenizer                            | `unicode61 remove_diacritics 2` accepted                              |
| WAL on a file database                    | `journal_mode=wal` accepted                                           |
| Foreign keys                              | `ON DELETE SET NULL` and `ON DELETE CASCADE` both behave              |
| BLOB round-trip                           | `Uint8Array` returns as `[object Uint8Array]`, bytes intact           |
| Error codes                               | PK 1555, UNIQUE 2067, FK 787, all `ERR_SQLITE_ERROR`                  |
| Drizzle `sqlite-proxy` over `node:sqlite` | select, insert, and `get` work                                        |
| Drizzle transaction                       | driver receives `begin`, statements, `rollback`; 0 rows after failure |
| `drizzle-kit` on Android                  | generates SQL and indexes from a schema file                          |
| `drizzle-kit generate --custom`           | creates `0001_fts5.sql`, registers it in `meta/_journal.json`         |
| Dexie 4.0407 + fake-indexeddb 6.2.8       | opens; compound index query works                                     |
| Dexie `Blob` round-trip                   | bytes and MIME type preserved                                         |
| Dexie transaction abort                   | throws, rolls back, count returns to prior value                      |
| Dexie unique compound index               | `&[workspaceId+name]` rejects a duplicate with `ConstraintError`      |
| Node version gates                        | repo runs Node 24; `node:sqlite` requires >=22.5 in practice          |

### 4.2 Decisions taken from review

A fresh-reader builder review found blocking gaps in an earlier draft. Each is
resolved here, and the resolution is binding for implementation.

| Gap                                                | Resolution                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `WorkspaceRepository` undefined                    | Defined in 8.2, including idempotent `ensureWorkspace()`                               |
| `FileFilter`/`NoteFilter` had no home (cycle risk) | Canonical types in `core`; `validation` exports `ZodType<FileFilter>`                  |
| `BackupSnapshot` undefined                         | Defined in 8.6, including blob payloads                                                |
| Timestamps cannot be written through ports         | One clock, in the service; ports require explicit `at` (6.4)                           |
| `createStorage()` in `core` inverts dependencies   | Removed. Each adapter exports its own factory; Stage C owns selection                  |
| Factory config unspecified                         | Each factory takes an explicit config object (8.6)                                     |
| Upload limits unspecified                          | One constant set in `core/src/limits.ts`, used by validation (11.2)                    |
| Conformance suite placement broke package edges    | New `@opennest/storage-conformance` package (7)                                        |
| Dexie indexes could not paginate all sorts         | Index set expanded in 9.1; notes sort on `title`                                       |
| SQLite `schemaVersion` undefined                   | `PRAGMA user_version`, set from migration count (10.4)                                 |
| FTS5 user input could throw syntax errors          | Shared term quoting and normalization (8.5, 10.6)                                      |
| Blob writes claimed to be transactional            | Corrected: metadata is transactional, blobs are not (10.5)                             |
| Folder delete semantics unspecified                | Children and contained items move to root (8.2, 13.2)                                  |
| `folderId` filter ambiguous                        | `null` means root items only; omitted means no folder filter (8.1)                     |
| Root `engines` incompatible with `node:sqlite`     | Root raises to `>=24.0.0` (17)                                                         |
| Search parity impossible as drafted                | Both adapters do token-prefix matching with an identical deterministic order (8.5, B5) |
| Cursor could not break ties                        | Cursor encodes `[sortValue, id]` (8.1)                                                 |
| `toMatchQuery` step 4 contradicted the semantics   | Prefix `*` on every token, matching 8.5 step 1 (8.5)                                   |
| No code existed for a missing crypto source        | `no_random_source` added to the closed union (12)                                      |

### 4.3 Contradictions found by a second review

The second pass attacked the revised text rather than the original, and found
places where a fix in one section broke a sentence in another. All are closed:

| Contradiction                                                    | Resolution                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Goal 3 says limits are "enforced once", but 11.2 restated them   | Values live in `core/src/limits.ts`; 11.2 documents them and does not re-implement (6.6, 11.2)   |
| Notes sorted by `name` while the field is `title`                | Public token stays `name`; note index and sort map to `title` (8.1, 9.1)                         |
| Cursor could not tie-break equal sort values                     | `[sortValue, id]` cursor and indexes ending in `id` (8.1, 9.1)                                   |
| Dexie substring search could not match FTS5 token search         | One semantics for both: token-prefix, four-tier order, `score` excluded (8.5, 9.3, B5)           |
| Clocks in both service and adapter config                        | One clock, in the service; adapters take no clock (6.4, 8.6)                                     |
| `schemaVersion` compared across adapters with different counting | Adapter-local `schemaVersion` plus a shared `snapshotVersion`; `kind` scopes the check (8.6, 14) |
| `list()` returns many workspaces but backup and restore take one | `ensureWorkspace()` throws on more than one; `list()` is diagnostics only (8.2)                  |
| SQLite and FTS5 in Stage B exceed what `AGENTS.md` lists         | Approved as decision 6 (18); both adapters ship                                                  |
| Rules called "pure" while cycle detection walks a port           | Split into `rules.ts` (pure) and `checks.ts` (takes a port) (6.6)                                |
| `folderId: null` and omitted meant the same thing                | `null` is root-only; omitted is no folder filter (8.1)                                           |
| The review table said nine gaps and listed fifteen               | Heading no longer counts them (4.2)                                                              |

A third pass, while planning B2, found three more and closed them the same way:

| Contradiction                                                                                   | Resolution                                                                                           |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| §7 said `validation -> core (types only)` while §6.6/§11.2 had schemas read `limits` at runtime | `validation` may import core types, `limits`, and pure `rules`/`checks`; it never imports ports (§7) |
| `restoreManifestSchema` was required in §11.1 with no shape anywhere                            | Shape defined in §11.1; it is a pure archive manifest, so Stage D adds no schema                     |
| Checksum regex lived privately in `services/file.ts`                                            | Hoisted to `validateChecksum` in `rules.ts`; the service calls it, so validation and storage agree   |

## 5. Approaches considered

### 5.1 Package shape

Option A, one `@opennest/storage` package with subpath exports. Compact, matches
the PRD directory list, but the Stage A ESLint rule blocks `@opennest/*/*` deep
imports, and one manifest cannot express that the SQLite side is server-only.

Option B, ports in `@opennest/core` plus separate adapter packages. Each has one
entry point, so the lint rule is untouched. The browser package cannot
accidentally import `node:sqlite` because it does not depend on it. A new
backend is a new package.

Option C, one client talking to a remote API in both modes. Rejected: PRD
section 8 forbids a network API for local operations.

**Chosen: Option B.**

### 5.2 SQLite driver

- `better-sqlite3`: native, no proven build here. Rejected.
- `@libsql/client`: no android-arm64 prebuild; second dialect surface. Rejected
  for the reference platform.
- `drizzle-orm/node-sqlite`: cleanest, but release-candidate only. Rejected
  because PRD section 8 requires stable versions; revisit at Drizzle 1.0.
- Drizzle `sqlite-proxy` over `node:sqlite`: built in, no native install, FTS5,
  WAL, foreign keys, real transactions.

**Chosen: `sqlite-proxy` over `node:sqlite`.**

### 5.3 Binary storage in server mode

- BLOB column: simple and transactional, but PRD section 9 requires binaries
  separate from relational metadata, and it inflates the database and backups.
- Filesystem keyed by a generated opaque id: matches the PRD, keeps SQLite
  small, makes export a copy.

**Chosen: filesystem**, with generated keys only, a strict key regex before any
path is built, and atomic temp-then-rename writes.

## 6. Domain model

Mirrors PRD section 9, plus a blob store, search, and a migration ledger.

### 6.1 Branded identifiers

```ts
export type WorkspaceId = string & { readonly __brand: "WorkspaceId" };
export type FolderId = string & { readonly __brand: "FolderId" };
export type FileId = string & { readonly __brand: "FileId" };
export type NoteId = string & { readonly __brand: "NoteId" };
export type TagId = string & { readonly __brand: "TagId" };
export type IsoDate = string & { readonly __brand: "IsoDate" };
export type BlobKey = string & { readonly __brand: "BlobKey" };
```

Branded strings erase to `string` at runtime, so nothing leaks into storage, but a
`FolderId` cannot be passed where a `NoteId` is expected.

### 6.2 Entities

```ts
export interface Workspace {
  id: WorkspaceId;
  name: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Folder {
  id: FolderId;
  workspaceId: WorkspaceId;
  parentId: FolderId | null;
  name: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface StoredFile {
  id: FileId;
  workspaceId: WorkspaceId;
  folderId: FolderId | null;
  name: string;
  mimeType: string | null;
  sizeBytes: number;
  blobKey: BlobKey;
  checksum: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Note {
  id: NoteId;
  workspaceId: WorkspaceId;
  folderId: FolderId | null;
  title: string;
  content: string;
  pinned: boolean;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Tag {
  id: TagId;
  workspaceId: WorkspaceId;
  name: string;
  color: string | null;
  createdAt: IsoDate;
}

export interface FileTag {
  fileId: FileId;
  tagId: TagId;
}
export interface NoteTag {
  noteId: NoteId;
  tagId: TagId;
}
export interface NoteLink {
  sourceNoteId: NoteId;
  targetNoteId: NoteId;
}
```

`StoredFile`, not `File`, because the DOM global would be shadowed and Stage C
passes real `File` objects into `upload()`. `pinned` is `boolean` in the domain,
stored as `INTEGER 0/1` in SQLite and `0|1` in Dexie, converted inside adapters.

### 6.3 Timestamps

All timestamps are ISO 8601 UTC strings, matching the `TEXT` columns in PRD
section 9. No `Date` crosses a port boundary, so serialization is identical in
both adapters and in exports.

### 6.4 Clock and write timestamps

There is exactly one clock, and it lives in the services: `clock: () => IsoDate`.
Adapters never call `Date` and never invent a timestamp. Every create and every
update takes a required-for-services `at: IsoDate`; the service supplies
`clock()`. This removes the ambiguity of two time sources and makes the
conformance clock test meaningful: the test injects a clock into the service and
asserts the stored value is exactly what it returned.

`at` is optional in the _port_ signature only so that tests and `restore()` can
write historical timestamps. Services always pass it.

`updatedAt` is non-decreasing. A test injects a clock advancing one second per
call and asserts each update stores the new value; a second test injects a fixed
clock and asserts equality is accepted, not an error.

### 6.5 Identifier generation

`crypto.randomUUID()` exists in Node 24 and in secure browser contexts. A PWA on
plain HTTP over a LAN is not a secure context, so the generator falls back to
`crypto.getRandomValues` with manual v4 formatting. The fallback is tested.
PRD section 9 accepts UUIDs; ordering comes from `createdAt`, never from the id.

### 6.6 Business rules

Two categories, deliberately separated.

**Pure functions** in `packages/core/src/rules.ts`, no storage, no ports:

| Rule                                                      | Function                             |
| --------------------------------------------------------- | ------------------------------------ |
| Trim, reject empty, max 255 chars                         | `normalizeName(input)`               |
| Reject `/`, `\`, control chars, leading/trailing dots     | `validateDisplayName`                |
| Reject `..`, absolute paths, non-UUID keys                | `assertSafeBlobKey`                  |
| Allowed MIME types and max size                           | `validateUpload(meta)`               |
| Tag name trimmed, max 50, case-insensitive comparison key | `normalizeTagName`                   |
| Tag color is `#RRGGBB` or null                            | `validateTagColor`                   |
| Note title max 200, content max 1,000,000 chars           | `validateNoteInput`                  |
| Checksum is 64 lowercase hex chars or null                | `validateChecksum`                   |
| A note may not link to itself                             | `assertNoSelfLink`                   |
| Search input folded into safe match terms                 | `normalizeForSearch`, `toMatchQuery` |

**Port-dependent checks** in `packages/core/src/checks.ts`, which take a
repository and are therefore not pure:

| Rule                                                     | Function                                         |
| -------------------------------------------------------- | ------------------------------------------------ |
| A folder may not be its own ancestor                     | `assertNoFolderCycle(folders, id, nextParentId)` |
| An in-memory folder tree has no cycle or over-deep chain | `assertNoFolderCycleInTree(folders)`             |
| Referenced folder and tags are in the same workspace     | `assertSameWorkspace(deps, refs)`                |

`assertNoFolderCycle` walks ancestors through the port with a depth limit of
1000, so a corrupted chain terminates. It is O(depth), not O(tree).

All numeric limits live in `packages/core/src/limits.ts` as one exported object.
`rules.ts`, `validation` schemas, and the tests all read from it, so the 25 MiB
cap cannot be changed in one place and forgotten in another. Section 11.2 lists
the values; it does not redefine them.

`normalizeForSearch` lowercases, applies Unicode NFD, strips combining marks,
collapses whitespace. Both adapters use it, so FTS5 `remove_diacritics 2` and the
Dexie matcher agree on accented input.

`normalizeTagName` returns `{ display, key }` where `key` is the lowercased,
whitespace-collapsed form. Case-insensitive uniqueness is enforced by the
service using `findByName`; the database keeps PRD's exact
`UNIQUE(workspace_id, name)` as a defensive constraint for exact duplicates. The
limitation (a concurrent pair of creates could bypass the service check) is
documented and acceptable for a single-user MVP.

### 6.7 Services

One per aggregate in `packages/core/src/services/`: `WorkspaceService`,
`FolderService`, `FileService`, `NoteService`, `TagService`, `SearchService`.
Each takes repositories and a clock by injection.

```ts
export function createFolderService(deps: {
  folders: FolderRepository;
  transaction: TransactionRunner;
  clock: () => IsoDate;
}): FolderService;
```

The file service also takes
`hash: (data: Uint8Array) => Promise<string>`, because SHA-256 comes from
`node:crypto` on the server and `crypto.subtle` in the browser. Adapters stay
byte-agnostic.

Services own validation, ordering, and cross-entity rules. Adapters own
persistence. UI owns presentation.

## 7. Package layout and boundaries

```
packages/
  core/                    entities, ids, ports, rules, services, errors, fixtures
  validation/              Zod schemas for external input and archives
  storage-dexie/           IndexedDB adapter
  storage-sqlite/          SQLite adapter, Drizzle schema, migrations, blob store
  storage-conformance/     the shared suite both adapters run
```

`packages/shared`, `packages/database`, and `packages/search` are not created.
They would be empty shells. `core` exposes the search port and each adapter
implements it; a dedicated search package appears only with a second consumer.
ADR 0003 records that this supersedes the forward-looking names in ADR 0002.

Dependency direction:

```
storage-dexie        -> core, validation, storage-conformance (dev)
storage-sqlite       -> core, validation, storage-conformance (dev)
storage-conformance  -> core (vitest as a peer dependency)
validation           -> core (types, limits, and pure rules/checks; never ports)
core                 -> nothing in the workspace
apps/web             -> any of the above (Stage C)
```

Rules:

- `core` has no runtime dependency except the global `crypto`.
- No package imports `next`, `react`, or app code.
- `storage-sqlite` may import `node:*`; `storage-dexie` must not.
- No package contains a factory that imports both adapters. That composition
  root belongs to the application (Stage C).
- `storage-conformance` imports `vitest`, so it is a test-only package and must
  never be imported by runtime code.

## 8. Repository ports

Async everywhere. IndexedDB is async, and a synchronous SQLite implementation
satisfies a promise trivially; sync types would force two service
implementations.

### 8.1 Shared types

```ts
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export interface ListOptions {
  limit?: number;
  cursor?: string | null;
  sort?: "name" | "createdAt" | "updatedAt";
  direction?: "asc" | "desc";
}

export interface FileFilter {
  folderId?: FolderId | null;
  tagIds?: TagId[];
  mimeTypes?: string[];
  text?: string;
}

export interface NoteFilter {
  folderId?: FolderId | null;
  tagIds?: TagId[];
  pinned?: boolean;
  text?: string;
}
```

`FileFilter` and `NoteFilter` are canonical here. `@opennest/validation` exports
`fileFilterSchema: ZodType<FileFilter>` and `noteFilterSchema: ZodType<NoteFilter>`,
so the runtime check cannot drift from the type without a compile error, and
`core` never imports `validation`.

`folderId` semantics, identical in both adapters:

- omitted or `undefined`: no folder filter, return items from the whole workspace.
- `null`: only items at the workspace root (`folder_id IS NULL`).
- a value: that folder and all its descendants.

PRD US-018 reads as a subtree filter, so the descendant case is the interesting
one; the explicit `null` case exists because the library UI needs a "root only"
view and `undefined` cannot express it.

Allowed `sort` values per repository are fixed, because each must be backed by an
index:

| Repository | Sorts                            | Sort field                        |
| ---------- | -------------------------------- | --------------------------------- |
| folders    | `name`, `createdAt`, `updatedAt` | `name`, `createdAt`, `updatedAt`  |
| files      | `name`, `createdAt`, `updatedAt` | `name`, `createdAt`, `updatedAt`  |
| notes      | `name`, `createdAt`, `updatedAt` | `title`, `createdAt`, `updatedAt` |
| tags       | `name`, `createdAt`              | `name`, `createdAt`               |

`name` is the public sort token; for notes it maps to the `title` column. The
mapping lives in one place per adapter, never in the service.

### Cursor encoding

A cursor is `base64url(JSON.stringify([sortValue, id]))`. Both adapters use the
same encoding, so a cursor produced by one can be read by the other during a
migration or a parity test.

Ordering is always `(sortValue, id)` ascending or descending, and `id` breaks
ties, so pagination is stable when sort values repeat and when rows are inserted
between pages. For `name` sorts, `sortValue` is the case-folded name, computed by
`normalizeForSearch`, so `Apple` and `apple` cannot interleave differently in the
two adapters.

### 8.2 Workspaces and folders

```ts
export interface WorkspaceRepository {
  get(id: WorkspaceId): Promise<Workspace | null>;
  list(): Promise<Workspace[]>;
  create(input: { name: string; at?: IsoDate }): Promise<Workspace>;
  update(id: WorkspaceId, patch: { name: string; at?: IsoDate }): Promise<Workspace>;
  delete(id: WorkspaceId): Promise<void>;
  ensureWorkspace(input?: { name?: string; at?: IsoDate }): Promise<Workspace>;
}

export interface FolderRepository {
  create(input: {
    workspaceId: WorkspaceId;
    parentId: FolderId | null;
    name: string;
    at?: IsoDate;
  }): Promise<Folder>;
  get(id: FolderId): Promise<Folder | null>;
  update(
    id: FolderId,
    patch: { name?: string; parentId?: FolderId | null; at?: IsoDate }
  ): Promise<Folder>;
  delete(id: FolderId): Promise<void>;
  list(workspaceId: WorkspaceId, options?: ListOptions): Promise<Page<Folder>>;
  listChildren(workspaceId: WorkspaceId, parentId: FolderId | null): Promise<Folder[]>;
  ancestors(id: FolderId): Promise<Folder[]>;
  descendants(id: FolderId): Promise<Folder[]>;
}
```

`ensureWorkspace()` has exactly one meaning: if no workspace exists, create one
with the given name (or the default) and a fresh UUID; if exactly one exists,
return it unchanged and ignore the requested name; if more than one exists, throw
`ConstraintError("multiple_workspaces")`. The MVP is single-workspace, so a
second workspace at startup means data was tampered with or a future feature left
it behind, and guessing would be worse than failing loudly.

`list()` exists for diagnostics and the future self-hosted mode. The MVP calls
`ensureWorkspace()` and never enumerates. `BackupSnapshot` carries one workspace,
matching both the MVP and PRD's data model, which puts a single `Workspace` at the
root.

`ancestors()` returns root first. `descendants()` exists because the subtree
filter needs it in both adapters.

`update()` and `delete()` throw `NotFoundError` for an unknown id, rather than
silently doing nothing. `get()` returns `null`.

Deleting a folder never deletes its contents. PRD section 9 defines
`ON DELETE SET NULL` on `parent_id`, `files.folder_id`, and `notes.folder_id`, so
child folders and contained items move to the workspace root. This is tested.

Deleting a workspace deletes every row in it by cascade (PRD section 9), but does
not delete blobs, because SQLite cannot reach the filesystem. The service calls
`files` deletion and `purgeOrphans` afterwards; the conformance suite asserts
`usage()` returns zero after a workspace delete through the service.

### 8.3 Files and notes

```ts
export interface FileRepository {
  create(input: {
    workspaceId: WorkspaceId;
    folderId: FolderId | null;
    name: string;
    mimeType: string | null;
    sizeBytes: number;
    blobKey: BlobKey;
    checksum: string | null;
    at?: IsoDate;
  }): Promise<StoredFile>;
  get(id: FileId): Promise<StoredFile | null>;
  update(
    id: FileId,
    patch: { name?: string; folderId?: FolderId | null; at?: IsoDate }
  ): Promise<StoredFile>;
  delete(id: FileId): Promise<void>;
  list(
    workspaceId: WorkspaceId,
    filter: FileFilter,
    options?: ListOptions
  ): Promise<Page<StoredFile>>;
  setTags(id: FileId, tagIds: TagId[]): Promise<void>;
  tags(id: FileId): Promise<Tag[]>;
}

export interface NoteRepository {
  create(input: {
    workspaceId: WorkspaceId;
    folderId: FolderId | null;
    title: string;
    content?: string;
    pinned?: boolean;
    at?: IsoDate;
  }): Promise<Note>;
  get(id: NoteId): Promise<Note | null>;
  update(
    id: NoteId,
    patch: {
      title?: string;
      content?: string;
      folderId?: FolderId | null;
      pinned?: boolean;
      at?: IsoDate;
    }
  ): Promise<Note>;
  delete(id: NoteId): Promise<void>;
  list(
    workspaceId: WorkspaceId,
    filter: NoteFilter,
    options?: ListOptions
  ): Promise<Page<Note>>;
  setTags(id: NoteId, tagIds: TagId[]): Promise<void>;
  tags(id: NoteId): Promise<Tag[]>;
  setLinks(id: NoteId, targetIds: NoteId[]): Promise<void>;
  links(id: NoteId): Promise<NoteLink[]>;
}
```

`setTags` and `setLinks` replace the whole set in one transaction: de-duplicate
the input, delete existing rows, insert the new ones. `links()` returns outgoing
links only; backlinks are a Stage C query over the same table.

### 8.4 Tags

```ts
export interface TagRepository {
  create(input: {
    workspaceId: WorkspaceId;
    name: string;
    color?: string | null;
    at?: IsoDate;
  }): Promise<Tag>;
  get(id: TagId): Promise<Tag | null>;
  update(
    id: TagId,
    patch: { name?: string; color?: string | null; at?: IsoDate }
  ): Promise<Tag>;
  delete(id: TagId): Promise<void>;
  list(workspaceId: WorkspaceId, options?: ListOptions): Promise<Page<Tag>>;
  findByName(workspaceId: WorkspaceId, key: string): Promise<Tag | null>;
}
```

`findByName` takes the normalized key, so the service does one lookup instead of
loading every tag.

### 8.5 Search and blobs

```ts
export interface SearchQuery {
  workspaceId: WorkspaceId;
  text: string;
  kinds?: Array<"file" | "note">;
  folderId?: FolderId | null;
  tagIds?: TagId[];
  limit?: number;
  offset?: number;
}

export interface SearchHit {
  kind: "file" | "note";
  id: string;
  title: string;
  snippet: string;
  score: number;
}

export interface SearchRepository {
  search(query: SearchQuery): Promise<SearchHit[]>;
  reindexAll(workspaceId: WorkspaceId): Promise<void>;
}

export interface BlobStore {
  put(key: BlobKey, data: Blob | Uint8Array): Promise<void>;
  get(key: BlobKey): Promise<Blob | null>;
  delete(key: BlobKey): Promise<void>;
  has(key: BlobKey): Promise<boolean>;
  usage(): Promise<{ bytes: number; items: number }>;
  purgeOrphans(knownKeys: BlobKey[]): Promise<number>;
}
```

User text never reaches an FTS5 query builder raw. `core` exposes
`toMatchQuery(text)`:

1. `normalizeForSearch` the input.
2. Split on whitespace and drop tokens that are only punctuation.
3. Quote every token as an FTS5 string literal, doubling embedded quotes.
4. Append `*` outside the quotes on **every** token, so every query token is a
   prefix match. A trailing `*` on only the last token would make earlier tokens
   exact, which contradicts step 1 of the semantics below.

The result is a valid FTS5 expression for any input, including `"`, `*`, `(`,
`)`, `-`, `NEAR`, `OR`, `AND`, and `NOT`. If step 2 leaves no tokens, the search
returns `[]` before reaching storage. This is tested with a corpus of hostile
queries, each of which must return hits or `[]` and never throw.

A concrete example: the input `Belanja  Bulanan` normalizes to `belanja bulanan`,
splits into `["belanja", "bulanan"]`, and `toMatchQuery` returns
`"belanja"* "bulanan"*`. That matches `Belanja bulanan` and
`belanjaan bulananmu`, but not `Belanja tahunan` (the second token is not a
prefix of `tahunan`) and not `oat` against `goat` (no token boundary).

Step 2 drops tokens that are _only_ punctuation, such as the `-` in
`belanja - bulanan`. Punctuation attached to a word is kept, so `bulanan!` is
the token `bulanan!` and does not prefix-match `bulanan`. `searchTokens` and
`toMatchQuery` share this rule, so both adapters agree; whether to strip
leading and trailing punctuation is left as a deliberate open question rather
than guessed at here.

### Search semantics, identical in both adapters

An earlier draft asked Dexie for substring matching and SQLite for FTS5 tokens,
then demanded identical hits. That is impossible, so the semantics are fixed
here for both:

1. A document matches when every query token is a **prefix of some word** in its
   searchable text (file name; note title plus content), case- and
   diacritic-folded by `normalizeForSearch`.
2. Dexie implements this by tokenizing the same folded text and testing prefixes.
   It is not substring matching, and `"oat"` does not match `"goat"`.
3. SQLite implements it with FTS5 prefix queries generated by `toMatchQuery`.
4. Result order is deterministic and defined by rules, not by a score:

   1. title/name equals the whole query, case-folded
   2. title/name starts with the query
   3. every query token appears in the title/name
   4. remaining matches

   Within each tier, sort by folded title ascending, then by id ascending.

5. `score` is exposed for the UI to display or rank optionally, but it is
   **not** part of the parity contract. `bm25()` in SQLite and the small scorer
   in Dexie are allowed to disagree.

Because the order is defined by tiers plus `(title, id)`, a parity test can
assert exact sequence equality on both adapters, which the earlier draft could
not.

`purgeOrphans` lists blobs not present in `knownKeys` and deletes them, returning
the count. It is the recovery path for a crash between a blob write and a row
insert.

### 8.6 Adapter surface and restore

```ts
export interface BackupSnapshot {
  snapshotVersion: 1;
  schemaVersion: number;
  kind: "dexie" | "sqlite";
  createdAt: IsoDate;
  workspace: Workspace;
  folders: Folder[];
  files: StoredFile[];
  notes: Note[];
  tags: Tag[];
  fileTags: FileTag[];
  noteTags: NoteTag[];
  noteLinks: NoteLink[];
  blobs: Array<{ key: BlobKey; mimeType: string; data: Uint8Array }>;
}

export type TransactionRunner = <T>(
  work: (repos: Repositories) => Promise<T>
) => Promise<T>;

export interface Repositories {
  workspaces: WorkspaceRepository;
  folders: FolderRepository;
  files: FileRepository;
  notes: NoteRepository;
  tags: TagRepository;
  search: SearchRepository;
  blobs: BlobStore;
  transaction: TransactionRunner;
}

export interface StorageAdapter extends Repositories {
  readonly kind: "dexie" | "sqlite";
  readonly schemaVersion: number;
  init(): Promise<void>;
  close(): Promise<void>;
  reset(): Promise<void>;
  restore(snapshot: BackupSnapshot): Promise<void>;
}

export interface SqliteStorageConfig {
  databaseFile: string;
  blobRoot: string;
}

export interface DexieStorageConfig {
  databaseName: string;
}

export function createDexieStorage(config: DexieStorageConfig): StorageAdapter;
export function createSqliteStorage(config: SqliteStorageConfig): StorageAdapter;
```

Factory placement: each adapter exports its own factory, shown above. There is no
factory in `core`, because that would make `core` import both adapters and drag
`node:sqlite` toward the browser. Stage C's composition root decides which to
create. This satisfies PRD section 8's "the core must not depend on IndexedDB or
SQLite".

`BackupSnapshot` includes blob bytes, so a restore can rebuild file contents, as
PRD section 11 requires. Stage D wraps this in a zip with a manifest; the
in-memory shape is stable and does not need to change.

`init()` is idempotent. `close()` is safe to call once; using an adapter after
close throws `StorageError("closed")`. `reset()` deletes every row and every
blob, after which `usage()` reports zero. `restore()` replaces the dataset.

`restore()` atomicity: all metadata rows are replaced inside one transaction.
Blobs are written before the commit and removed after a rollback, so a failure
restores the previous metadata and leaves no new blobs. This is not fully atomic
across the two media, which is stated in 10.5 and tested for both failure paths.

## 9. IndexedDB adapter (`@opennest/storage-dexie`)

### 9.1 Schema

```ts
db.version(1).stores({
  workspaces: "id",
  folders:
    "id, workspaceId, parentId, [workspaceId+parentId], " +
    "[workspaceId+name+id], [workspaceId+createdAt+id], [workspaceId+updatedAt+id]",
  files:
    "id, workspaceId, folderId, [workspaceId+folderId], " +
    "[workspaceId+name+id], [workspaceId+createdAt+id], [workspaceId+updatedAt+id]",
  notes:
    "id, workspaceId, folderId, [workspaceId+folderId], pinned, " +
    "[workspaceId+title+id], [workspaceId+createdAt+id], [workspaceId+updatedAt+id]",
  tags: "id, workspaceId, &[workspaceId+name], [workspaceId+createdAt+id]",
  fileTags: "[fileId+tagId], fileId, tagId",
  noteTags: "[noteId+tagId], noteId, tagId",
  noteLinks: "[sourceNoteId+targetNoteId], sourceNoteId, targetNoteId",
  blobs: "key",
});
```

Every allowed sort has a matching compound index ending in `id`, so a cursor is
always backed by an index and ties break deterministically. Notes index `title`,
not `name`, because that is the field on `Note`; `name` is only the public sort
token mapped in 8.1.

`folders` and `files` use `[workspaceId+name+id]`. In 8.1 the sort value for
`name` is the folded name, but the stored column is the display name, so the
adapter compares folded values in memory within the indexed page window. This
keeps the index usable for the common case and is corrected in one place if a
folded column is added later.

Tags use `&[workspaceId+name]`, which is both the uniqueness constraint and the
`name` sort index. Since names are unique per workspace, `id` is unnecessary
there. A probe confirmed Dexie 4.0407 reports `ConstraintError` on a duplicate
and allows the same name in another workspace. There is no `meta` table; nothing
needed it.

The adapter declares this index set as Dexie **version 2**. Version 1 (primary
keys only) shipped first and opened a v1 database without a migration; version 2
adds the indexes above, so a v1 browser database is upgraded in place on first
open and no row is touched. Rows are identical between the two, so the port-level
`schemaVersion` stays 1 and a Dexie backup is indistinguishable from a memory
one; the Dexie version bump exists only because adding an index to a released
version would leave existing users on the old index set silently. `upgrade.test.ts`
seeds a version 1 database and asserts both that the data survives and that the
v2 compound indexes exist. Version 1 must never be edited.

### 9.2 Transactions

Dexie transactions are zone-based. `transaction(work)` opens
`db.transaction("rw", [...allTables])` and passes a repository bundle bound to
the same instance, so awaited operations stay in the zone. Probe confirmed a
thrown error rolls everything back.

Nothing inside `work` may await anything outside the zone (`fetch`, `setTimeout`,
a promise from another Dexie instance). This rule is in the adapter README and in
`docs/development.md`, because violating it silently breaks atomicity.

Nested transactions throw `UnsupportedError`. SQLite has the same limitation, so
the port documents one level.

### 9.3 Search

Dexie has no full-text index. `search()` loads candidate titles and note contents
for the workspace, normalizes with `normalizeForSearch`, and implements the
semantics fixed in 8.5: every query token must be a prefix of some word, with the
four-tier deterministic ordering and `(foldedTitle, id)` tie-break.

The in-memory scorer is bounded by `limit` so a huge note body cannot blow up a
page. Documented as intended for the MVP dataset and revisited if a real dataset
exceeds it.

The result set is a token-prefix match, not a substring match. `"oat"` does not
match `"goat"`. This is the same rule SQLite implements via FTS5, which is what
makes the parity test in 13.2 possible.

`search()` is not index-backed beyond the workspace scope: it scans the
workspace's files and notes and sorts the hits in memory. That is deliberate for
the MVP dataset and is the one place where Dexie and SQLite differ in cost rather
than in results. Revisit with a materialized token table if a real dataset makes
it slow; the contract (ids, tiers, order) is already fixed. `reindexAll()` is a
no-op because nothing is indexed.

### 9.4 Migrations

`.version(n).stores(...).upgrade(tx => ...)`, append-only. Version 1 (primary
keys only) and version 2 (the indexes in 9.1) both ship in B3; version 2 stores
the same rows, so no `.upgrade()` body is needed and `schemaVersion` stays 1. A
test declares the synthetic version 1, seeds it, opens the adapter at version 2,
and asserts both that the rows survive and that the compound indexes exist. That
test is the template for future migrations.

## 10. SQLite adapter (`@opennest/storage-sqlite`)

### 10.1 Drizzle schema

`sqlite-core` tables mirroring PRD section 9 one to one: identical column names
in snake_case, identical foreign keys and indexes. Additive indexes for the
allowed sorts are added on `(workspace_id, created_at)` and
`(workspace_id, updated_at)`, which do not change the schema's meaning.

`drizzle.config.ts` lives in the package with `dialect: "sqlite"`,
`casing: "snake_case"`, and `out: "./migrations"`.

### 10.2 Driver

```ts
const sqlite = new DatabaseSync(config.databaseFile);
sqlite.exec("PRAGMA foreign_keys = ON");
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA busy_timeout = 5000");

const db = drizzle(async (sql, params, method) => {
  /* node:sqlite bridge */
});
```

Verified on Node 24.22.2: SQLite 3.54.1, WAL on a file, `SET NULL` and `CASCADE`,
FTS5 with `unicode61 remove_diacritics 2`, `Uint8Array` round-trip.

Error mapping, measured:

| SQLite                | errcode | Domain error                           |
| --------------------- | ------- | -------------------------------------- |
| PRIMARY KEY violation | 1555    | `ConflictError("duplicate_id")`        |
| UNIQUE violation      | 2067    | `ConflictError("duplicate_tag_name")`  |
| FOREIGN KEY violation | 787     | `ConstraintError("missing_reference")` |
| Database or disk full | 13      | `StorageError("quota_exceeded")`       |

The domain never sees a driver object.

### 10.3 Transactions

`transaction(work)` issues `BEGIN`, awaits `work`, then `COMMIT`, and rolls back
on any throw. Probe confirmed the call sequence and zero rows after failure.
Nested transactions throw `UnsupportedError`.

### 10.4 Migrations and version

`drizzle-kit` generates SQL; the files are committed. `drizzle-kit push` is
forbidden outside local experiments. Application uses
`drizzle-orm/sqlite-proxy/migrator`; B4 must prove it works through the
`node:sqlite` bridge before anything else is built on it.

FTS5 cannot be expressed by the table builder, so it is a custom migration
created with `drizzle-kit generate --custom --name=fts5` (verified: it creates the
SQL file and registers it in `meta/_journal.json`):

```sql
CREATE VIRTUAL TABLE files_fts USING fts5(name, content='files', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE notes_fts USING fts5(title, content, content='notes', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
-- plus AFTER INSERT/UPDATE/DELETE triggers keeping both in sync
```

`schemaVersion` is `PRAGMA user_version`, set to the applied migration count at
the end of `init()`. It is an integer comparable across processes, so the UI can
refuse data written by newer code.

### 10.5 Blob store and honesty about atomicity

`FileSystemBlobStore({ rootDir })`:

- Writes to `<rootDir>/blobs/<first2>/<key>`, keys generated only.
- Rejects any key not matching `/^[0-9a-f-]{36}$/` before building a path.
- Writes to a temp file in the same directory, then renames.
- `purgeOrphans` removes files whose key is not in the metadata set.

Metadata is transactional; blobs are not. The correct sequence is:

- Create: write blob, then insert the row in a transaction. A crash between them
  leaves an orphan blob, removed by `purgeOrphans`.
- Delete: delete the row in a transaction, then delete the blob. A failure after
  commit leaves an orphan, again removed by `purgeOrphans`.
- Restore: write new blobs, commit metadata, then delete replaced blobs. A
  rollback deletes the new blobs.

The earlier draft claimed a failed blob delete rolls back the row delete. It
cannot, and the spec no longer says so. Traversal tests (`../../etc/passwd`,
absolute paths, percent-encoded variants) must throw before any filesystem call.

### 10.6 Search

`notes_fts` and `files_fts` are queried with `toMatchQuery(text)` from `core`,
which quotes tokens, so no input can produce invalid FTS5 syntax.
`file` hits search the file name; `note` hits search title and content. Folder
filtering joins against a recursive CTE over `folders`. Tag filtering joins the
join tables. `snippet()` produces the excerpt; `bm25()` produces `score`.

## 11. Validation (`@opennest/validation`)

Zod 4.6.7, named by PRD section 8. Schemas are pure and do not import adapters.

### 11.1 Schemas

- `folderInputSchema`, `folderPatchSchema`
- `fileInputSchema`, `filePatchSchema`, `fileFilterSchema`
- `noteInputSchema`, `notePatchSchema`, `noteFilterSchema`
- `tagInputSchema`, `tagPatchSchema`
- `searchQuerySchema`
- `backupSnapshotSchema` (mirrors 8.6, validates every reference before apply)
- `restoreManifestSchema` (Stage D uses it; shape defined now)

`restoreManifestSchema` describes the zip manifest, not the snapshot inside it:

```ts
export interface RestoreManifest {
  manifestVersion: 1;
  snapshotVersion: 1;
  schemaVersion: number;
  kind: "dexie" | "sqlite";
  createdAt: IsoDate;
  entries: Array<{ path: string; bytes: number; sha256: string }>;
}
```

`path` is a forward-slash relative path inside the archive with no `..` segment,
no leading slash, and no backslash. `bytes` is the uncompressed length and
`sha256` is the lowercase hex digest of that entry. Stage D cross-checks every
entry against the snapshot's blobs before calling `restore()`; this schema only
proves the manifest is well formed.

Filter schemas are typed `ZodType<FileFilter>` and `ZodType<NoteFilter>` so they
must match the port types exactly.

### 11.2 Concrete limits

The numbers below are the source of truth for what the limits _are_. The values
live in `packages/core/src/limits.ts` (6.6), and every consumer reads them from
there. This table is documentation, not a second implementation.

| Item           | Rule                                                                                                                                                                 | Rationale                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Display name   | 1 to 255 chars after trim, no `/`, `\`, or control chars                                                                                                             | PRD safe file handling                 |
| Note title     | 1 to 200 chars                                                                                                                                                       | Fits the UI, keeps FTS titles readable |
| Note content   | up to 1,000,000 chars                                                                                                                                                | Generous, bounded                      |
| Tag name       | 1 to 50 chars, normalized key for uniqueness                                                                                                                         | UI chip width                          |
| Tag color      | `#RRGGBB` or null                                                                                                                                                    | Design tokens                          |
| File size      | 0 to 25 MiB (26,214,400 bytes)                                                                                                                                       | IndexedDB and mobile practical limit   |
| MIME allowlist | `application/pdf`, `text/plain`, `text/markdown`, `image/png`, `image/jpeg`, `image/webp`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | PRD section 4 initial formats          |
| DOCX           | Accepted and stored; preview explicitly unsupported in the MVP                                                                                                       | PRD says DOCX support "can follow"     |
| Checksum       | lowercase hex SHA-256, 64 chars or null                                                                                                                              | Integrity, Stage D                     |
| Blob key       | UUID v4 string                                                                                                                                                       | Traversal safety                       |
| Page size      | `limit` 1 to 500, default chosen by the adapter                                                                                                                      | Largest page the services request      |
| Search text    | 0 to 1,000 chars; empty or punctuation-only text returns no hits                                                                                                     | Bounded FTS and Dexie work             |

A zero-byte upload is accepted (some systems produce empty files) but Stage C
should warn. A `null` MIME type is accepted and stored as null; PRD allows the
column to be nullable.

## 12. Error handling

One hierarchy in `core/src/errors.ts`. No bare `throw new Error` across module
boundaries.

```ts
export class DomainError extends Error {
  constructor(message: string, readonly code: DomainErrorCode, options?: { cause?: unknown });
}
export class ValidationError extends DomainError {}
export class NotFoundError extends DomainError {}
export class ConflictError extends DomainError {}
export class ConstraintError extends DomainError {}
export class UnsafeKeyError extends DomainError {}
export class NoRandomSourceError extends DomainError {}
export class StorageError extends DomainError {}
export class UnsupportedError extends DomainError {}
```

`DomainErrorCode` is a closed string union: `validation`, `not_found`,
`duplicate_id`, `duplicate_tag_name`, `missing_reference`, `folder_cycle`,
`self_link`, `cross_workspace`, `unsafe_key`, `quota_exceeded`, `closed`,
`nested_transaction`, `no_random_source`, `multiple_workspaces`,
`corrupt_data`. Stage C maps each to a localized message; Stage D maps each to
an HTTP status. No string matching.

`NoRandomSourceError` (`no_random_source`) is what `createIdGenerator` and the
default `generateId` throw when neither `crypto.randomUUID` nor
`crypto.getRandomValues` is available. It is a typed `DomainError` like the
rest, so nothing throws bare `Error` across a module boundary.

Adapters wrap driver failures as `StorageError` with the driver error as `cause`
and never leak a Dexie or SQLite object upward.

## 13. Testing strategy

### 13.1 Unit

- `core`: ids and the v4 fallback, every rule, services with in-memory fakes.
- `validation`: every schema, valid and invalid, all boundary values from 11.2.
- Adapters: mapping of booleans, timestamps, error codes.

### 13.2 Conformance suite

`@opennest/storage-conformance` exports:

```ts
export function runStorageConformance(
  name: string,
  create: () => Promise<StorageAdapter>
): void;
```

It registers one `describe` per scenario. Both adapters call it from their own
test files. Required scenarios:

1. `init()` twice is idempotent; use after `close()` throws `closed`.
2. `ensureWorkspace()` creates once and returns the same row afterwards; with two
   existing workspaces it throws `multiple_workspaces` instead of guessing.
3. Folder CRUD, rename, move, reparent; unknown id gives `NotFoundError`.
4. Folder delete moves children and contained files and notes to root.
5. Folder cycle and self-parent rejected with `folder_cycle`.
6. Cross-workspace move or reference rejected with `cross_workspace`.
7. File create, rename, move, delete; metadata preserved; null MIME and null
   checksum round-trip.
8. Note CRUD, pin, repeated updates; `updatedAt` non-decreasing and the service
   clock is the only time source.
9. Tag create; exact duplicate rejected; rename onto an existing name rejected.
10. Case-insensitive duplicate tag rejected by the service path.
11. Tag delete cascades to both join tables.
12. File and note tag replacement: de-duplicates, replaces, cascades on delete.
13. Note links: replace, self-link rejected, cascade on note delete.
14. Blob put/get/has/delete, byte equality for 0-byte and 1-byte and 1 MiB
    payloads, `usage()` accounting, `purgeOrphans` removes only unknown keys.
15. Transaction rollback leaves no partial rows.
16. Nested transaction throws `nested_transaction`.
17. Pagination: stable across pages, across deletions, and across duplicate sort
    keys (ties broken by id).
18. Search: title match, body match, prefix match, folder subtree filter, tag
    filter, combined filters, token-prefix (not substring), the four-tier order
    from 8.5, and a hostile-query corpus that must never throw.
19. Restore replaces the dataset and rejects a snapshot with a dangling
    reference; a failed restore leaves the previous dataset intact.
20. `reset()` empties rows and blobs; `usage()` reports zero.
21. Every storage failure is a `DomainError` subclass with a stable code.

### 13.3 Integration

- Dexie against `fake-indexeddb` 6.2.8.
- SQLite against `:memory:` and a temp file under `$TMPDIR`, so WAL and on-disk
  blobs are exercised, with cleanup in `afterEach`.
- A fixture corpus defined once in `core/src/testing/fixtures.ts`, including
  Indonesian text with diacritics, ties in sort keys, and hostile search strings.

### 13.4 Environments

`vitest.config.ts` keeps `happy-dom` as the default. SQLite test files start with
`// @vitest-environment node`, because `node:sqlite` does not exist in the DOM
environment. Dexie files keep `happy-dom`. This is the one config detail the
earlier draft got wrong.

### 13.5 Gates

The five Stage A gates remain mandatory. Stage B adds one non-negotiable: the
conformance suite runs for both adapters inside `npm test`, not behind an opt-in
flag.

## 14. Migrations policy

- Forward only. No down migrations; restore-from-backup is the recovery path,
  which PRD section 5 already requires.
- Every migration is a committed file, never an inline `exec` at startup.
- `schemaVersion` is exposed and compared by the UI before opening data.
- SQLite: generate with `drizzle-kit`, commit the SQL and `meta/`. No `push`.
- Dexie: `version(n)` blocks are append-only; upgrades are tested against a
  synthetic older schema.
- The two adapters count versions differently (SQLite uses migration count,
  Dexie uses `version(n)`), so `schemaVersion` is adapter-local and is never
  compared across adapters. `BackupSnapshot` therefore carries `kind` and a
  separate `snapshotVersion` for the transfer format.
- `restore()` refuses a `snapshotVersion` newer than the code, and refuses a
  newer `schemaVersion` only when `kind` matches the target adapter. Restoring a
  Dexie snapshot into SQLite is allowed and is a data import, not a schema
  upgrade; every row goes through `validation` first.

## 15. Milestones

Each ends with the full gate run and a short report.

### B1: Domain core and ports

- `packages/core`: ids, entities, errors, rules, ports, in-memory fakes,
  fixtures.
- `ensureWorkspace()` idempotent, UUID id, stable default name from the catalog
  in Stage C; here a plain default string.
- ADR `0003-storage-ports-and-adapters.md` covering 5.1, 5.2, 5.3, and the
  supersession of ADR 0002's package names.
- Tests: id fallback, every rule, cycle detection, error codes, clock policy.

Acceptance: green tests; no package depends on `node:*` or `next`; no factory
importing both adapters exists.

### B2: Validation

- `packages/validation` with Zod schemas and inferred types; filters typed against
  the core ports.
- Tests for every limit in 11.2, including 0-byte, 25 MiB, 25 MiB + 1, 255-char
  names, 201-char titles, malformed colors, page bounds, search-length bounds, and
  manifest references.
- `common.ts` is the only validation module that imports `limits` and the pure
  `rules.ts` predicates; the per-entity, filter, search, snapshot, and manifest
  modules import the shared primitives from `common.ts`. A limit is never
  spelled twice; values are read from `limits`.

Acceptance: schemas reject documented bad input, accept documented good input,
and compile against the port types.

B2 decisions approved on 2026-11-12 (see 18): ISO 8601 UTC instants, strict
objects for input and patch and a stripped snapshot, uppercase checksums
normalized and uppercase blob keys rejected exactly as `rules.ts` does,
allowlist MIME types everywhere, and English messages carrying a `domainCode`
for Stage C to localize.

B2 is implemented. `packages/validation` ships `common` (shared primitives and
the `withDomainCode` wrapper), one module per entity, `filter`, `search`,
`snapshot`, `manifest`, and a barrel. `packages/validation/package.json` declares
`zod@4.6.7` and `@opennest/core`; the root lockfile resolves both, with `zod` as
a runtime dependency of validation. There is no single bridge module: `common.ts`
holds the shared primitives and is the only module importing `limits` and the
pure `rules.ts` predicates; the per-entity, filter, search, snapshot, and manifest
modules import from `common.ts`, and snapshot also imports
`assertNoFolderCycleInTree` from `checks.ts`. Two additive core changes came with
it: `validateChecksum`
in `rules.ts` (the service calls it instead of a private regex) and
`assertNoFolderCycleInTree` in `checks.ts` for archive validation.

One Zod behaviour shaped the design: `z.uuid({version:"v4"})` enforces the
version nibble, while a plain `z.uuid()` does not, and an `{ error }` string
function cannot attach `params`. The `withDomainCode` wrapper therefore parses
with an inner schema and re-raises each issue with `params.domainCode`, which is
the only way to keep one contract for every schema.

`fileInputSchema` requires `checksum` explicitly, because the port requires it
and `null` already expresses "no checksum". An omitted key is a bug, not a
default. The snapshot schema is stricter than the runtime adapters: it rejects
orphan blobs and a blob length that disagrees with `sizeBytes`, so a corrupt
archive fails before any row is replaced.

Gates after B2: format, lint (0 errors, 0 warnings), typecheck, 405 tests in 21
files (validation 198 in 6), and a production build.

The B2 end-to-end test found a real B1 bug: `createIdGenerator` called
`randomUUID` and `getRandomValues` detached from `globalThis.crypto`, and Node
rejects that with `Value of "this" must be of type Crypto`. The reference adapter
only worked because its fixtures injected a hand-written source. Both calls now
use `.call(source)`, and `ids.test.ts` has a test for each that would fail on the
old code.

### B3: IndexedDB adapter

- Dexie schema v1 with the sort indexes, all repositories, `BlobStore`,
  `transaction`, `restore`, `search`, `reset`, `purgeOrphans`.
- Conformance green against `fake-indexeddb`.
- Upgrade test from a synthetic older version.
- Error mapping for `ConstraintError` and quota.
- A browser-graph check: walk `storage-dexie`'s dependency graph and fail if
  `storage-sqlite`, `node:sqlite`, `node:fs`, or `node:crypto` appears.

Acceptance: conformance green; no `node:*` import; no Node-only dependency in the
manifest; the graph check passes.

### B4: SQLite adapter

**Gate first, build second.** The very first thing B4 does is prove that
`drizzle-orm/sqlite-proxy/migrator` applies a generated migration through the
`node:sqlite` bridge. This is the riskiest unknown in the whole stage, because
the stable Drizzle line has no native `node-sqlite` driver (4).

If that proof fails, B4 stops and the problem is reported, with the exact error
and what was tried. No silent workaround, no hand-written migration runner
substituted without asking, no switching ORM mid-stage. The only acceptable
alternatives are the ones already probed in this document (4.1), and choosing one
is a new decision, not an implementation detail.

Once the gate passes:

- Drizzle schema, generated migrations, custom FTS5 migration with triggers.
- `sqlite-proxy` driver, error mapping including errcode 13, transactions.
- `FileSystemBlobStore` with traversal, atomic write, and crash-orphan tests.
- `PRAGMA user_version` wired to the migration count.
- Conformance green on `:memory:` and on a file database.

Acceptance: same suite green; a fresh database is created from migration files
alone; FTS5 stays in sync after insert, update, and delete.

### B5: Search parity

- Both adapters implement `toMatchQuery` and `normalizeForSearch` from `core`.
- Identical hit ids and identical ordering for the shared fixture corpus, ASCII
  and Indonesian. `score` may differ and is excluded from the contract; ordering
  cannot, because 8.5 defines it by tiers plus `(foldedTitle, id)` rather than by
  score.
- Hostile queries return hits or `[]`, never throw.
- Folder subtree and tag filters produce identical result sets.

Acceptance: the parity test asserts the exact `id[]` sequence per query, so a
divergence in either matching or ordering fails. The Dexie ranking difference is
documented as score-only.

### B6: Docs, gates, and roadmap

- `docs/development.md`: adapter layout, adding a migration, running the
  conformance suite, the Dexie zone rule, search limits, the browser-graph rule,
  and the per-file test environment.
- ADR 0003 final; the "Superseded by" note at the top of ADR 0002 checked.
- `AGENTS.md`: the approved SQLite line added under Stage B.
- ROADMAP Phase 0 "Define storage interfaces" ticked.
- Root `engines` raised to `>=24.0.0`; `.nvmrc` already says 24.
- `scripts/check-browser-graph.mjs` wired into `npm test` or the build gate, so
  the browser graph is checked on every run, not only once.
- Full gates plus a browser smoke run proving Stage A is unchanged.

Acceptance: all five gates pass; both adapters pass the same suite; the browser
graph check passes; docs updated.

## 16. Risks and mitigations

| Risk                                                   | Likelihood              | Impact   | Mitigation                                                           |
| ------------------------------------------------------ | ----------------------- | -------- | -------------------------------------------------------------------- |
| Adapters drift                                         | High without discipline | High     | One conformance suite, both adapters, default `npm test`             |
| Dexie zone silently breaks atomicity                   | Medium                  | High     | Rollback scenario; documented rule; review checklist                 |
| `node:sqlite` still experimental                       | Medium                  | Medium   | Behind the proxy seam; one file to swap; pinned engine               |
| Drizzle 1.0 moves the API                              | High over time          | Medium   | Pin 0.45.4; no `node-sqlite` import; planned upgrade task            |
| `drizzle-kit` conflicts with the custom FTS5 migration | Medium                  | Medium   | Generate the custom file with the tool; never hand-edit the journal  |
| Migrator through `sqlite-proxy` fails                  | Medium                  | High     | Prove it first in B4, before building repositories on it             |
| A `node:*` import leaks into the browser graph         | Low                     | High     | `scripts/check-browser-graph.mjs` fails the B3 and B6 gates          |
| IndexedDB eviction loses data                          | Medium                  | High     | Documented; export is Stage D; no durability promise                 |
| Filesystem blob crash leaves orphans                   | Medium                  | Medium   | Write-before-insert, delete-after-commit, `purgeOrphans`             |
| Path traversal                                         | Low with guard          | Critical | Key regex, generated keys, traversal tests, atomic rename            |
| Search semantics differ                                | Medium                  | Medium   | Shared normalization and query builder; parity test on ids and order |
| Disk pressure (5.3 GB free)                            | Medium                  | Medium   | No native toolchains; temp DBs in `$TMPDIR`; cleanup                 |
| Case-insensitive tag uniqueness under concurrency      | Low (single user)       | Low      | Service check plus exact DB constraint; documented                   |

## 17. Changes to Stage A files

The instruction is not to change Stage A implementation. To test and typecheck
new packages and to keep the documented Node floor honest, exactly these additive
changes are proposed:

1. `package.json`: workspace dependencies, `typecheck:packages` script chained
   into `typecheck`, and `engines.node` raised to `>=24.0.0`.
2. `tsconfig.packages.json` (new): covers `packages/**/*.ts` with the same base.
3. `scripts/tsc-packages.mjs` (new): same resolver pattern.
4. `scripts/check-browser-graph.mjs` (new): fails if anything reachable from
   `storage-dexie` imports `storage-sqlite`, `node:sqlite`, `node:fs`, or
   `node:crypto`. Wired into the B3 and B6 gates; it protects decision 6 from
   silent regression later.
5. `.gitignore`: already covers `*.sqlite`; add a `data/` runtime directory.
6. `docs/development.md`: Node floor, adapter layout, migrations, conformance,
   and the browser-graph rule.
7. `ROADMAP.md`: tick the storage-interfaces item in B6.
8. `.nvmrc`: unchanged (already 24).
9. `docs/adr/0002-monorepo-boundaries.md`: unchanged, staying as the historical
   record. ADR 0003 supersedes only its package-boundary section; a short
   "Superseded by" note is added at the top, which is the standard way to keep an
   ADR honest without rewriting it.
10. `docs/adr/0003-storage-ports-and-adapters.md` (new): five packages, ports in
    `core`, adapter-local factories, the SQLite decision, and why the PRD's
    `database`/`storage`/`search` names are not used yet.
11. `AGENTS.md`: one additive line under Stage B recording that the SQLite adapter
    is approved for this stage, so the stage list stops contradicting PRD
    sections 8 and 9. No other line changes.

No file in `apps/web` changes in Stage B. Stage C will need to edit
`apps/web/next.config.ts` (`transpilePackages`) and possibly
`apps/web/app/globals.css` (`@source`) when it imports the new packages; that is
stated now so it is not a surprise.

## 18. Approved decisions

All six were approved by the product owner on 2026-11-12. They are no longer open
questions; they are constraints the implementation must honour.

| #   | Decision                    | Binding consequence                                                                                                                     |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Node floor `>=24.0.0`       | `engines.node` changes in B6 (17); SQLite tests require Node 24                                                                         |
| 2   | 25 MiB upload cap           | Values live only in `core/src/limits.ts` (6.6, 11.2)                                                                                    |
| 3   | Five packages               | `core`, `validation`, `storage-dexie`, `storage-sqlite`, `storage-conformance` (7); ADR 0003 records it, ADR 0002 is not rewritten (17) |
| 4   | Hard delete, no trash       | No soft-delete column; Stage C must confirm before deleting                                                                             |
| 5   | Search in the storage layer | Shared contract in `core`, identical semantics across adapters (8.5, B5)                                                                |
| 6   | SQLite adapter in Stage B   | B4 runs; `node:sqlite` stays out of the browser graph (7, 17)                                                                           |

Two standing constraints follow from the approval and are restated here because
they are easy to break accidentally:

- **Browser graph stays clean.** `storage-dexie` must not depend, directly or
  transitively, on `node:sqlite`, `node:fs`, `node:crypto`, or
  `storage-sqlite`. A build-time check in B3 and B6 asserts this, so a future
  import cannot regress it silently.
- **Domain logic depends on ports, not adapters.** Nothing in `core` names Dexie,
  SQLite, or Drizzle. That is what makes decision 6 a swap rather than a rewrite.

Eight B2 decisions were approved by the product owner on 2026-11-12, before any
validation code was written:

| #   | Decision                             | Binding consequence                                                                                                |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Restore manifest shape defined       | `RestoreManifest` in 11.1; Stage D only adds zip reading, not a schema                                             |
| 2   | `validation -> core` widened         | Types, `limits`, and pure `rules`/`checks`; ports stay out of `validation` (7)                                     |
| 3   | Core gains two numbers and one check | `maxPageSize`, `maxSearchTextLength`, `validateChecksum`, and `assertNoFolderCycleInTree` live in core (6.6, 11.2) |
| 4   | ISO 8601 UTC instants                | `Z` suffix required, offsets and date-only strings rejected                                                        |
| 5   | Strict input, tolerant snapshot      | Unknown keys rejected on input, patch, and manifest; stripped on snapshot and entity objects                       |
| 6   | Checksum and blob key parity         | Uppercase checksum normalizes to lowercase; blob key must already be lowercase                                     |
| 7   | MIME allowlist everywhere            | File input, file filter, and snapshot blob MIME all use `limits.allowedMimeTypes`                                  |
| 8   | English messages with `domainCode`   | Every issue carries `params.domainCode`; Stage C localizes, `validation` does not                                  |

## 19. Definition of done

1. `core`, `validation`, `storage-dexie`, `storage-sqlite`,
   `storage-conformance` exist with real consumers and no empty abstractions.
2. Both adapters pass the identical conformance suite in `npm test`.
3. Migrations are files, apply from an empty database, and are covered by a test.
4. Every storage failure surfaces as a `DomainError` subclass with a stable code.
5. `lint`, `typecheck`, `test`, `build`, and `format:check` all exit 0.
6. `apps/web` is byte-identical to the Stage A commit.
7. Docs explain adapter layout, migrations, the Dexie zone rule, and search
   limits; ADR 0003 records the decisions.
8. Limitations are reported: Dexie search is token-prefix and in-memory (not
   substring, not an index), browser storage can be evicted, and blob writes are
   not transactional with SQLite metadata.
9. The browser dependency graph is provably clean: no `node:*` and no
   `storage-sqlite` reachable from `storage-dexie`.
10. The B4 migrator gate was exercised before the adapter was built, and its
    outcome is recorded, including a failure if there was one.

## 20. Explicitly not in this stage

AI, cloud sync, collaboration, marketplace, plugins, PWA, export/import archives,
UI, HTTP API, authentication, encryption, OCR, and PDF extraction.
