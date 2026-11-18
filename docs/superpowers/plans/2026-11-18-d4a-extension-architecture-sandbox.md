# D4A Extension Architecture and Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementasi D4A: extension Tier 1 lokal yang read-only, berjalan di opaque-origin sandbox, punya host storage terisolasi, consent eksplisit, audit, kill switch, dan UI deklaratif yang dirender host.

**Architecture:** Package extension adalah satu file JSON berisi manifest dan satu entry JavaScript. Kode extension berjalan di blob worker di dalam iframe `sandbox="allow-scripts"`, terpisah dari DOM, IndexedDB, localStorage, cookie, dan network. Host berkomunikasi lewat MessagePort dengan protokol tervalidasi, capability broker, batas ukuran, rate limit, timeout, heartbeat, dan audit. UI extension dikirim sebagai pohon node terbatas dan dirender oleh komponen React host.

**Tech Stack:** TypeScript 5.9, Next.js 16, React 19, Dexie 4, zod 4, `@opennest/privacy`, Vitest, Playwright, Node 24.

**Spec:** `docs/adr/0010-extension-architecture.md`

**Execution mode:** Native. Implementer mengerjakan task secara berurutan di sesi ini. Jangan commit kecuali Rya memintanya.

## Global Constraints

- D4A hanya mengimplementasikan Tier 1 sandboxed code. Tier 0, registry publik, signature, marketplace, auto-update, dan network grant ditunda.
- Host API read-only: `workspace.read.metadata`, `workspace.read.content`, dan host storage. Tidak ada `workspace.write`, `workspace.export`, atau `workspace.delete`.
- Manifest dengan `networkOrigins` tidak kosong harus ditolak. CSP sandbox memakai `connect-src 'none'`.
- Tidak ada auto-run. Extension hanya berjalan saat user membuka route run.
- Uninstall selalu menghapus data extension. Disable mempertahankan data.
- Safe mode memblokir start baru dan menghentikan sesi aktif.
- Semua teks UI harus tersedia di `en` dan `id`.
- Validasi batas sistem memakai zod strict. Jangan memakai `any` atau type assertion tanpa alasan.
- Shell sandbox adalah host code tepercaya. Kode extension tidak boleh masuk ke dokumen iframe, hanya ke worker.
- Jangan menambahkan dependency runtime baru. `zod 4.6.7` sudah ada di lockfile.
- Jangan commit kecuali Rya memintanya secara eksplisit.
- Jangan klaim selesai sebelum `npm test`, typecheck, lint, format check, browser graph check, build, dan e2e dijalankan.

## Review Focus

1. Package JSON hostile, terlalu besar, hash salah, path traversal, atau capability terlarang harus ditolak sebelum disimpan atau dijalankan. Test ada di Task 1, 3, dan 11.
2. Sandbox escape melalui atribut iframe, CSP, navigasi, blob/data script, atau akses langsung ke DOM dan storage harus gagal. Test ada di Task 5, 7, dan 11.
3. IPC spoofing, pesan raksasa, prototype pollution, request flooding, dan worker yang hang harus ditolak atau dihentikan. Test ada di Task 6, 7, dan 8.
4. Update yang menambah capability harus meminta consent ulang, dan metadata tidak boleh membocorkan isi catatan. Test ada di Task 3, 6, dan 11.
5. Disable, uninstall, delete-all, dan safe mode harus menangani data serta sesi dengan benar. Test ada di Task 2, 3, 8, dan 11.

## Sandbox Proof Correction

A proof in Chromium showed that a blob script created by the parent is blocked inside an opaque-origin iframe with `Not allowed to load local resource`. The working design is a static same-origin shell loaded by the sandbox document:

```html
<script src="https://app.example/extension-sandbox.js"></script>
```

The child CSP names the host origin explicitly. The iframe uses only `sandbox="allow-scripts"`. Extension code runs in a blob worker inside the opaque origin. The proof confirmed that the opaque document has origin `null`, localStorage and IndexedDB throw `SecurityError`, direct `fetch` is blocked, a blob worker can be created, and worker `fetch` is also blocked.

## File Structure

```text
packages/extensions/
  package.json
  src/
    api.ts                 DTO host API
    errors.ts              ExtensionError dan kode error
    index.ts               Export publik
    manifest.ts            Schema manifest dan package
    package.ts             Parse, create, verify integrity
    protocol.ts            Tipe pesan worker dan host
    registry.ts            Install, update, enable, disable, uninstall
    store.ts               Interface ExtensionStore dan storage quota
    memory-store.ts        Implementasi memory untuk test
    ui.ts                  Schema pohon UI deklaratif
    version.ts             Perbandingan semver sederhana
    __tests__/
      package.test.ts
      registry.test.ts
      store.test.ts
      ui.test.ts
      version.test.ts

apps/web/lib/extensions/
  dexie-store.ts           Implementasi Dexie opennest-extensions
  host-api.ts              Method workspace dan storage
  protocol.ts              Schema pesan runtime
  sandbox-document.ts      Pembuat srcdoc dan CSP anak
  session.ts               Grant, RPC, limit, heartbeat, audit
  runtime.ts               Facade registry dan sesi aktif
  transport.ts             Interface transport dan frame transport
  __tests__/
    dexie-store.test.ts
    frame-guard.test.ts
    host-api.test.ts
    protocol.test.ts
    runtime.test.ts
    sandbox-document.test.ts
    session.test.ts

apps/web/public/
  extension-sandbox.js     Shell tepercaya, proxy port, worker wrapper

apps/web/components/
  extension-install-dialog.tsx
  extension-runner.tsx
  extension-ui.tsx
  extensions-view.tsx

apps/web/app/extensions/
  page.tsx
  [extensionId]/page.tsx

apps/web/components/__tests__/
  extension-install-dialog.test.tsx
  extension-runner.test.tsx
  extension-ui.test.tsx
  extensions-view.test.tsx

scripts/
  e2e-extensions.mjs
```

