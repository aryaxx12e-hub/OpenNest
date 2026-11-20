# Extensions

OpenNest implements local sideload extensions with a sandboxed runtime and a
small host API. Workspace access stays read-only. Extensions are optional. Core
notes, files, search, backup, and offline behavior never depend on one.

D4A is intentionally limited:

- Tier 1 code extensions only.
- Local JSON package files only.
- No registry, marketplace, auto-update, or publisher signature.
- No network access.
- No workspace writes, file bytes, credentials, or raw storage.
- AI access is off by default and only available through the host-mediated
  `ai.generate` method.
- Independent security review is not complete. See
  [extension-security-review.md](./extension-security-review.md) for the release
  gate. The Stage D internal audit and external sign-off record are in
  [stage-d-security-review.md](./stage-d-security-review.md).

## Package format

An extension is one JSON file, conventionally named
`<name>.opennest-extension.json`. The format is strict: unknown fields are
rejected.

```json
{
  "format": "opennest-extension",
  "formatVersion": 1,
  "manifest": {
    "id": "com.example.notes",
    "name": "Example notes",
    "version": "1.0.0",
    "publisher": "Example",
    "description": "Shows a workspace summary.",
    "tier": 1,
    "entry": "index.js",
    "capabilities": ["workspace.read.metadata"],
    "dataScopes": ["notes"],
    "networkOrigins": [],
    "minHostVersion": "0.1.0"
  },
  "files": {
    "index.js": "opennest.register(async () => { const summary = await opennest.call(\"workspace.summary\", {}); opennest.render({ type: \"stack\", children: [{ type: \"heading\", text: \"Workspace\" }, { type: \"text\", text: `Notes: ${summary.notes}` }] }); opennest.ready(); });"
  },
  "integrity": "sha256:<64 lowercase hex characters>"
}
```

A package contains exactly one JavaScript file. The file name must match
`manifest.entry`, and entry must be a single filename without a path. The
runtime is a classic worker, so the file cannot use ES module imports or
`importScripts`. Use plain script and wrap asynchronous work in
`opennest.register`.

### Manifest

| Field            | Requirement                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `id`             | 1-128 characters, lowercase reverse-DNS with dot or hyphen separators, for example `com.example.notes` |
| `name`           | Trimmed, 1-80 characters                                                                               |
| `version`        | Numeric `major.minor.patch`, each segment digits; updates must increase it                             |
| `publisher`      | Trimmed, 1-80 characters; an update cannot change it                                                   |
| `description`    | Up to 500 characters                                                                                   |
| `tier`           | Must be `1`                                                                                            |
| `entry`          | 1-128 characters, matches `^[A-Za-z0-9][A-Za-z0-9._-]*\.js$`                                           |
| `capabilities`   | Unique values, maximum 3, from the supported capability list                                           |
| `dataScopes`     | Unique values, maximum 4, from `notes`, `files`, `folders`, `tags`; informational only                 |
| `networkOrigins` | Must be empty                                                                                          |
| `minHostVersion` | Numeric `major.minor.patch`; must not exceed the running host version                                  |

The host validates the manifest with the shared Zod schema in
`packages/extensions/src/manifest.ts`.

### Integrity

Integrity covers the canonical JSON of this four-field payload:

```json
{ "format": "...", "formatVersion": 1, "manifest": {}, "files": {} }
```

Canonical JSON recursively sorts object keys, keeps array order, drops object
properties whose value is `undefined`, and serializes primitives with
`JSON.stringify`. The digest is SHA-256 over the UTF-8 bytes, written as
`sha256:<hex>`.

A small Node script to produce a valid package:

```js
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

const pkg = JSON.parse(readFileSync("extension.json", "utf8"));
const payload = {
  format: pkg.format,
  formatVersion: pkg.formatVersion,
  manifest: pkg.manifest,
  files: pkg.files,
};
const hex = createHash("sha256").update(canonicalJson(payload)).digest("hex");

pkg.integrity = `sha256:${hex}`;
writeFileSync("example.opennest-extension.json", JSON.stringify(pkg, null, 2));
```

