OpenNest 🪺

Your personal digital space. Open, private, and built for everyone.

OpenNest is an open-source personal digital workspace designed to help people organize their files, notes, documents, and knowledge in one simple place.

Built around privacy-first and local-first principles, OpenNest aims to give users control over their digital information without forcing them into subscriptions, accounts, or cloud-dependent workflows.

Status: Early access source preview v0.1.0-beta.1 is available. There is no hosted
beta. Stage A to Stage C are delivered. Stage D internal work is complete;
independent security and cryptographic review, the E2EE claim gate, and the
remaining Stage E release gates are open. Hosted CI is green. Stage E server, sync,
collaboration, AI Q&A, and read-only MCP implementations are in place, but they
are implementation previews, not supported production surfaces. No E2EE, AI
confidentiality, extension sandbox security, or MCP isolation claim is made.

🚀 Early access

The first preview is source-only. Clone or download the `v0.1.0-beta.1` tag, run it
locally with Node 24, and keep your own backups. The preview has no account, cloud
sync, collaboration flow, extension registry, or hosted OpenNest server. Read
`docs/early-access.md` and `docs/run-locally.md` before testing. Use GitHub issues
for reproducible bugs, and do not put private workspace content in an issue.

Library, notes, search, backup, and offline access work locally in the browser.
Optional content encryption and optional BYOK AI providers are implemented. Local
sideload extensions are implemented with a sandboxed, read-only host API. A
single-user self-hosted API with optional sync, real-time collaboration, and a
read-only MCP server is available as an implementation preview. See
`docs/self-hosting.md` and `docs/stage-e-release-checklist.md`.

Protocol-level E2E scripts cover sync conflicts, collaboration presence and
reconnect, AI Q&A consent and citations, and MCP workspace isolation. Browser E2E
for those journeys is blocked until the frontend exposes login, shared-workspace
binding, Q&A source selection, and MCP token management.

🌱 Our Vision

We believe everyone deserves a digital space that is:

- Private by default — Your data belongs to you.
- Local-first — Core features should work directly on your device.
- Simple to use — Useful tools without unnecessary complexity.
- Open to everyone — Open-source software shaped by its community.
- Extensible — A foundation for future integrations and community contributions.

✨ Features

Available now:

Feature| Description
My Library| Organize files and digital resources
Smart Documents| Create and organize Markdown notes
Offline ready| Install the app and reopen cached content without a connection
Optional AI console| Review and send a prompt to a provider you configure yourself
Local extensions| Install sandboxed, read-only extensions from a local JSON package
Privacy Center| Understand and manage data storage

Planned for later milestones:

Feature| Description
Knowledge Hub| Collect and manage personal knowledge
Ask OpenNest| Optional AI-powered assistance
Community Space| Discover community contributions and extensions

🚀 MVP: Personal Digital Library

The first development milestone focuses on a practical personal digital library.

MVP capabilities:

- [x] File upload and organization
- [x] Folders and tags
- [x] Document preview for supported formats
- [x] Markdown notes with autosave and draft recovery
- [x] Local search
- [x] Data export and restore from a local backup
- [x] Offline-ready Progressive Web App (PWA)
- [x] Indonesian and English interface

Stage D and Stage E capabilities implemented ahead of a supported public release:

- [x] Local sandboxed extensions with explicit read-only capabilities (review pending)
- [x] Single-user server authentication, membership, sync, file versions, and collaboration transport (release gates pending)
- [x] Document Q&A controller, host-mediated extension AI, and read-only MCP server (UI wiring and reviews pending)

Optional AI providers are available behind explicit consent. Local sideload extensions are also available behind explicit capability consent. Real-time note collaboration is opt-in through deployment settings and the self-hosted server. The browser UI does not yet mount document Q&A source selection, MCP token management, or account and invite screens. Cloud synchronization, public accounts, extension registries, and extension marketplaces remain deferred until the core experience is stable.

🧱 Technology Stack

The current technology stack is:

- Framework: Next.js and React
- Language: TypeScript
- Styling: Tailwind CSS
- UI Components: internal `@opennest/ui` package
- Browser Storage: IndexedDB with Dexie
- Database: SQLite via `node:sqlite` with Drizzle ORM
- Validation: Zod
- Testing: Vitest; browser E2E via system Playwright and Chromium
- Documentation: Markdown

The architecture uses storage abstractions so the application is not tightly coupled to a single storage implementation.

🔒 Privacy First

Privacy is a core design principle, not a premium feature.

OpenNest aims to:

- Keep personal data on the user's device by default.
- Avoid unnecessary data collection.
- Make external services optional.
- Require explicit consent before transferring personal documents to external services.
- Provide clear data export and deletion capabilities.

Browser storage has limitations, including possible eviction by the browser. Users should be able to export and back up their data.

Optional content encryption for note bodies, attached file bytes, encrypted
drafts, and backup v2 payloads is implemented under ADR 0013. It has not been
independently reviewed. OpenNest does not claim end-to-end encryption or
database encryption yet. Note titles, filenames, tags, folder names and
structure, sizes, timestamps, and sync metadata remain plaintext by design. See
`SECURITY.md` and `docs/e2ee-threat-model.md` for the current gate and
limitations.