---

### Task 1: Paket, integritas, dan kontrak UI

**Files:**

- Create: `packages/extensions/package.json`
- Create: `packages/extensions/src/{errors,manifest,package,api,ui,version,index}.ts`
- Test: `packages/extensions/src/__tests__/{package,ui,version}.test.ts`

**Interfaces:**

- Produces: `createExtensionPackage(input): Promise<ExtensionPackage>`
- Produces: `parseExtensionPackage(text): ExtensionPackage`
- Produces: `verifyExtensionIntegrity(pkg): Promise<VerifiedExtensionPackage>`
- Produces: `validateExtensionUiTree(value): ExtensionUiNode`
- Produces: `compareVersions(left, right): -1 | 0 | 1`
- Produces: `ExtensionError` dengan `code` dan `message`

- [ ] **Step 1: Tulis test package dan UI yang gagal**

Test assertions:

```ts
const pkg = await createExtensionPackage({ manifest, code });
expect(pkg.integrity).toMatch(/^sha256:[0-9a-f]{64}$/);
expect((await verifyExtensionIntegrity(pkg)).code).toBe(code);

await expect(
  verifyExtensionIntegrity({ ...pkg, files: { "main.js": "tampered" } })
).rejects.toMatchObject({ code: "integrity_mismatch" });
await expect(
  parseExtensionPackage(JSON.stringify({ ...pkg, capabilities: ["workspace.write"] }))
).toThrow("unsupported_capability");
await expect(
  parseExtensionPackage(JSON.stringify({ ...pkg, networkOrigins: ["https://x.test"] }))
).toThrow("unsupported_network");
```

Test UI:

```ts
expect(validateExtensionUiTree({ type: "heading", text: "Hello" }).type).toBe("heading");
expect(() => validateExtensionUiTree({ type: "html", html: "<img>" })).toThrow(
  "ui_invalid"
);
expect(() => validateExtensionUiTree(nestedDepth(7))).toThrow("ui_invalid");
expect(() => validateExtensionUiTree({ type: "text", text: "x".repeat(2001) })).toThrow(
  "ui_invalid"
);
```

- [ ] **Step 2: Jalankan test untuk memastikan gagal**

Run: `node scripts/vitest.mjs run packages/extensions/src/__tests__/package.test.ts packages/extensions/src/__tests__/ui.test.ts packages/extensions/src/__tests__/version.test.ts`
Expected: FAIL karena modul belum ada.

- [ ] **Step 3: Implementasi schema dan hash**

Buat manifest strict dengan field `id`, `name`, `version`, `publisher`, `description`, `tier: 1`, `entry`, `capabilities`, `dataScopes`, `networkOrigins`, `minHostVersion`. Hanya izinkan dua capability workspace dan `networkOrigins` harus array kosong. `files` harus berisi tepat satu file, namanya sama dengan `entry`, tidak boleh path traversal. Batas: package 256 KiB, code 128 KiB, UI 200 node, depth 6, teks 2000 karakter.

Hash memakai `canonicalJson` dan `sha256Hex` dari `@opennest/privacy`:

```ts
const payload = { format, formatVersion, manifest, files };
const integrity = `sha256:${await sha256Hex(canonicalJson(payload))}`;
```

- [ ] **Step 4: Jalankan test, typecheck, dan lint**

Run: `node scripts/vitest.mjs run packages/extensions/src/__tests__`
Run: `npm run typecheck:packages`
Run: `node scripts/eslint.mjs packages/extensions`
Expected: PASS.

- [ ] **Step 5: Stop untuk review**

Jangan commit. Laporkan file dan hasil test.

---

### Task 2: Store dan isolated storage

**Files:**

- Create: `packages/extensions/src/{store,memory-store}.ts`
- Create: `apps/web/lib/extensions/dexie-store.ts`
- Test: `packages/extensions/src/__tests__/store.test.ts`
- Test: `apps/web/lib/extensions/__tests__/dexie-store.test.ts`

**Interfaces:**

- Produces: `ExtensionStore` dengan `extensions`, `storage`, `getSafeMode`, `setSafeMode`, `uninstall`, `reset`, `init`, `close`
- Produces: `StoredExtension { id, manifest, code, integrity, installedAt, updatedAt, enabled }`
- Produces: `ExtensionStorageStore` dengan `get`, `set`, `delete`, `keys`, `clear`, `usage`
- Produces: `createMemoryExtensionStore()`
- Produces: `createDexieExtensionStore(options?)`

- [ ] **Step 1: Tulis test contract store yang gagal**

Test assertions:

```ts
await store.extensions.put(record);
expect(await store.extensions.get("com.example.demo")).toMatchObject({ enabled: true });
expect(await store.storage.get("com.example.demo", "count")).toBeNull();

await store.storage.set("com.example.demo", "count", "1");
await store.storage.set("com.example.other", "count", "9");
expect(await store.storage.get("com.example.demo", "count")).toBe("1");
expect(await store.storage.keys("com.example.demo")).toEqual(["count"]);

await expect(
  store.storage.set("com.example.demo", "huge", "x".repeat(64 * 1024 + 1))
).rejects.toMatchObject({ code: "storage_value_too_large" });
await expect(store.storage.set("com.example.demo", "bad key", "x")).rejects.toMatchObject(
  { code: "storage_key" }
);
```