The manifest passes through schema normalization before hashing, including
trimming `name` and `publisher`. Keep those values trimmed when you compute the
hash.

### Package limits

- Total package JSON: at most 256 KiB, measured as UTF-8 bytes.
- Extension code: at most 128 KiB.
- Exactly one JavaScript file.

The file picker checks `File.size` before reading the file, so an oversized
package is rejected without loading its text into memory.

## Capabilities

The runtime supports three capabilities.

| Capability                | What it allows                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `workspace.read.metadata` | Workspace information and counts, note metadata, file metadata, folder IDs, and timestamps. It does not include note bodies or file bytes. |
| `workspace.read.content`  | Note bodies through `workspace.readNote`. The response also includes that note's metadata.                                                 |
| `ai.generate`             | One host-approved prompt. The extension receives only text, model, and finish reason.                                                      |

`dataScopes` describes the data classes in plain language in the consent
dialog. It does not grant access by itself. The capability is the enforcement
boundary.

The install dialog states that local packages are unsigned and should only be
installed when the user trusts their author. Every initial install requires an
explicit confirmation. On update, OpenNest shows only capabilities that are new
compared with the installed version, and requires consent only when that list is
non-empty. The package publisher must
stay the same, the version must increase, downgrades are rejected, and the same
version cannot be reinstalled with different contents.

## Extension API

The trusted shell injects a frozen `opennest` object into the worker:

```js
opennest.register(async () => {
  const summary = await opennest.call("workspace.summary", {});
  opennest.render({
    type: "stack",
    children: [
      { type: "heading", text: "Workspace summary" },
      { type: "text", text: `Notes: ${summary.notes}` },
      { type: "text", text: `Files: ${summary.files}` },
    ],
  });
  opennest.ready();
});

opennest.onAction((actionId) => {
  if (actionId === "refresh") {
    void refresh();
  }
});
```

- `register(entry)` registers the asynchronous entry point. It runs once when
  the host starts the session.
- `call(method, params)` sends a host request and resolves with the result. On
  failure it rejects with an `Error` whose `code` is the host error code.
- `render(tree)` replaces the extension surface with a validated UI tree.
- `onAction(handler)` receives the action ID of a rendered button.
- `ready()` announces that initialization is complete. The runner stays in
  `Starting` until this is called.

### Host API

All workspace methods are host-mediated and revalidate the current grant before
access. `workspace.getInfo` and `workspace.summary` take `{}`.

| Method                | Capability                | Parameters                             | Result                               |
| --------------------- | ------------------------- | -------------------------------------- | ------------------------------------ |
| `workspace.getInfo`   | `workspace.read.metadata` | `{}`                                   | `{ id, name, createdAt, updatedAt }` |
| `workspace.summary`   | `workspace.read.metadata` | `{}`                                   | `{ notes, files, folders, tags }`    |
| `workspace.listNotes` | `workspace.read.metadata` | `{ limit?, cursor? }`                  | Page of note metadata                |
| `workspace.listFiles` | `workspace.read.metadata` | `{ limit?, cursor? }`                  | Page of file metadata                |
| `workspace.readNote`  | `workspace.read.content`  | `{ noteId }`                           | One note, including `content`        |
| `ai.generate`         | `ai.generate`             | `{ prompt, maxTokens?, temperature? }` | `{ text, model, finishReason }`      |
| `storage.get`         | none                      | `{ key }`                              | `string \| null`                     |
| `storage.set`         | none                      | `{ key, value }`                       | No value                             |
| `storage.delete`      | none                      | `{ key }`                              | No value                             |
| `storage.keys`        | none                      | `{}`                                   | `string[]`                           |

`limit` is an integer from 1 to 50 and defaults to 50. `cursor` is an opaque
page cursor. A page is shaped as:

```ts
interface ExtensionPage<T> {
  items: readonly T[];
  nextCursor: string | null;
  total: number;
}
```

Note metadata:

