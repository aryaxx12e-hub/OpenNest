OpenNest 🪺

Your personal digital space. Open, private, and built for everyone.

OpenNest is an open-source personal digital workspace designed to help people organize their files, notes, documents, and knowledge in one simple place.

Built around privacy-first and local-first principles, OpenNest aims to give users control over their digital information without forcing them into subscriptions, accounts, or cloud-dependent workflows.

Status: MVP in progress · Library, notes, search, backup, and offline access work locally in the browser

🌱 Our Vision

We believe everyone deserves a digital space that is:

- Private by default — Your data belongs to you.
- Local-first — Core features should work directly on your device.
- Simple to use — Useful tools without unnecessary complexity.
- Open to everyone — Open-source software shaped by its community.
- Extensible — A foundation for future integrations and community contributions.

✨ Features

Available in the local MVP:

Feature| Description
My Library| Organize files and digital resources
Smart Documents| Create and organize Markdown notes
Offline ready| Install the app and reopen cached content without a connection

Planned for later milestones:

Feature| Description
Knowledge Hub| Collect and manage personal knowledge
Ask OpenNest| Optional AI-powered assistance
Privacy Center| Understand and manage data storage
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

AI features, cloud synchronization, collaboration, and community extensions are intentionally deferred until the core experience is stable.

🧱 Technology Stack

The planned technology stack includes:

- Framework: Next.js and React
- Language: TypeScript
- Styling: Tailwind CSS
- UI Components: shadcn/ui
- Icons: Lucide
- Browser Storage: IndexedDB with Dexie
- Database: SQLite with Drizzle ORM for supported server-side deployments
- Validation: Zod
- Testing: Vitest and Playwright
- Documentation: Markdown and VitePress

The architecture will use storage abstractions so the application is not tightly coupled to a single storage implementation.

🔒 Privacy First

Privacy is a core design principle, not a premium feature.

OpenNest aims to:

- Keep personal data on the user's device by default.
- Avoid unnecessary data collection.
- Make external services optional.
- Require explicit consent before transferring personal documents to external services.
- Provide clear data export and deletion capabilities.

Browser storage has limitations, including possible eviction by the browser. Users should be able to export and back up their data.

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

Contribution guidelines will be published as development progresses.

🗺️ Roadmap

The project will evolve incrementally.

- [x] Foundation and project architecture
- [x] Core UI and application shell
- [x] Personal Digital Library
- [x] Notes and knowledge organization
- [x] Search and local data portability
- [x] PWA and offline experience
- [ ] Accessibility and localization improvements
- [ ] Community ecosystem

See "PRD.md" (./PRD.md) for the product requirements and "AGENTS.md" (./AGENTS.md) for development instructions.

🛠️ Development

Requirements: Node.js >= 24.0.0 (`.nvmrc` pins 24) and npm >= 10. No global CLI
tools are needed.

```bash
npm install
npm run dev        # http://localhost:3000
```

Quality gates, run in this order before a pull request:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

See `docs/development.md` for the full workflow, Android/Termux notes, and the
known limitations of this environment.

Before contributing, read:

1. "PRD.md" (./PRD.md)
2. "AGENTS.md" (./AGENTS.md)
3. "docs/development.md" (./docs/development.md)

❤️ Support the Project

OpenNest aims to remain accessible and community-driven.

If you find the project useful, you can support its development through:

- Code contributions
- Documentation and translations
- Testing and feedback
- Community involvement
- Donations (support options will be published when available)

📜 License

The project is planned to use the GNU Affero General Public License v3.0 (AGPL-3.0).

The final license will be included in the repository before the first public release.

---

OpenNest 🇮🇩

Ruang digital pribadimu. Terbuka, privat, dan dibuat untuk semua orang.

OpenNest adalah ruang kerja digital pribadi berbasis open-source yang dirancang untuk membantu siapa pun mengatur file, catatan, dokumen, dan pengetahuan dalam satu tempat yang sederhana.

Dibangun dengan prinsip privacy-first dan local-first, OpenNest bertujuan memberikan kendali penuh kepada pengguna atas informasi digital mereka tanpa ketergantungan wajib pada langganan, akun, atau layanan cloud.

Status: MVP dalam pengembangan · Perpustakaan, catatan, pencarian, cadangan, dan akses offline sudah berjalan lokal di browser

🌱 Visi Kami

Kami percaya setiap orang berhak memiliki ruang digital yang:

- Privat sejak awal — Data adalah milik pengguna.
- Local-first — Fitur utama dapat berjalan langsung di perangkat.
- Sederhana — Berguna tanpa kerumitan yang tidak perlu.
- Terbuka untuk semua — Dikembangkan secara open-source bersama komunitas.
- Fleksibel — Bisa dikembangkan melalui integrasi dan kontribusi komunitas.

✨ Fitur

Sudah tersedia di MVP lokal:

- My Library: Mengatur file dan sumber daya digital.
- Smart Documents: Membuat serta mengatur catatan Markdown.
- Siap offline: Pasang aplikasi dan buka kembali konten yang sudah di-cache tanpa koneksi.

Masih direncanakan:

- Knowledge Hub: Mengumpulkan dan mengelola pengetahuan pribadi.
- Ask OpenNest: Bantuan berbasis AI yang bersifat opsional.
- Privacy Center: Memahami dan mengelola penyimpanan data.
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

Fitur AI, sinkronisasi cloud, kolaborasi, dan ekstensi komunitas akan dikembangkan setelah fondasi utama stabil.

🔒 Privasi sebagai Prioritas

OpenNest dirancang agar data pribadi tetap berada di perangkat pengguna secara default.

Kami ingin membangun aplikasi yang transparan, tidak mengumpulkan data secara berlebihan, dan tidak mengirim dokumen pribadi ke layanan eksternal tanpa persetujuan pengguna.

🤝 Bergabung dengan Komunitas

Kontribusi terbuka untuk siapa pun, baik melalui kode, dokumentasi, desain, penerjemahan, pengujian, maupun masukan.

📜 Lisensi

OpenNest direncanakan menggunakan GNU Affero General Public License v3.0 (AGPL-3.0). Lisensi final akan disertakan sebelum rilis publik pertama.

---

OpenNest — Your data. Your space. Your control.