Test uninstall:

```ts
await store.uninstall("com.example.demo");
expect(await store.extensions.get("com.example.demo")).toBeNull();
expect(await store.storage.keys("com.example.demo")).toEqual([]);
```

- [ ] **Step 2: Jalankan test untuk memastikan gagal**

Run: `node scripts/vitest.mjs run packages/extensions/src/__tests__/store.test.ts apps/web/lib/extensions/__tests__/dexie-store.test.ts`

- [ ] **Step 3: Implementasi memory dan Dexie store**

Dexie database `opennest-extensions`:

```text
extensions: "id, enabled, updatedAt"
storage:    "[extensionId+key], extensionId"
meta:       "key"
```

Quota: 1 MiB total per extension, 256 key, 64 KiB per value. Hitung byte UTF-8 dari key dan value. `uninstall` harus menghapus record extension dan seluruh storage dalam satu transaksi Dexie. `reset` menghapus semua tabel. Safe mode disimpan di `meta`.

- [ ] **Step 4: Jalankan test dan browser graph check**

Run: `node scripts/vitest.mjs run packages/extensions/src/__tests__/store.test.ts apps/web/lib/extensions/__tests__/dexie-store.test.ts`
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Stop untuk review**

---

### Task 3: Registry lifecycle dan consent

**Files:**

- Create: `packages/extensions/src/registry.ts`
- Test: `packages/extensions/src/__tests__/registry.test.ts`

**Interfaces:**

- Produces: `createExtensionRegistry({ store, audit, now, hostVersion }): ExtensionRegistry`
- Produces: `prepareInstall(text): Promise<InstallPreview>`
- Produces: `install(preview, acceptedCapabilities): Promise<StoredExtension>`
- Produces: `setEnabled`, `uninstall`, `setSafeMode`, `getSafeMode`, `list`, `get`

- [ ] **Step 1: Tulis test lifecycle yang gagal**

Test assertions:

```ts
const preview = await registry.prepareInstall(v1Text);
expect(preview.action).toBe("install");
expect(preview.requiredCapabilities).toEqual(["workspace.read.metadata"]);
const installed = await registry.install(preview, preview.requiredCapabilities);
expect(installed.enabled).toBe(true);

await expect(registry.install(preview, [])).rejects.toMatchObject({
  code: "consent_required",
});
await expect(registry.prepareInstall(lowerVersionText)).rejects.toMatchObject({
  code: "version_downgrade",
});
await expect(registry.prepareInstall(changedPublisherText)).rejects.toMatchObject({
  code: "publisher_mismatch",
});
```

Update:

```ts
const update = await registry.prepareInstall(v2WithContentText);
expect(update.action).toBe("update");
expect(update.requiresConsent).toBe(true);
expect(update.requiredCapabilities).toEqual(["workspace.read.content"]);
await expect(registry.install(update, ["workspace.read.metadata"])).rejects.toMatchObject(
  { code: "consent_required" }
);
await registry.install(update, ["workspace.read.content"]);
```

Persistence:

```ts
await registry.setEnabled(id, false);
expect(await store.storage.keys(id)).not.toEqual([]);
await registry.uninstall(id);
expect(await store.storage.keys(id)).toEqual([]);
expect(auditEvents).toContain("extension.uninstalled");
```

- [ ] **Step 2: Jalankan test untuk memastikan gagal**

Run: `node scripts/vitest.mjs run packages/extensions/src/__tests__/registry.test.ts`

- [ ] **Step 3: Implementasi registry**

Aturan:

- Fresh install: semua capability wajib diterima.
- Update: publisher dan ID harus sama.
- Versi lebih rendah: `version_downgrade`.
- Versi sama dengan integrity berbeda: `version_conflict`.
- Versi sama dan integrity sama: `already_installed`.
- Capability baru: `requiresConsent: true`.
- `install` wajib memverifikasi ulang integrity sebelum menulis.
- `setEnabled` dan `uninstall` menulis audit.
- `uninstall` memakai `store.uninstall` agar data ikut terhapus.
- `minHostVersion` lebih tinggi dari `hostVersion` ditolak.

- [ ] **Step 4: Jalankan test dan typecheck**

Run: `node scripts/vitest.mjs run packages/extensions/src/__tests__/registry.test.ts`
Run: `npm run typecheck:packages`
Expected: PASS.

- [ ] **Step 5: Stop untuk review**

---

### Task 4: Privacy audit, inventory, dan flow

**Files:**