```ts
interface ExtensionNoteMetadata {
  id: string;
  folderId: string | null;
  title: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}
```

File metadata:

```ts
interface ExtensionFileMetadata {
  id: string;
  folderId: string | null;
  name: string;
  mimeType: string | null;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}
```

`workspace.readNote` returns the note metadata plus `content: string`. There
is no method that returns file bytes, folder names, tag names, credentials,
provider handles, endpoints, or another extension's data.

### AI generation

`ai.generate` is available only when the extension declares the capability and
the host supplies an AI runtime plus a consent handler. The extension cannot
choose a provider, model, endpoint, or credential. The host selects those and
shows the exact prompt, provider label, model, origin, data classes, payload
hash, byte size, and expiry before each call.

- The request uses data class D2 and one user message.
- Prompts are limited to 32 KiB. Responses are limited to 48 KiB.
- Host consent is required for every call. A denied or failed call returns a
  generic extension error without provider details.
- The result contains only `text`, `model`, and `finishReason`.
- Audit entries record the extension principal, event, capability, and outcome.
  They never contain prompts, responses, credentials, or provider error text.

The app does not pass an AI runtime or consent handler to extensions yet, so the
capability is inactive in the current deployment even when an installed manifest
declares it. The host returns `ai_unavailable` instead of attempting a call.

### UI tree

Only these nodes are rendered. Raw HTML, links, images, custom CSS, and iframes
are not available.

```ts
type ExtensionUiNode =
  | { type: "stack"; children: ExtensionUiNode[] }
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "list"; items: string[] }
  | { type: "status"; tone: "info" | "success" | "warning" | "error"; text: string }
  | { type: "button"; id: string; label: string; disabled?: boolean };
```

Limits:

- 200 nodes per tree.
- 6 levels deep.
- 2,000 characters per text value.
- 50 items per list.
- Button labels up to 80 characters.
- Button IDs match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`.

An invalid tree is rejected with `ui_invalid` and is not rendered. Buttons are
disabled when the session is not running or an action is in flight.

### Errors

Host failures use `{ ok: false, error: { code, message } }`. The worker promise
rejects with the same code on `error.code`. Common codes include:

- `invalid_params`, `unknown_method`, `unknown_grant`, `protocol_error`.
- `response_too_large`, `extension_disabled`, `safe_mode`, `rate_limited`,
  `timeout`, `session_expired`.
- `storage_key`, `storage_quota`, `storage_value_too_large`, `storage_failed`.
- `ui_invalid`, `extension_not_found`.

The full list is `EXTENSION_ERROR_CODES` in
`packages/extensions/src/errors.ts`.

## Storage

Extension storage is host-mediated and namespaced by extension ID. It cannot
read another extension's storage and cannot use it as a covert channel beyond
its quota.

- 1 MiB per extension, counting key and value UTF-8 bytes.
- At most 256 keys.
- At most 64 KiB per value.
- Keys match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`.
- Values are strings. Encode structured data as JSON yourself.
- Uninstall removes the namespace. Reinstall starts empty.
- Storage is excluded from backup v1 and backup v2.
- Delete-all clears extension records and extension storage.

## Sessions and resource limits

Only one extension session runs at a time. Starting another extension stops the
current one. A disabled extension, safe mode, a missing record, or a disposed
runtime prevents a start.

| Limit                | Value                                    |
| -------------------- | ---------------------------------------- |
| Shell-ready timeout  | 10 seconds                               |
| Message size         | 64 KiB per message                       |
| Host response size   | 64 KiB; larger results fail safely       |
| Host request timeout | 5 seconds                                |
| Request rate         | 120 per minute                           |
| UI update rate       | 30 per minute                            |
| Heartbeat interval   | 1 second                                 |
| Heartbeat timeout    | 5 seconds                                |
| Session duration     | 30 minutes                               |
| Session grant TTL    | 1 hour, session-only and cleared on end  |
| UI tree              | 200 nodes, depth 6, 2,000-character text |
| Extension storage    | 1 MiB, 256 keys, 64 KiB per value        |
| Package size         | 256 KiB total, 128 KiB code              |