Optional AI providers are off by default. OpenNest sends only the prompt shown in
the review dialog, after a one-time consent, and keeps no prompt or response
history. Credentials are session-only by default or stored in an optional vault
encrypted with a separate passphrase. The vault has no recovery, workspace
recovery and backup restore do not unlock it, and backups exclude provider
settings, consents, session credentials, and vault records. Remote providers are
subject to browser CORS rules, and OpenNest cannot make a provider allow browser
origins. The AI console sends only the prompt you review. The separate document
Q&A controller is implemented but not mounted in the app yet, and OpenNest does
not execute MCP tools. Model output is rendered as plain text, but XSS while the
vault is unlocked remains a residual risk. See `SECURITY.md` and
`docs/ai-security-review.md`; the AI and credential-vault security review is not
complete.

Local extensions are optional and are installed only from a JSON file you
choose. Extension code runs in an opaque-origin iframe and a blob worker with no
DOM, network, browser storage, or credential access. OpenNest exposes only the
workspace reads you approve, stores extension data in an isolated namespace,
removes that data on uninstall, and excludes it from backups. D4A supports local
sideload only: there is no registry, publisher signature, auto-update, network
grant, or workspace write access. See `docs/extensions.md`. The independent
extension security review is not complete.

🌍 Community & Contributions

OpenNest is intended to grow with its community.

We welcome contributions involving:

- Bug fixes
- Feature development
- UI/UX improvements
- Documentation
- Accessibility
- Localization
- Testing and feedback

Contribution guidelines live in `CONTRIBUTING.md`. They remain part of the
release-support backlog until reviewed and accepted.

🗺️ Roadmap

OpenNest has five stages. Stage E is the final stage.

- [x] Stage A: Foundation
- [x] Stage B: Core architecture
- [x] Stage C: MVP features (delivered; explicit deferrals recorded in ROADMAP.md)
- [ ] Stage D: Privacy, security, and extensibility (in progress)
- [ ] Stage E: AI, sync, and collaboration (final stage)

Release-support work such as community documentation, contribution guidelines,
localization contributions, extension guidelines, feedback channels, and public
release preparation is tracked as a cross-stage backlog, not as a separate stage.

Community Space product features such as public templates, shared collections,
and a plugin catalog remain post-MVP.

See "ROADMAP.md" (./ROADMAP.md) for stage details and live status, "PRD.md" (./PRD.md)
for the product requirements, and "AGENTS.md" (./AGENTS.md) for development
instructions.

🛠️ Development

Requirements: Node.js >= 24.0.0 (`.nvmrc` pins 24) and npm >= 10. No global CLI
tools are needed for app development. Browser E2E tests require system Playwright
1.65 and Chromium; see `docs/development.md`.

```bash
npm ci
npm run dev        # http://localhost:3000
```

For the source preview, use `npm ci` so the lockfile is respected. Use
`npm install` only when you intentionally change dependencies.