- Modify: `packages/privacy/src/types.ts`
- Modify: `packages/privacy/src/inventory.ts`
- Modify: `apps/web/components/privacy-audit.tsx`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`
- Test: `packages/privacy/src/__tests__/inventory.test.ts`
- Test: `apps/web/lib/privacy/__tests__/backup-exclusion.test.ts`

**Interfaces:**

- Produces: event audit baru: `extension.installed`, `extension.updated`, `extension.enabled`, `extension.disabled`, `extension.uninstalled`, `extension.started`, `extension.terminated`, `extension.integrity_failed`, `extension.safe_mode`.
- Produces: inventory `extensions` dan `extension-storage`.
- Modifies: flow `extension` menjadi `available: true`.

- [ ] **Step 1: Tulis test inventory yang gagal**

Assertions:

```ts
expect(dataInventory.find((entry) => entry.id === "extensions")).toMatchObject({
  dataClass: "D1",
  storage: "indexeddb",
  includedInBackup: false,
});
expect(dataInventory.find((entry) => entry.id === "extension-storage")).toMatchObject({
  dataClass: "D2",
  storage: "indexeddb",
  includedInBackup: false,
});
expect(flowMatrix.find((flow) => flow.id === "extension")?.available).toBe(true);
```

Tambahkan assertion bahwa `extension-storage` tidak masuk backup v1 atau v2.

- [ ] **Step 2: Jalankan test untuk memastikan gagal**

Run: `node scripts/vitest.mjs run packages/privacy/src/__tests__/inventory.test.ts apps/web/lib/privacy/__tests__/backup-exclusion.test.ts`

- [ ] **Step 3: Implementasi event, inventory, dan label**

Tambahkan event ke union `AuditEvent`. Tambahkan dua entry inventory dan label `privacy.inventory.items.extensions` serta `privacy.inventory.items.extensionStorage`. Update `privacy.flows.description` agar menyebut extension. Tambahkan label audit extension di `privacy.audit.events.extension.*` dan map di `privacy-audit.tsx`.

- [ ] **Step 4: Jalankan test, typecheck, dan localization test**

Run: `node scripts/vitest.mjs run packages/privacy/src/__tests__/inventory.test.ts apps/web/lib/privacy/__tests__/backup-exclusion.test.ts apps/web/components/__tests__/privacy-inventory.test.tsx`
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Stop untuk review**

---

### Task 5: Protokol sandbox, dokumen, dan shell

**Files:**

- Create: `packages/extensions/src/protocol.ts`
- Create: `apps/web/lib/extensions/protocol.ts`
- Create: `apps/web/lib/extensions/sandbox-document.ts`
- Create: `apps/web/public/extension-sandbox.js`
- Test: `apps/web/lib/extensions/__tests__/protocol.test.ts`
- Test: `apps/web/lib/extensions/__tests__/sandbox-document.test.ts`

**Interfaces:**

- Produces: `buildExtensionSandboxDocument(origin): string`
- Produces: `workerToHostSchema`, `hostToWorkerSchema`
- Produces: limit `EXTENSION_MAX_MESSAGE_BYTES = 64 * 1024`

- [ ] **Step 1: Tulis test dokumen sandbox yang gagal**

Assertions:

```ts
const html = buildExtensionSandboxDocument("https://app.test");
expect(html).toContain("default-src 'none'");
expect(html).toContain("script-src https://app.test");
expect(html).toContain("worker-src blob:");
expect(html).toContain("connect-src 'none'");
expect(html).toContain("frame-src 'none'");
expect(html).toContain('<script src="https://app.test/extension-sandbox.js"></script>');
expect(html).not.toContain("'unsafe-inline'");
expect(html).not.toContain("'unsafe-eval'");
expect(html).not.toContain("blob:");
expect(html).not.toContain("<script>");
```

Protocol:

```ts
expect(workerToHostSchema.safeParse({ type: "worker:ready" }).success).toBe(true);
expect(
  workerToHostSchema.safeParse({
    type: "worker:request",
    id: "1",
    method: "workspace.summary",
    params: {},
  }).success
).toBe(true);
expect(
  workerToHostSchema.safeParse({
    type: "worker:request",
    id: "1",
    method: "x",
    params: {},
    extra: true,
  }).success
).toBe(false);
expect(
  workerToHostSchema.safeParse({ type: "worker:ui", tree: { type: "html" } }).success
).toBe(false);
```

- [ ] **Step 2: Jalankan test untuk memastikan gagal**

Run: `node scripts/vitest.mjs run apps/web/lib/extensions/__tests__/protocol.test.ts apps/web/lib/extensions/__tests__/sandbox-document.test.ts`

- [ ] **Step 3: Implementasi dokumen dan shell**

`buildExtensionSandboxDocument` menghasilkan HTML minimal tanpa style, tanpa inline script, dan memakai script same-origin. CSP lengkap:

```text
default-src 'none';
script-src ${origin};
worker-src blob:;
connect-src 'none';
img-src 'none';
style-src 'none';
font-src 'none';
media-src 'none';
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
manifest-src 'none'
```

`extension-sandbox.js`:

- Kirim `shell:ready` ke parent.
- Validasi `event.source === parent` dan `event.data.type === "opennest:init"`.
- Terima `MessagePort`, simpan `hostOrigin`, lalu kirim semua pesan worker ke port.
- Saat menerima `host:start`, buat blob worker dengan prelude host dan entry code.
- Prelude menghapus akses ke `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`, `RTCPeerConnection`, `Worker`, `SharedWorker`, `importScripts`, `indexedDB`, dan `caches`.
- Prelude menyediakan `opennest.register(fn)`, `opennest.call(method, params)`, `opennest.render(tree)`, `opennest.onAction(handler)`, dan `opennest.ready()`.
- Worker tidak boleh punya akses DOM, lokasi host, atau storage host.
- Shell membatasi ukuran pesan worker maksimal 64 KiB sebelum diteruskan.
- `host:terminate` menghentikan worker dan menutup port.

- [ ] **Step 4: Jalankan test, typecheck, dan syntax check**

Run: `node scripts/vitest.mjs run apps/web/lib/extensions/__tests__/protocol.test.ts apps/web/lib/extensions/__tests__/sandbox-document.test.ts`
Run: `node --check apps/web/public/extension-sandbox.js`
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Stop untuk review**

---

### Task 6: Host API

**Files:**

- Create: `apps/web/lib/extensions/host-api.ts`
- Modify: `packages/extensions/src/api.ts`
- Test: `apps/web/lib/extensions/__tests__/host-api.test.ts`

**Interfaces:**

- Produces: `createExtensionHostApi({ extensionId, extensionName, workspace, services, broker, storage, now })`
- Produces: `handle(request: HostRequest): Promise<unknown>`
- Produces DTO: `ExtensionWorkspaceInfo`, `ExtensionWorkspaceSummary`, `ExtensionNoteMetadata`, `ExtensionNote`, `ExtensionFileMetadata`, `ExtensionPage<T>`

- [ ] **Step 1: Tulis test host API yang gagal**

Method table:

```text
workspace.getInfo       workspace.read.metadata
workspace.summary       workspace.read.metadata
workspace.listNotes     workspace.read.metadata
workspace.listFiles     workspace.read.metadata
workspace.readNote      workspace.read.content
storage.get             none
storage.set             none
storage.delete          none
storage.keys            none
```

Assertions:

```ts
const summary = await api.handle({ id: "1", method: "workspace.summary", params: {} });
expect(summary).toEqual({ notes: 1, files: 0, folders: 0, tags: 0 });

