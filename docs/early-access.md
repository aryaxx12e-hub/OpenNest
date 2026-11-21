# OpenNest early access source preview

Status: v0.1.0-beta.1, source-only preview.

OpenNest is a local-first personal workspace for files, notes, folders, tags, and
search. This preview is for people who want to try the current client and report
problems. It is not a hosted service, not a production release, and not a Stage E
release.

## What this preview is

- A source snapshot of the OpenNest web client at tag `v0.1.0-beta.1`.
- A local-first app that stores workspace data in the browser.
- A way to test the library, notes, search, backup, restore, and offline PWA
  flows before a hosted beta exists.

## What this preview is not

- There is no OpenNest account, login, or cloud workspace.
- There is no hosted beta URL and no OpenNest server deployment.
- There is no browser sync, multi-device sync, or collaboration setup flow.
- There is no extension registry, marketplace, or remote extension install.
- There is no document Q&A source picker or MCP token management UI.
- There is no independent security review, cryptographic review, or E2EE claim.
- This is not a Stage E release. The Stage E gate register remains open.

## What works

- Dashboard, library, folder management, file upload, and file preview.
- Tags, local search, and note-to-note links.
- Markdown notes with autosave, draft recovery, and per-note export.
- Local backup export, import, validation, and restore.
- Installable PWA with an offline shell.
- English and Indonesian interface.
- Optional workspace content encryption. It is implemented but has not been
  independently reviewed. Metadata remains plaintext by design.
- Optional BYOK AI console. A prompt is sent only after review and consent.
- Local sideload extensions with a read-only host API. The sandbox has not been
  independently reviewed.
- Privacy Center and browser storage diagnostics.

The self-hosted server, sync, collaboration, document Q&A controller, and
read-only MCP server exist as implementation previews in the repository. They are
not part of this source preview's supported workflow.

## Requirements

- Node.js 24 or newer. The repository pins Node 24 in `.nvmrc`.
- npm 10 or newer.
- Git.
- A modern browser with IndexedDB support.

Follow [run-locally.md](./run-locally.md) for the exact commands.

## Data and privacy

OpenNest stores workspace data in IndexedDB for the origin you use. Running the
app at `http://localhost:3000` creates data for that origin. Clearing site data,
changing the origin, or using a different browser creates a separate workspace.

OpenNest does not upload your workspace as part of normal local use. Browser
storage is not permanent. Export a backup before clearing site data, changing
browsers, or testing destructive flows. Keep a second copy outside the browser.

Optional AI requests leave the browser only after the consent step and only for
the prompt you review. Optional encryption protects content but not every piece
of metadata. There is no password recovery for encrypted workspaces.

## Security status

This preview is unreviewed software. Do not use it as the only copy of important
data. Do not use it for sensitive personal or business information.

OpenNest makes no E2EE, AI confidentiality, extension sandbox security, or MCP
isolation claim for this preview. The Stage D security review, external
cryptographic review, extension review, AI review, and Stage E gates remain open.
See `SECURITY.md`, `docs/e2ee-threat-model.md`, and
`docs/stage-e-gate-register.md`.

## Feedback

Use the repository issue tracker for reproducible bugs, accessibility problems,
and documentation mistakes. Include the tag, browser, operating system, and the
steps that triggered the problem. Do not paste private workspace content into an
issue. Use a minimal example instead.

## License

OpenNest is licensed under the GNU Affero General Public License v3.0
(AGPL-3.0-only). See `LICENSE`.

---

## Ringkasan Bahasa Indonesia

Ini adalah preview source-only untuk `v0.1.0-beta.1`. Tidak ada link hosted,
akun, sync, atau server OpenNest. Jalankan app secara lokal, uji fitur library,
notes, search, backup, dan PWA, lalu laporkan masalah lewat issue GitHub.

Data tersimpan di browser. Backup sebelum menghapus site data atau berganti
browser. Ini bukan rilis Stage E, belum direview secara independen, dan tidak
boleh dipakai sebagai satu-satunya salinan data penting. Tidak ada klaim E2EE,
kerahasiaan AI, keamanan sandbox ekstensi, atau isolasi MCP.