A protocol violation, oversized extension message, heartbeat loss, or expired
session ends the session and is audited. An invalid UI tree is rejected without
replacing the last valid surface. A host result over 64 KiB is replaced with a
small `response_too_large` failure instead of being posted. UI updates above 30
per minute return `rate_limited` and leave the last surface intact.

## Install, update, disable, uninstall, and safe mode

1. Open `/extensions` or the Extensions card in Settings.
2. Choose a local extension JSON file. Nothing is uploaded.
3. OpenNest checks the file size before reading, parses the package, verifies
   integrity, checks the host version, and prepares an install preview.
4. Review the unsigned-package warning and requested capabilities. Initial
   install always requires confirmation.
5. Install, then open the extension card to run it.

Update:

1. Choose a newer package with the same ID and publisher.
2. If it adds capabilities, the dialog lists only the new permissions.
3. Confirm to update. Existing extension storage is kept.

Disable stops the active session and prevents new starts. Enable permits a new
start; it does not start the extension automatically. Uninstall stops the
session, removes the extension record, and removes its storage.

Safe mode is a global local switch. Turning it on stops the active session and
blocks every new session until it is turned off. The state is persisted and
audited.

Extension lifecycle events appear in the Privacy Center audit history:
`extension.installed`, `extension.updated`, `extension.enabled`,
`extension.disabled`, `extension.uninstalled`, `extension.started`,
`extension.terminated`, `extension.integrity_failed`, and
`extension.safe_mode`. Installed extension metadata appears in the privacy
inventory.

## Security boundary

- Extension code runs in a blob worker inside a `srcdoc` iframe with
  `sandbox="allow-scripts"`, never with `allow-same-origin`.
- The iframe document uses a restrictive CSP with `default-src 'none'`,
  `connect-src 'none'`, `worker-src blob:`, and no inline script.
- The worker prelude removes browser globals such as `fetch`, `XMLHttpRequest`,
  `WebSocket`, `indexedDB`, `localStorage`, `Worker`, `SharedWorker`,
  `BroadcastChannel`, and `importScripts`.
- The host binds the `MessageChannel` to the iframe's `event.source`; the opaque
  origin serializes as `null` and is not used as the only authentication.
- `/extension-sandbox.js` is the one public asset that overrides the app's
  `Cross-Origin-Resource-Policy: same-origin` policy with `cross-origin`, so the
  opaque-origin iframe can load the trusted shell. App pages keep `same-origin`.
- The host validates message size, method, params, grant, scope, expiry, rate,
  timeout, and UI shape. It checks package file size before reading, caps host
  responses, and rate-limits UI updates.
- No network method exists. Requested network origins are rejected at parse
  time.
- No write, export, delete, credential, or raw storage method exists.

Known residual risks: browser sandbox and CSP bugs, a malicious sideloaded
package, a compromised host origin, and timing, size, or error side channels.
Local sideload is a user trust decision. Packages are unsigned in D4A.

## PWA and offline behavior

The service worker precaches `/extensions` and `/extension-sandbox.js` along
with the rest of the shell. Installed extension records and extension storage
live in IndexedDB. The `/extensions/[extensionId]` runner route is dynamic and
follows the normal navigation fallback when offline. Extension install requires
a local file picker and works without a network.

## Out of scope for D4A

- Tier 0 declarative packs.
- Publisher signatures and key rotation.
- Registry, marketplace, discovery, billing, and moderation.
- Auto-update and background updates.
- Host-mediated network grants or any network egress.
- Workspace writes, file bytes, exports, deletes, credentials, and AI tools.
- Multiple simultaneous extension sessions.
- Extension import or export of its own storage.
- Independent security review. See
  [docs/extension-security-review.md](./extension-security-review.md) for the
  gate.

See ADR 0010 for the architecture decision and
`docs/e2ee-threat-model.md` for the separate encryption threat model.