const page = await api.handle({
  id: "2",
  method: "workspace.listNotes",
  params: { limit: 5 },
});
expect(page.items[0]).not.toHaveProperty("content");

await expect(
  api.handle({ id: "3", method: "workspace.readNote", params: { noteId } })
).rejects.toMatchObject({ code: "unknown_grant" });

await expect(
  api.handle({ id: "4", method: "workspace.listNotes", params: { limit: 51 } })
).rejects.toMatchObject({ code: "invalid_params" });
```

Storage:

```ts
await api.handle({
  id: "5",
  method: "storage.set",
  params: { key: "count", value: "1" },
});
expect(
  await api.handle({ id: "6", method: "storage.get", params: { key: "count" } })
).toBe("1");
await expect(
  api.handle({ id: "7", method: "storage.set", params: { key: "bad key", value: "x" } })
).rejects.toMatchObject({ code: "storage_key" });
```

- [ ] **Step 2: Jalankan test untuk memastikan gagal**

Run: `node scripts/vitest.mjs run apps/web/lib/extensions/__tests__/host-api.test.ts`

- [ ] **Step 3: Implementasi host API**

Gunakan `broker.request` dan `broker.invoke` untuk setiap method workspace. `readNote` memakai scope `{ kind: "notes", workspaceId, noteIds: [noteId] }`. Pastikan note berasal dari workspace aktif. Semua response workspace dimap ke DTO. `listNotes` dan `listFiles` memakai limit 1 sampai 50 dan cursor opsional. Storage memakai `extensionId` dari session, bukan dari extension. Jangan pernah mengembalikan `content` dari method metadata.

- [ ] **Step 4: Jalankan test dan typecheck**

Run: `node scripts/vitest.mjs run apps/web/lib/extensions/__tests__/host-api.test.ts`
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Stop untuk review**

---

### Task 7: Session, limit, heartbeat, dan runtime facade

**Files:**

- Create: `apps/web/lib/extensions/{transport,session,runtime}.ts`
- Test: `apps/web/lib/extensions/__tests__/{session,runtime}.test.ts`

**Interfaces:**

- Produces: `ExtensionTransport { open, send, close }`
- Produces: `createExtensionSession(input): ExtensionSession`
- Produces: `createExtensionRuntime({ privacy, services, store, hostVersion, now, generateId, transportFactory })`
- Produces: `ExtensionRuntime` dengan `registry`, `start`, `stop`, `setEnabled`, `uninstall`, `setSafeMode`, `getSafeMode`, `dispose`

- [ ] **Step 1: Tulis test session dengan fake transport**

Assertions:

```ts
const session = createExtensionSession({
  record,
  workspace,
  privacy,
  services,
  storage,
  transport,
  onUi,
  onStatus,
  now,
  generateId,
});
await session.start();
expect(privacy.grants.list()).resolves.toEqual([
  expect.objectContaining({
    principalId: "extension:com.example.demo",
    sessionOnly: true,
  }),
]);

await session.handleWorkerMessage({
  type: "worker:request",
  id: "1",
  method: "workspace.summary",
  params: {},
});
expect(transport.sent).toContainEqual(
  expect.objectContaining({ type: "worker:response", id: "1", ok: true })
);
```

Limit:

```ts
await session.handleWorkerMessage({
  type: "worker:request",
  id: "1",
  method: "workspace.summary",
  params: {},
});
await session.handleWorkerMessage({
  type: "worker:request",
  id: "2",
  method: "workspace.summary",
  params: {},
});
expect(lastResponse).toMatchObject({ ok: false, error: { code: "busy" } });