Quality gates, run in this order before a pull request:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm run test:e2e` requires system Playwright and Chromium; the other gates use
repository-local dependencies. See `docs/development.md` for the full workflow,
Android/Termux notes, and the known limitations of this environment.

If you are testing the source preview rather than contributing, read
`docs/early-access.md` and `docs/run-locally.md` first.

Before contributing, read:

1. "PRD.md" (./PRD.md)
2. "AGENTS.md" (./AGENTS.md)
3. "docs/development.md" (./docs/development.md)
4. "docs/extensions.md" (./docs/extensions.md)

❤️ Support the Project

OpenNest aims to remain accessible and community-driven.

If you find the project useful, you can support its development through:

- Code contributions
- Documentation and translations
- Testing and feedback
- Community involvement
- Donations (support options will be published when available)

📜 License

OpenNest is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](./LICENSE) for the full text.

---

OpenNest 🇮🇩

Ruang digital pribadimu. Terbuka, privat, dan dibuat untuk semua orang.

OpenNest adalah ruang kerja digital pribadi berbasis open-source yang dirancang untuk membantu siapa pun mengatur file, catatan, dokumen, dan pengetahuan dalam satu tempat yang sederhana.

Dibangun dengan prinsip privacy-first dan local-first, OpenNest bertujuan memberikan kendali penuh kepada pengguna atas informasi digital mereka tanpa ketergantungan wajib pada langganan, akun, atau layanan cloud.

Status: Preview akses awal source-only v0.1.0-beta.1 tersedia. Tidak ada hosted beta. Stage A sampai Stage C selesai. Pekerjaan internal Stage D selesai; tinjauan keamanan dan kriptografi independen, gate klaim E2EE, serta gate rilis Stage E masih terbuka. CI hosted sudah hijau. Implementasi server, sync, kolaborasi, AI Q&A, dan MCP read-only adalah preview implementasi, bukan surface produksi yang didukung. Tidak ada klaim E2EE, kerahasiaan AI, keamanan sandbox ekstensi, atau isolasi MCP.

Cara mencoba: clone tag `v0.1.0-beta.1`, jalankan dengan Node 24, dan simpan backup sendiri. Preview ini tidak punya akun, sync cloud, alur kolaborasi, registri ekstensi, atau server OpenNest hosted. Baca `docs/early-access.md` dan `docs/run-locally.md` sebelum menguji.

Perpustakaan, catatan, pencarian, cadangan, dan akses offline sudah berjalan lokal di browser. Enkripsi konten opsional dan penyedia AI BYOK opsional sudah tersedia. Ekstensi lokal dengan sandbox dan API baca-saja sudah tersedia. Tinjauan keamanan independen belum dilakukan.

🌱 Visi Kami

Kami percaya setiap orang berhak memiliki ruang digital yang:

- Privat sejak awal — Data adalah milik pengguna.
- Local-first — Fitur utama dapat berjalan langsung di perangkat.
- Sederhana — Berguna tanpa kerumitan yang tidak perlu.
- Terbuka untuk semua — Dikembangkan secara open-source bersama komunitas.
- Fleksibel — Bisa dikembangkan melalui integrasi dan kontribusi komunitas.

✨ Fitur

Sudah tersedia:

- My Library: Mengatur file dan sumber daya digital.
- Smart Documents: Membuat serta mengatur catatan Markdown.
- Siap offline: Pasang aplikasi dan buka kembali konten yang sudah di-cache tanpa koneksi.
- Konsol AI opsional: Meninjau dan mengirim prompt ke penyedia yang kamu konfigurasi sendiri.
- Ekstensi lokal: Memasang ekstensi baca-saja dari paket JSON lokal di dalam sandbox.
- Pusat Privasi: Memahami dan mengelola penyimpanan data.

Masih direncanakan:

- Knowledge Hub: Mengumpulkan dan mengelola pengetahuan pribadi.
- Ask OpenNest: Bantuan berbasis AI yang bersifat opsional.
- Community Space: Menemukan kontribusi dan ekstensi komunitas.

🚀 MVP: Personal Digital Library

Pengembangan pertama berfokus pada perpustakaan digital pribadi.

Fitur MVP:

- [x] Upload dan pengelolaan file.
- [x] Folder dan tag.
- [x] Preview dokumen dengan format yang didukung.
- [x] Catatan Markdown dengan autosave.
- [x] Pencarian lokal.
- [x] Export data dan pemulihan dari cadangan lokal.
- [x] PWA yang siap digunakan secara offline.
- [x] Antarmuka Bahasa Indonesia dan Inggris.

Kemampuan Stage D dan Stage E yang sudah diimplementasikan lebih awal:

- [x] Ekstensi lokal dengan sandbox dan izin baca-saja (tinjauan keamanan belum selesai).
- [x] Autentikasi server single-user, membership, sync, file versions, dan transport kolaborasi (gate rilis masih terbuka).
- [x] Controller Document Q&A, AI ekstensi, dan MCP read-only (wiring UI dan review masih tertunda).

Preview akses awal ini tidak memasang source picker Document Q&A, manajemen token MCP, atau layar akun dan invite. Sync cloud, akun publik, registri ekstensi, dan marketplace ekstensi tetap ditunda sampai pengalaman inti stabil.

🔒 Privasi sebagai Prioritas

OpenNest dirancang agar data pribadi tetap berada di perangkat pengguna secara default.

Kami ingin membangun aplikasi yang transparan, tidak mengumpulkan data secara berlebihan, dan tidak mengirim dokumen pribadi ke layanan eksternal tanpa persetujuan pengguna.

Enkripsi konten opsional untuk isi catatan, byte file terlampir, draft
terenkripsi, dan payload backup v2 sudah diimplementasikan berdasarkan ADR 0013.
Fitur ini belum ditinjau secara independen. OpenNest belum mengklaim end-to-end
encryption atau enkripsi seluruh database. Judul catatan, nama file, tag, nama
dan struktur folder, ukuran, timestamp, serta metadata sync tetap plaintext
sesuai keputusan produk. Lihat `SECURITY.md` dan `docs/e2ee-threat-model.md`
untuk gate dan batasan saat ini.

Ekstensi lokal bersifat opsional dan hanya dipasang dari file JSON yang kamu
pilih. Kode ekstensi berjalan di iframe ber-origin opaque dan blob worker tanpa
akses DOM, jaringan, penyimpanan browser, atau kredensial. OpenNest hanya
memberikan data workspace yang kamu setujui, menyimpan data ekstensi secara
terisolasi, menghapusnya saat uninstall, dan mengecualikannya dari backup. D4A
hanya mendukung sideload lokal: belum ada registri, tanda tangan publisher,
auto-update, izin jaringan, atau akses tulis ke workspace. Lihat
`docs/extensions.md`. Tinjauan keamanan ekstensi independen belum selesai.

🤝 Bergabung dengan Komunitas

Kontribusi terbuka untuk siapa pun, baik melalui kode, dokumentasi, desain, penerjemahan, pengujian, maupun masukan.

📜 Lisensi

OpenNest menggunakan GNU Affero General Public License v3.0 (AGPL-3.0). Teks lengkap tersedia di [LICENSE](./LICENSE).

---

OpenNest — Your data. Your space. Your control.