OpenNest 🪺

Your personal digital space. Open, private, and built for everyone.

OpenNest is an open-source personal digital workspace designed to help people organize their files, notes, documents, and knowledge in one simple place.

Built around privacy-first and local-first principles, OpenNest aims to give users control over their digital information without forcing them into subscriptions, accounts, or cloud-dependent workflows.

Status: Pre-development · Early planning

🌱 Our Vision

We believe everyone deserves a digital space that is:

- Private by default — Your data belongs to you.
- Local-first — Core features should work directly on your device.
- Simple to use — Useful tools without unnecessary complexity.
- Open to everyone — Open-source software shaped by its community.
- Extensible — A foundation for future integrations and community contributions.

✨ Planned Features

The following features are part of the product vision. They are planned, not yet implemented.

Feature| Description
My Library| Organize files and digital resources
Knowledge Hub| Collect and manage personal knowledge
Smart Documents| Create and organize notes and documents
Ask OpenNest| Optional AI-powered assistance
Privacy Center| Understand and manage data storage
Community Space| Discover community contributions and extensions

🚀 MVP: Personal Digital Library

The first development milestone focuses on a practical personal digital library.

Planned MVP capabilities:

- File upload and organization
- Folders and tags
- Document preview for supported formats
- Markdown notes with autosave
- Local search
- Data import and export
- Offline-ready Progressive Web App (PWA)
- Indonesian and English interface

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

- [ ] Foundation and project architecture
- [ ] Core UI and application shell
- [ ] Personal Digital Library
- [ ] Notes and knowledge organization
- [ ] Search and data portability
- [ ] PWA and offline experience
- [ ] Accessibility and localization improvements
- [ ] Community ecosystem

See "PRD.md" (./PRD.md) for the product requirements and "AGENTS.md" (./AGENTS.md) for development instructions.

🛠️ Development

Requirements: Node.js >= 20.9 (`.nvmrc` pins 24) and npm >= 10. No global CLI
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

Status: Pra-pengembangan · Tahap perencanaan awal

🌱 Visi Kami

Kami percaya setiap orang berhak memiliki ruang digital yang:

- Privat sejak awal — Data adalah milik pengguna.
- Local-first — Fitur utama dapat berjalan langsung di perangkat.
- Sederhana — Berguna tanpa kerumitan yang tidak perlu.
- Terbuka untuk semua — Dikembangkan secara open-source bersama komunitas.
- Fleksibel — Bisa dikembangkan melalui integrasi dan kontribusi komunitas.

✨ Fitur yang Direncanakan

Semua fitur berikut masih berada dalam tahap perencanaan.

- My Library: Mengatur file dan sumber daya digital.
- Knowledge Hub: Mengumpulkan dan mengelola pengetahuan pribadi.
- Smart Documents: Membuat serta mengatur catatan dan dokumen.
- Ask OpenNest: Bantuan berbasis AI yang bersifat opsional.
- Privacy Center: Memahami dan mengelola penyimpanan data.
- Community Space: Menemukan kontribusi dan ekstensi komunitas.

🚀 MVP: Personal Digital Library

Pengembangan pertama berfokus pada perpustakaan digital pribadi.

Target fitur awal:

- Upload dan pengelolaan file.
- Folder dan tag.
- Preview dokumen dengan format yang didukung.
- Catatan Markdown dengan autosave.
- Pencarian lokal.
- Import dan export data.
- PWA yang siap digunakan secara offline.
- Antarmuka Bahasa Indonesia dan Inggris.

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