expect(
  await session.handleWorkerMessage({ type: "worker:ui", tree: { type: "html" } })
).toMatchObject({ ok: false, error: { code: "ui_invalid" } });
```

Start gagal:

```ts
await expect(startWithSafeMode()).rejects.toMatchObject({ code: "safe_mode" });
await expect(startWithDisabled()).rejects.toMatchObject({ code: "disabled" });
await expect(startWithTamperedCode()).rejects.toMatchObject({
  code: "integrity_mismatch",
});
```

- [ ] **Step 2: Jalankan test untuk memastikan gagal**

Run: `node scripts/vitest.mjs run apps/web/lib/extensions/__tests__/session.test.ts apps/web/lib/extensions/__tests__/runtime.test.ts`

- [ ] **Step 3: Implementasi session dan runtime**

Session:

- Buat principal `extension:${id}` dan session ID unik per run.
- Buat grant session-only untuk setiap capability manifest dengan TTL 1 jam.
- Verifikasi ulang integrity record sebelum start.
- Audit `extension.started` setelah worker mengirim `worker:ready`.
- Audit `extension.terminated` saat stop atau gagal.
- Batas: pesan 64 KiB, satu request in-flight, 120 request per menit, timeout request 5 detik, heartbeat 1 detik dengan timeout 5 detik, durasi sesi maksimal 30 menit.
- `broker.invoke` untuk setiap host request.
- Validasi UI tree sebelum `onUi`.
- Stop: kirim terminate, tutup transport, `broker.endSession()`, bersihkan timer.

Runtime:

- Hanya satu sesi aktif.
- Start baru menghentikan sesi lama.
- Disable dan safe mode menghentikan sesi aktif.
- Uninstall menghentikan sesi lalu memanggil registry.
- Dispose menghentikan sesi dan menandai runtime disposed.

- [ ] **Step 4: Jalankan test dan typecheck**

Run: `node scripts/vitest.mjs run apps/web/lib/extensions/__tests__/session.test.ts apps/web/lib/extensions/__tests__/runtime.test.ts`
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Stop untuk review**

---

### Task 8: Frame transport dan integrasi AppDataProvider

**Files:**

- Create: `apps/web/lib/extensions/frame.ts`
- Modify: `apps/web/lib/data/app-data-provider.tsx`
- Modify: `apps/web/lib/data/__tests__/app-data-provider.test.tsx`
- Test: `apps/web/lib/extensions/__tests__/frame-guard.test.ts`

**Interfaces:**

- Produces: `createFrameTransport({ container, origin, onMessage, onFault })`
- Produces: `isTrustedShellMessage({ source, origin, expectedSource })`
- Modifies: `ReadyAppData.extensions: ExtensionRuntime`
- Modifies: `AppDataProviderProps.openExtensionStore?`

- [ ] **Step 1: Tulis test guard, provider, dan cleanup**

Guard:

```ts
expect(
  isTrustedShellMessage({
    source: iframeWindow,
    origin: "null",
    expectedSource: iframeWindow,
  })
).toBe(true);
expect(
  isTrustedShellMessage({
    source: otherWindow,
    origin: "null",
    expectedSource: iframeWindow,
  })
).toBe(false);
expect(
  isTrustedShellMessage({
    source: iframeWindow,
    origin: "https://evil.test",
    expectedSource: iframeWindow,
  })
).toBe(false);
```

Provider:

```ts
render(<AppDataProvider openExtensionStore={async () => memoryStore}>...</AppDataProvider>);
await waitReady();
expect(appData.extensions.registry.list()).resolves.toEqual([]);
await appData.privacy.data.deleteAll();
expect(await memoryStore.extensions.list()).toEqual([]);
```

- [ ] **Step 2: Jalankan test untuk memastikan gagal**

Run: `node scripts/vitest.mjs run apps/web/lib/extensions/__tests__/frame-guard.test.ts apps/web/lib/data/__tests__/app-data-provider.test.tsx`

- [ ] **Step 3: Implementasi frame dan provider**

Frame:

- Buat iframe 1x1 offscreen, `sandbox="allow-scripts"`, `aria-hidden="true"`, `tabIndex={-1}`.
- Set `srcdoc` dari `buildExtensionSandboxDocument(origin)`.
- Tunggu `shell:ready`.
- Buat `MessageChannel`.
- Kirim `{ type: "opennest:init", hostOrigin, port }` dengan target `*` karena origin iframe opaque.
- Verifikasi `event.source === iframe.contentWindow` dan `event.origin === "null"`.
- Saat close, hapus iframe dan channel.

Provider:

- Tambah `openExtensionStore` dan default memory saat IndexedDB tidak ada.
- Buat store, registry, dan runtime setelah privacy runtime.
- Tambah `extensions` ke `ReadyAppData`, `AppRuntime`, `BuiltRuntime`, dan `LoadState`.
- Dispose runtime dan store saat unmount.
- `privacy.setAuxiliaryCleanup` memanggil `extensions.stopAll()` lalu `extensionStore.reset()`.
- Jangan dispose runtime pada delete-all karena app harus tetap bisa memakai extension setelah data dihapus.

- [ ] **Step 4: Jalankan test dan typecheck**

Run: `node scripts/vitest.mjs run apps/web/lib/extensions/__tests__/frame-guard.test.ts apps/web/lib/data/__tests__/app-data-provider.test.tsx`
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Stop untuk review**

---

### Task 9: UI extension, consent, runner, dan route

**Files:**

- Create: `apps/web/components/{extensions-view,extension-install-dialog,extension-runner,extension-ui}.tsx`
- Create: `apps/web/app/extensions/page.tsx`
- Create: `apps/web/app/extensions/[extensionId]/page.tsx`
- Modify: `apps/web/components/settings-view.tsx`
- Test: `apps/web/components/__tests__/{extensions-view,extension-install-dialog,extension-runner,extension-ui}.test.tsx`

**Interfaces:**

- Consumes: `ExtensionRuntime`, `InstallPreview`, `ExtensionUiNode`
- Produces: route `/extensions` dan `/extensions/[extensionId]`

- [ ] **Step 1: Tulis test komponen yang gagal**

Test UI:

```tsx
renderUi({
  type: "stack",
  children: [
    { type: "heading", text: "Summary" },
    { type: "button", id: "refresh", label: "Refresh" },
  ],
});
buttonByText(host, "Refresh").click();
expect(onAction).toHaveBeenCalledWith("refresh");
```

Consent:

```tsx
renderInstallDialog(previewWithContentCapability);
expect(host.textContent).toContain("Read note text");
expect(host.textContent).toContain("This extension cannot access the network");
expect(confirmButton.disabled).toBe(true);
checkbox.click();
expect(confirmButton.disabled).toBe(false);
```

List dan runner:

```tsx
await waitForText(host, "No extensions installed");
expect(host.textContent).toContain("Safe mode");
```

- [ ] **Step 2: Jalankan test untuk memastikan gagal**

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/extensions-view.test.tsx apps/web/components/__tests__/extension-install-dialog.test.tsx apps/web/components/__tests__/extension-runner.test.tsx apps/web/components/__tests__/extension-ui.test.tsx`

- [ ] **Step 3: Implementasi UI dan route**

List:

- Empty state.
- File input berlabel untuk install package.
- Daftar extension dengan versi, publisher, capability, enabled toggle, uninstall.
- Safe mode banner dan tombol.
- Link ke `/extensions/{id}`.

Consent:

- Tampilkan capability dalam bahasa manusia, storage, dan "no network".
- Untuk update, tampilkan capability baru.
- Checkbox "I understand" wajib sebelum install.
- Uninstall memakai `ConfirmDialog` destructive.

Runner:

- Halaman run menampilkan status starting, running, stopped, atau error.
- Extension surface diberi label, berada di alur dokumen biasa, bukan overlay.
- Tombol Stop memanggil runtime.
- Cleanup saat unmount.
- Error code dipetakan ke localization.

Renderer:

- Hanya `stack`, `heading`, `text`, `list`, `status`, `button`.
- Tidak ada `dangerouslySetInnerHTML`, CSS dari extension, gambar, link, iframe, atau HTML mentah.
- Button memakai `@opennest/ui`.

Settings:

- Tambah card link ke `/extensions`.
- Jangan menambah item ke navigasi utama.

- [ ] **Step 4: Jalankan test, typecheck, dan lint**

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/extensions-view.test.tsx apps/web/components/__tests__/extension-install-dialog.test.tsx apps/web/components/__tests__/extension-runner.test.tsx apps/web/components/__tests__/extension-ui.test.tsx`
Run: `npm run typecheck`
Run: `node scripts/eslint.mjs apps/web/components apps/web/app/extensions`
Expected: PASS.

- [ ] **Step 5: Stop untuk review**

---

### Task 10: CSP, PWA, browser graph, dan localization

**Files:**

- Modify: `apps/web/next.config.ts`
- Modify: `apps/web/__tests__/next-config.test.ts`
- Modify: `scripts/pwa/build.mjs`
- Modify: `scripts/pwa/service-worker.js`
- Modify: `scripts/check-browser-graph.mjs`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`
- Test: `apps/web/__tests__/next-config.test.ts`
- Test: `apps/web/lib/__tests__/pwa-extension-assets.test.ts`

**Interfaces:**

- Produces: parent CSP `frame-src 'self'`
- Produces: transpile package `@opennest/extensions`
- Produces: PWA route `/extensions` dan static asset `/extension-sandbox.js`

- [ ] **Step 1: Tulis test CSP dan PWA yang gagal**

CSP:

```ts
expect(csp).toContain("frame-src 'self'");
expect(csp).toContain("frame-ancestors 'none'");
expect(nextConfig.transpilePackages).toContain("@opennest/extensions");
```

PWA:

```ts
expect(buildSource).toContain('"/extensions"');
expect(serviceWorkerSource).toContain('url.pathname === "/extension-sandbox.js"');
```

Localization parity test sudah otomatis mengecek `id` memiliki semua key `en`.

- [ ] **Step 2: Jalankan test untuk memastikan gagal**

Run: `node scripts/vitest.mjs run apps/web/__tests__/next-config.test.ts apps/web/lib/__tests__/pwa-extension-assets.test.ts`

- [ ] **Step 3: Implementasi konfigurasi dan copy**

- Tambah `frame-src 'self'` ke CSP parent.
- Tambah `@opennest/extensions` ke `transpilePackages`.
- Tambah `/extensions` ke `ROUTES`.
- Tambah handler static `/extension-sandbox.js` di service worker.
- Tambah `packages/extensions/src/index.ts` ke browser graph entries.
- Tambah `extensions.*` dan `settings.extensions*` keys di en/id.
- Pastikan semua error code host API dan runtime punya pesan lokal.
- Update `privacy.flows.description` untuk menyebut extension.

- [ ] **Step 4: Jalankan test, build, dan browser graph**

Run: `node scripts/vitest.mjs run apps/web/__tests__/next-config.test.ts apps/web/lib/__tests__/pwa-extension-assets.test.ts`
Run: `npm run check:browser-graph`
Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Stop untuk review**

---

### Task 11: E2E critical journey

**Files:**

- Create: `scripts/e2e-extensions.mjs`
- Modify: `package.json`
- Modify: `scripts/e2e-pwa.mjs` jika perlu cek asset extension

**Interfaces:**

- Produces: `npm run test:e2e:extensions`
- Modifies: `npm run test:e2e` menjalankan extension e2e

- [ ] **Step 1: Tulis e2e yang gagal**

Journey:

1. Build app lalu jalankan server.
2. Buat satu catatan dengan konten marker.
3. Buka Settings, klik link Extensions.
4. Install fixture metadata-only lewat file input.
5. Consent menampilkan read metadata dan no network. Konfirmasi.
6. Buka route run, pastikan ringkasan muncul.
7. Fixture probe melaporkan `document`, `localStorage`, `indexedDB`, `fetch`, `Worker`, dan `importScripts` tidak tersedia atau diblokir.
8. Stop lalu run ulang. Storage counter bertambah.
9. Install v2 yang menambah `workspace.read.content`. Dialog menampilkan capability baru. Cancel, lalu ulangi dan konfirmasi.
10. Run v2, pastikan isi catatan terbaca dan metadata note tidak mengandung `content`.
11. Disable, coba run, pastikan diblokir. Enable kembali.
12. Safe mode on, coba run, pastikan diblokir. Safe mode off.
13. Uninstall, konfirmasi, lalu install ulang. Storage counter kembali ke 1.
14. Buka `/privacy`, pastikan audit extension dan inventory Extensions muncul.
15. Periksa iframe: `sandbox="allow-scripts"` saja, `srcdoc` memiliki `connect-src 'none'`, dan tidak ada `allow-same-origin`.

Assertions:

```js
assert.equal(await iframe.getAttribute("sandbox"), "allow-scripts");
assert.match(await iframe.getAttribute("srcdoc"), /connect-src 'none'/);
assert.doesNotMatch(await iframe.getAttribute("srcdoc"), /allow-same-origin/);
```

CSP console error dari probe network boleh difilter hanya untuk pesan yang diharapkan.

- [ ] **Step 2: Jalankan e2e untuk memastikan gagal**

Run: `npm run build`
Run: `node scripts/e2e-extensions.mjs`
Expected: FAIL karena script atau UI belum lengkap.

- [ ] **Step 3: Implementasi fixture dan helper e2e**

Buat package fixture di `os.tmpdir()` dengan canonical JSON dan SHA-256 dari `node:crypto`. Fixture v1 hanya metadata. Fixture v2 menambah content. Fixture probe mencoba akses langsung dan merender hasilnya. Gunakan `setInputFiles` pada input file.

- [ ] **Step 4: Jalankan seluruh e2e**

Run: `node scripts/e2e-extensions.mjs`
Run: `npm run test:e2e`
Expected: PASS.

- [ ] **Step 5: Stop untuk review**

---

### Task 12: Dokumentasi dan status

**Files:**

- Create: `docs/extensions.md`
- Modify: `docs/adr/0010-extension-architecture.md`
- Modify: `docs/development.md`
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Produces: spesifikasi manifest, host API, limits, dan alur install.
- Modifies: ADR 0010 status menjadi Accepted.

- [ ] **Step 1: Tulis dokumentasi**

`docs/extensions.md` harus berisi:

- Format `.opennest-extension.json`.
- Capability D4A dan artinya.
- Host API method dan DTO.
- Storage quota.
- Batas pesan, rate, timeout, dan durasi sesi.
- Prosedur install, update, disable, uninstall, dan safe mode.
- Batasan D4A: Tier 0, signature, registry, network, dan write belum ada.

ADR:

- Status `Accepted`, tanggal 2026-11-18.
- Catatan implementasi D4A: Tier 1 only, local sideload, network denied, storage removed on uninstall.

README dan ROADMAP:

- Tandai D4A selesai hanya setelah semua test dan e2e lulus.
- Sebut independent security review masih pending.

CHANGELOG:

- Tambah entri D4A.

- [ ] **Step 2: Verifikasi dokumentasi**

Run: `npm run format:check`
Run: `rg -n "D4A|extension" ROADMAP.md docs/extensions.md docs/adr/0010-extension-architecture.md`
Expected: path dan status konsisten.

- [ ] **Step 3: Jalankan verifikasi akhir penuh**

Run: `npm test`
Run: `npm run typecheck`
Run: `npm run lint`
Run: `npm run format:check`
Run: `npm run build`
Run: `npm run test:e2e`
Expected: semua PASS. Jangan klaim lulus sebelum output benar-benar diperiksa.

- [ ] **Step 4: Laporkan hasil**

Laporkan file yang dibuat, hasil test, risiko residual, dan konfirmasi bahwa independent security review belum dilakukan. Jangan commit kecuali Rya meminta.

---

## Self-Review

- Spec coverage: package format, integrity, sandbox, CSP, IPC, capability grants, host API, lifecycle, storage, audit, inventory, PWA, localization, testing, dan docs sudah punya task.
- Scope ditahan: Tier 0, signature, registry, marketplace, network grant, dan write sengaja ditunda dan akan dicatat di docs.
- Type consistency: `ExtensionStore`, `ExtensionRuntime`, `InstallPreview`, `ExtensionTransport`, dan DTO host API dipakai konsisten di task berikutnya.
- Review Focus sudah dipetakan ke test di Task 1, 3, 5, 6, 7, 8, dan 11.
- Execution mode yang dipilih: native, dikerjakan berurutan di sesi ini.
